//! Binary serializer/deserializer for the format palette.
//!
//! Replaces the JSON-encoded `CellFormat[]` palette with a compact binary
//! format. No dependency on `serde_json`.
//!
//! # Wire Layout (all little-endian)
//!
//! ```text
//! [u16  start_index]
//! [u16  format_count]
//! [u32  string_pool_bytes]
//! [FormatRecord x format_count]   (variable-size, sequential)
//! [StringPool]                     (UTF-8 bytes, interned)
//! ```
//!
//! See module-level constants for the presence-mask bit assignments.

mod format_record;
mod layout;
mod nested;
mod read;
mod string_pool;
#[cfg(test)]
mod tests;
mod write;

use std::fmt;

use domain_types::CellFormat;

use format_record::{read_format_record, write_format_record};
use layout::PALETTE_HEADER_SIZE;
use read::Cursor;
use string_pool::StringPool;

pub(super) use layout::{
    BIT_BACKGROUND_COLOR, BIT_BOLD, BIT_BORDERS, BIT_FONT_CHARSET, BIT_FONT_COLOR, BIT_FONT_FAMILY,
    BIT_FONT_FAMILY_TYPE, BIT_FONT_OUTLINE, BIT_FONT_SHADOW, BIT_FONT_SIZE, BIT_FONT_THEME,
    BIT_GRADIENT_FILL, BIT_HIDDEN, BIT_HORIZONTAL_ALIGN, BIT_INDENT, BIT_ITALIC, BIT_LOCKED,
    BIT_NUMBER_FORMAT, BIT_PATTERN_FG_COLOR, BIT_PATTERN_TYPE, BIT_READING_ORDER,
    BIT_SHRINK_TO_FIT, BIT_STRIKETHROUGH, BIT_SUBSCRIPT, BIT_SUPERSCRIPT, BIT_TEXT_ROTATION,
    BIT_UNDERLINE_TYPE, BIT_VERTICAL_ALIGN, BIT_WRAP_TEXT,
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Errors that can occur when deserializing a binary palette.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaletteBinaryError {
    /// The buffer is too short to contain the expected data.
    BufferTooShort {
        /// What was being read when the error occurred.
        context: &'static str,
        /// Number of bytes needed.
        needed: usize,
        /// Number of bytes available.
        available: usize,
    },
    /// A string reference points outside the string pool.
    InvalidStringRef {
        /// Byte offset into the pool.
        offset: u32,
        /// Length of the string.
        length: u16,
        /// Total size of the string pool.
        pool_size: u32,
    },
    /// A string in the pool is not valid UTF-8.
    InvalidUtf8 {
        /// Byte offset into the pool.
        offset: u32,
        /// Length of the string slice.
        length: u16,
    },
}

impl fmt::Display for PaletteBinaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BufferTooShort {
                context,
                needed,
                available,
            } => write!(
                f,
                "palette binary: buffer too short while reading {context} \
                 (needed {needed}, available {available})"
            ),
            Self::InvalidStringRef {
                offset,
                length,
                pool_size,
            } => write!(
                f,
                "palette binary: string ref ({offset}+{length}) exceeds pool size {pool_size}"
            ),
            Self::InvalidUtf8 { offset, length } => write!(
                f,
                "palette binary: invalid UTF-8 in string pool at {offset}+{length}"
            ),
        }
    }
}

impl std::error::Error for PaletteBinaryError {}

// ===========================================================================
// Serialization
// ===========================================================================

/// Serialize a palette of [`CellFormat`]s into binary bytes.
///
/// The output contains a palette header, variable-length format records,
/// and a deduplicated string pool. All multi-byte integers are little-endian.
///
/// This function is infallible — any valid `&[CellFormat]` can be serialized.
#[must_use]
pub fn serialize_palette_binary(formats: &[CellFormat], start_index: u16) -> Vec<u8> {
    // Step 1: Build the format records and string pool in parallel buffers.
    // Estimate ~64 bytes per format record (variable due to optional string refs).
    let mut records_buf: Vec<u8> = Vec::with_capacity(formats.len() * 64);
    let mut pool = StringPool::new();

    for fmt in formats {
        write_format_record(fmt, &mut records_buf, &mut pool);
    }

    let pool_bytes = pool.finish();

    // Step 2: Assemble the final buffer.
    let total = PALETTE_HEADER_SIZE + records_buf.len() + pool_bytes.len();
    let mut out = Vec::with_capacity(total);

    // Header
    out.extend_from_slice(&start_index.to_le_bytes());
    #[allow(clippy::cast_possible_truncation)]
    let format_count = formats.len() as u16;
    out.extend_from_slice(&format_count.to_le_bytes());
    #[allow(clippy::cast_possible_truncation)]
    let pool_size = pool_bytes.len() as u32;
    out.extend_from_slice(&pool_size.to_le_bytes());

    // Records + pool
    out.extend_from_slice(&records_buf);
    out.extend_from_slice(&pool_bytes);

    out
}

// ===========================================================================
// Deserialization
// ===========================================================================

/// Deserialize a binary palette, returning `(start_index, Vec<CellFormat>)`.
///
/// # Errors
///
/// Returns [`PaletteBinaryError`] if the buffer is malformed (too short,
/// invalid string references, or non-UTF-8 string data).
pub fn deserialize_palette_binary(
    buf: &[u8],
) -> Result<(u16, Vec<CellFormat>), PaletteBinaryError> {
    let mut cursor = Cursor::new(buf);

    // Header
    let start_index = cursor.read_u16("palette header start_index")?;
    let format_count = cursor.read_u16("palette header format_count")?;
    let string_pool_bytes = cursor.read_u32("palette header string_pool_bytes")?;

    // We need to know where the string pool starts: after all format records.
    // But records are variable-length, so we read them first and track position.
    // The string pool starts at the current cursor position + all record bytes.
    // Actually, we read records sequentially; after reading all records, the
    // remaining bytes should be the string pool.
    let records_start = cursor.pos;

    // We need to find the pool. Pool starts after all records.
    // pool_start = buf.len() - string_pool_bytes
    let pool_start = buf.len().checked_sub(string_pool_bytes as usize).ok_or(
        PaletteBinaryError::BufferTooShort {
            context: "string pool location",
            needed: string_pool_bytes as usize,
            available: buf.len(),
        },
    )?;

    let pool = &buf[pool_start..];

    // Read format records (they live between current position and pool_start).
    let mut formats = Vec::with_capacity(format_count as usize);
    // Use a cursor that only sees the records portion.
    let records_slice = &buf[records_start..pool_start];
    let mut rc = Cursor::new(records_slice);

    for _ in 0..format_count {
        let fmt = read_format_record(&mut rc, pool, string_pool_bytes)?;
        formats.push(fmt);
    }

    Ok((start_index, formats))
}

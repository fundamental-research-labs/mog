//! In-place viewport binary redaction.
//!
//! This is the authoritative replacement for the legacy TS stub
//! (`filterViewportBuffer` — returned the buffer unchanged). The filter
//! operates on the wire buffer directly: no decode/re-encode, and the uniform
//! fast path touches only the cell-record region.
//!
//! ## Why in-place
//!
//! The viewport buffer is emitted by [`crate::serialize_viewport_binary`] and
//! crosses the bridge as a `Vec<u8>`. Decoding the buffer into `ViewportRenderCell`,
//! mutating, and re-encoding would (a) double the allocation cost and (b) leak
//! the intermediate representation — the whole point of keeping the wire format
//! in Rust is so security is applied before the buffer reaches the bridge.
//! See ARCHITECTURE.md §7.
//!
//! ## Buffer layout recap (little-endian)
//!
//! ```text
//! [Header 36 B] [CellRecords N×32 B] [StringPool] [Merges] [RowDims] [ColDims]
//! [FormatPalette] [DataBars] [Icons] [RowPositions] [ColPositions]
//! ```
//!
//! Cells are stored dense row-major, so cell at index `i` has
//! `row = start_row + i / viewport_cols`, `col = start_col + i % viewport_cols`.
//! The wire format does not carry `(row, col)` per cell — the header's
//! `start_row`, `start_col`, and `viewport_cols` parameterize the mapping.
//!
//! ## In-place walk strategy
//!
//! The buffer is modified without decoding:
//!
//! 1. **Uniform None** — walk cell records, zero each value field in the 32-byte
//!    record. The string pool and trailing sections are untouched.
//! 2. **Uniform Structure** — append placeholder strings (one per value type)
//!    to the existing string pool, shifting trailing sections forward by that
//!    many bytes. Walk cell records; each record's `display_off` is redirected
//!    to the appended placeholder matching its value type (the type lives in
//!    the flags field and is preserved). `number_value`, `error_off`, and the
//!    color overrides are zeroed.
//! 3. **Mixed** — same as (2) but per-cell: only cells whose matrix lookup
//!    yields None or Structure are rewritten. Read/Write/Admin cells pass
//!    through unchanged.
//!
//! Shifting the trailing sections is an O(buf.len()) `Vec::splice` call. For
//! the uniform None fast path we avoid it entirely — no allocation, no shift.

use compute_security::{AccessLevel, SheetAccessMatrix};

use crate::constants::{
    CELL_STRIDE, NO_STRING, OFF_BG_COLOR_OVERRIDE, OFF_DISPLAY_LEN, OFF_DISPLAY_OFF, OFF_ERROR_LEN,
    OFF_ERROR_OFF, OFF_FLAGS, OFF_FONT_COLOR_OVERRIDE, OFF_NUMBER_VALUE, VIEWPORT_HEADER_SIZE,
};
use crate::flags::{
    VALUE_TYPE_BOOL, VALUE_TYPE_ERROR, VALUE_TYPE_MASK, VALUE_TYPE_NUMBER, VALUE_TYPE_TEXT,
};

// Header field byte offsets (mirror of what `write_viewport_header` writes).
const OFF_HDR_START_ROW: usize = 0;
const OFF_HDR_START_COL: usize = 4;
const OFF_HDR_CELL_COUNT: usize = 8;
const OFF_HDR_STRING_POOL_BYTES: usize = 16;
const OFF_HDR_VIEWPORT_COLS: usize = 22;

// Placeholder strings keyed by value type. One-character ASCII keeps the
// shift cheap (5 bytes total per call, regardless of the cell count).
//
// Chosen for legibility on the renderer — any character renders as "redacted"
// to the user. Type distinction exists so the renderer can format (right-align
// numbers vs left-align text) without seeing the real value.
const PLACEHOLDER_NUMBER: &[u8] = b"#";
const PLACEHOLDER_TEXT: &[u8] = b"-";
const PLACEHOLDER_BOOL: &[u8] = b"?";
const PLACEHOLDER_ERROR: &[u8] = b"!";
// Null cells have no display in the first place — no placeholder needed.

/// Redact a viewport binary buffer in place, according to the given access
/// matrix.
///
/// * `AccessLevel::None` — cell values are zeroed; the reader sees empty cells.
/// * `AccessLevel::Structure` — cell values are replaced with a type
///   placeholder; the reader sees that a number/text/bool/error was there, but
///   not what it was.
/// * `AccessLevel::Read` / `Write` / `Admin` — passthrough.
///
/// The filter tolerates malformed / too-short buffers by returning early
/// without mutating. Production callers always pass a freshly-serialized
/// buffer; the bounds checks are defense in depth.
pub fn filter_viewport_buffer(buffer: &mut Vec<u8>, matrix: &SheetAccessMatrix) {
    // Fast-path: buffer too small to contain the header. Do nothing rather
    // than panic — the empty case is a valid no-op.
    if buffer.len() < VIEWPORT_HEADER_SIZE {
        return;
    }

    let cell_count = read_u32(buffer, OFF_HDR_CELL_COUNT) as usize;
    if cell_count == 0 {
        return;
    }

    // Bounds: cell records must fit.
    let cell_end = VIEWPORT_HEADER_SIZE.saturating_add(cell_count.saturating_mul(CELL_STRIDE));
    if cell_end > buffer.len() {
        return;
    }

    // Uniform fast paths.
    if let Some(level) = matrix.is_uniform() {
        match level {
            AccessLevel::None => zero_all_values(buffer, cell_count),
            AccessLevel::Structure => replace_values_with_type_placeholders(buffer, cell_count),
            // Read / Write / Admin: unchanged.
            _ => {}
        }
        return;
    }

    // Mixed path: per-cell. We still materialize placeholder strings once, up
    // front — even if only a handful of cells need them, the cost is paid once
    // per filter call rather than per cell (per spec in ARCHITECTURE.md §7).
    per_cell_filter(buffer, cell_count, matrix);
}

// ---------------------------------------------------------------------------
// Uniform fast paths — no buffer extension, only cell-record mutation.
// ---------------------------------------------------------------------------

/// Zero every cell record's value-bearing fields. Leaves the string pool and
/// all trailing sections untouched.
fn zero_all_values(buffer: &mut [u8], cell_count: usize) {
    for i in 0..cell_count {
        let base = VIEWPORT_HEADER_SIZE + i * CELL_STRIDE;
        zero_cell_value(&mut buffer[base..base + CELL_STRIDE]);
    }
}

/// Zero a single cell record's value-bearing fields. `record` must be a
/// 32-byte slice (one cell record).
///
/// Behaviour:
/// - `number_value` → 0.0
/// - `display_off` / `display_len` → `NO_STRING` / 0
/// - `error_off` / `error_len` → `NO_STRING` / 0
/// - `flags` → value-type bits cleared to NULL, other bits preserved
///   (so the renderer still knows about formulas, sparklines, etc. — those
///   are not value-revealing)
/// - color overrides → 0
///
/// `format_idx` is intentionally preserved. Format (number format, borders,
/// background) is not value-revealing and keeping it avoids layout jumps.
fn zero_cell_value(record: &mut [u8]) {
    debug_assert_eq!(record.len(), CELL_STRIDE);

    // number_value = 0.0
    record[OFF_NUMBER_VALUE..OFF_NUMBER_VALUE + 8].copy_from_slice(&0.0f64.to_le_bytes());
    // display_off = NO_STRING, display_len = 0
    record[OFF_DISPLAY_OFF..OFF_DISPLAY_OFF + 4].copy_from_slice(&NO_STRING.to_le_bytes());
    record[OFF_DISPLAY_LEN..OFF_DISPLAY_LEN + 2].copy_from_slice(&0u16.to_le_bytes());
    // error_off = NO_STRING, error_len = 0
    record[OFF_ERROR_OFF..OFF_ERROR_OFF + 4].copy_from_slice(&NO_STRING.to_le_bytes());
    record[OFF_ERROR_LEN..OFF_ERROR_LEN + 2].copy_from_slice(&0u16.to_le_bytes());
    // Flags: clear value-type bits (bits 0-2). Bool `false`, bool `true`, an
    // error, a number, and text all become NULL to the reader.
    let mut flags = read_u16_from(record, OFF_FLAGS);
    flags &= !VALUE_TYPE_MASK;
    record[OFF_FLAGS..OFF_FLAGS + 2].copy_from_slice(&flags.to_le_bytes());
    // Color overrides: zero (can hint at CF rules that target values).
    record[OFF_BG_COLOR_OVERRIDE..OFF_BG_COLOR_OVERRIDE + 4].copy_from_slice(&0u32.to_le_bytes());
    record[OFF_FONT_COLOR_OVERRIDE..OFF_FONT_COLOR_OVERRIDE + 4]
        .copy_from_slice(&0u32.to_le_bytes());
}

/// Replace every cell record's value with a type placeholder. Appends the
/// placeholder strings to the string pool once, then redirects every cell's
/// `display_off` at the one matching its value type.
fn replace_values_with_type_placeholders(buffer: &mut Vec<u8>, cell_count: usize) {
    let placeholders = materialize_placeholders(buffer);

    for i in 0..cell_count {
        let base = VIEWPORT_HEADER_SIZE + i * CELL_STRIDE;
        let flags = read_u16_from(&buffer[base..], OFF_FLAGS);
        let value_type = flags & VALUE_TYPE_MASK;
        apply_structure_placeholder(
            &mut buffer[base..base + CELL_STRIDE],
            value_type,
            &placeholders,
        );
    }
}

// ---------------------------------------------------------------------------
// Slow path — per-cell matrix lookup.
// ---------------------------------------------------------------------------

/// Per-cell walk. Appends placeholder strings up front (even if only a subset
/// of cells need them) so the work is amortized over the whole filter call.
#[allow(clippy::cast_possible_truncation)] // cell_count comes from a u32 header field; i < cell_count
fn per_cell_filter(buffer: &mut Vec<u8>, cell_count: usize, matrix: &SheetAccessMatrix) {
    let start_row = read_u32(buffer, OFF_HDR_START_ROW);
    let start_col = read_u32(buffer, OFF_HDR_START_COL);
    let viewport_cols = u32::from(read_u16(buffer, OFF_HDR_VIEWPORT_COLS));

    // Cell index → (row, col) is derived from the dense row-major layout. If
    // viewport_cols is zero the layout is degenerate (should never happen at
    // the serializer, but defense in depth).
    if viewport_cols == 0 {
        return;
    }

    let placeholders = materialize_placeholders(buffer);

    for i in 0..cell_count {
        let cell_idx = i as u32;
        let row = start_row.saturating_add(cell_idx / viewport_cols);
        let col = start_col.saturating_add(cell_idx % viewport_cols);

        let base = VIEWPORT_HEADER_SIZE + i * CELL_STRIDE;
        match matrix.get(row, col) {
            AccessLevel::None => {
                zero_cell_value(&mut buffer[base..base + CELL_STRIDE]);
            }
            AccessLevel::Structure => {
                let flags = read_u16_from(&buffer[base..], OFF_FLAGS);
                let value_type = flags & VALUE_TYPE_MASK;
                apply_structure_placeholder(
                    &mut buffer[base..base + CELL_STRIDE],
                    value_type,
                    &placeholders,
                );
            }
            // Read / Write / Admin — no change.
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Placeholder pool management.
// ---------------------------------------------------------------------------

/// Offsets (into the string pool) and lengths of the four placeholder strings.
/// `None` means the type wasn't needed / not present (currently always set).
#[derive(Debug, Clone, Copy)]
struct Placeholders {
    number: (u32, u16),
    text: (u32, u16),
    bool_: (u32, u16),
    error: (u32, u16),
}

/// Append the four placeholder byte-strings to the string pool and bump the
/// header's `string_pool_bytes`. Shifts the trailing sections forward.
///
/// Returns the `(offset, len)` of each placeholder within the string pool.
/// Offsets are relative to the start of the string pool, matching the
/// `display_off` semantics on cell records.
#[allow(clippy::cast_possible_truncation)] // placeholder strings are a single byte each; total append << u32::MAX
fn materialize_placeholders(buffer: &mut Vec<u8>) -> Placeholders {
    const PLACEHOLDER_COUNT: u16 = 4;
    // Each placeholder is a 1-byte ASCII; assert at build time so adding a
    // longer placeholder later forces a review (the u16 len fields have enough
    // headroom but the `as u16` casts would silently truncate).
    const _: () = assert!(PLACEHOLDER_NUMBER.len() == 1);
    const _: () = assert!(PLACEHOLDER_TEXT.len() == 1);
    const _: () = assert!(PLACEHOLDER_BOOL.len() == 1);
    const _: () = assert!(PLACEHOLDER_ERROR.len() == 1);

    let cell_count = read_u32(buffer, OFF_HDR_CELL_COUNT) as usize;
    let existing_pool_bytes = read_u32(buffer, OFF_HDR_STRING_POOL_BYTES) as usize;
    let pool_start = VIEWPORT_HEADER_SIZE + cell_count * CELL_STRIDE;
    let pool_end = pool_start + existing_pool_bytes;

    // Assemble the appended bytes in a single allocation so the splice is
    // one shift, not four.
    let total_append = PLACEHOLDER_NUMBER.len()
        + PLACEHOLDER_TEXT.len()
        + PLACEHOLDER_BOOL.len()
        + PLACEHOLDER_ERROR.len();
    let mut appended: Vec<u8> = Vec::with_capacity(total_append);
    let number_off = existing_pool_bytes as u32;
    appended.extend_from_slice(PLACEHOLDER_NUMBER);
    let text_off = number_off + PLACEHOLDER_NUMBER.len() as u32;
    appended.extend_from_slice(PLACEHOLDER_TEXT);
    let bool_off = text_off + PLACEHOLDER_TEXT.len() as u32;
    appended.extend_from_slice(PLACEHOLDER_BOOL);
    let error_off = bool_off + PLACEHOLDER_BOOL.len() as u32;
    appended.extend_from_slice(PLACEHOLDER_ERROR);

    let appended_len = appended.len();

    // Splice the bytes at the end of the existing string pool. Everything
    // after (merges, dimensions, palette, CF extras, positions) shifts forward
    // by `appended_len` bytes — their own layout is byte-identical; only
    // their absolute position changes.
    buffer.splice(pool_end..pool_end, appended);

    // Bump string_pool_bytes in the header so the consumer's cursor math for
    // downstream sections still lands at the right offset.
    let new_pool_bytes = (existing_pool_bytes + appended_len) as u32;
    buffer[OFF_HDR_STRING_POOL_BYTES..OFF_HDR_STRING_POOL_BYTES + 4]
        .copy_from_slice(&new_pool_bytes.to_le_bytes());

    // Silence the dead-code lint on PLACEHOLDER_COUNT while keeping the
    // invariant named — the four-entry Placeholders struct matches this.
    let _ = PLACEHOLDER_COUNT;

    Placeholders {
        number: (number_off, PLACEHOLDER_NUMBER.len() as u16),
        text: (text_off, PLACEHOLDER_TEXT.len() as u16),
        bool_: (bool_off, PLACEHOLDER_BOOL.len() as u16),
        error: (error_off, PLACEHOLDER_ERROR.len() as u16),
    }
}

/// Write a structure-level placeholder into the cell record. Preserves the
/// value-type bits (so renderers can still distinguish number vs text when
/// laying out) but zeroes the value itself and redirects `display_off` at the
/// matching placeholder. Null cells have no display to redact — they stay as is
/// for their string pointers but still get `number_value` and colors zeroed
/// for belt-and-suspenders.
fn apply_structure_placeholder(record: &mut [u8], value_type: u16, placeholders: &Placeholders) {
    debug_assert_eq!(record.len(), CELL_STRIDE);

    // Always zero number_value / error fields / colors — none of those are
    // shape-revealing; the placeholder carries the type signal.
    record[OFF_NUMBER_VALUE..OFF_NUMBER_VALUE + 8].copy_from_slice(&0.0f64.to_le_bytes());
    record[OFF_ERROR_OFF..OFF_ERROR_OFF + 4].copy_from_slice(&NO_STRING.to_le_bytes());
    record[OFF_ERROR_LEN..OFF_ERROR_LEN + 2].copy_from_slice(&0u16.to_le_bytes());
    record[OFF_BG_COLOR_OVERRIDE..OFF_BG_COLOR_OVERRIDE + 4].copy_from_slice(&0u32.to_le_bytes());
    record[OFF_FONT_COLOR_OVERRIDE..OFF_FONT_COLOR_OVERRIDE + 4]
        .copy_from_slice(&0u32.to_le_bytes());

    let (off, len) = match value_type {
        VALUE_TYPE_NUMBER => placeholders.number,
        VALUE_TYPE_TEXT => placeholders.text,
        VALUE_TYPE_BOOL => placeholders.bool_,
        VALUE_TYPE_ERROR => placeholders.error,
        // Null and unknown — no placeholder. Clear display too so we don't
        // leak a stale pointer that could read past the new pool boundary
        // after the splice shift. (VALUE_TYPE_NULL folds into the wildcard
        // because both arms want the same behaviour; an unknown discriminant
        // from a future wire-version bump also takes this branch.)
        _ => {
            record[OFF_DISPLAY_OFF..OFF_DISPLAY_OFF + 4].copy_from_slice(&NO_STRING.to_le_bytes());
            record[OFF_DISPLAY_LEN..OFF_DISPLAY_LEN + 2].copy_from_slice(&0u16.to_le_bytes());
            return;
        }
    };
    record[OFF_DISPLAY_OFF..OFF_DISPLAY_OFF + 4].copy_from_slice(&off.to_le_bytes());
    record[OFF_DISPLAY_LEN..OFF_DISPLAY_LEN + 2].copy_from_slice(&len.to_le_bytes());
}

// ---------------------------------------------------------------------------
// Little helpers — keep the arithmetic local so the mainline reads cleanly.
// ---------------------------------------------------------------------------

#[inline]
fn read_u16(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(buf[off..off + 2].try_into().expect("bounds pre-checked"))
}

#[inline]
fn read_u32(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(buf[off..off + 4].try_into().expect("bounds pre-checked"))
}

#[inline]
fn read_u16_from(buf: &[u8], off: usize) -> u16 {
    read_u16(buf, off)
}

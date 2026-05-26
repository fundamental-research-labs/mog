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

use std::collections::HashMap;
use std::fmt;

use domain_types::{
    CellBorderSide, CellBorders, CellFormat, FontSize, GradientCenter, GradientFillFormat,
    GradientStopFormat,
};

// ---------------------------------------------------------------------------
// Presence-mask bit constants (29 fields, bits 0-28)
// ---------------------------------------------------------------------------

/// Bit for `font_family`: `Option<String>`.
pub(crate) const BIT_FONT_FAMILY: u32 = 1 << 0;
/// Bit for `font_size`: `Option<FontSize>`.
pub(crate) const BIT_FONT_SIZE: u32 = 1 << 1;
/// Bit for `font_color`: `Option<String>`.
pub(crate) const BIT_FONT_COLOR: u32 = 1 << 2;
/// Bit for `bold`: `Option<bool>`.
pub(crate) const BIT_BOLD: u32 = 1 << 3;
/// Bit for `italic`: `Option<bool>`.
pub(crate) const BIT_ITALIC: u32 = 1 << 4;
/// Bit for `underline_type`: `Option<String>`.
pub(crate) const BIT_UNDERLINE_TYPE: u32 = 1 << 5;
/// Bit for `strikethrough`: `Option<bool>`.
pub(crate) const BIT_STRIKETHROUGH: u32 = 1 << 6;
/// Bit for `superscript`: `Option<bool>`.
pub(crate) const BIT_SUPERSCRIPT: u32 = 1 << 7;
/// Bit for `subscript`: `Option<bool>`.
pub(crate) const BIT_SUBSCRIPT: u32 = 1 << 8;
/// Bit for `font_outline`: `Option<bool>`.
pub(crate) const BIT_FONT_OUTLINE: u32 = 1 << 9;
/// Bit for `font_shadow`: `Option<bool>`.
pub(crate) const BIT_FONT_SHADOW: u32 = 1 << 10;
/// Bit for `font_theme`: `Option<String>`.
pub(crate) const BIT_FONT_THEME: u32 = 1 << 11;
/// Bit for `font_charset`: `Option<u32>`.
pub(crate) const BIT_FONT_CHARSET: u32 = 1 << 12;
/// Bit for `font_family_type`: `Option<u32>`.
pub(crate) const BIT_FONT_FAMILY_TYPE: u32 = 1 << 13;
/// Bit for `horizontal_align`: `Option<String>`.
pub(crate) const BIT_HORIZONTAL_ALIGN: u32 = 1 << 14;
/// Bit for `vertical_align`: `Option<String>`.
pub(crate) const BIT_VERTICAL_ALIGN: u32 = 1 << 15;
/// Bit for `wrap_text`: `Option<bool>`.
pub(crate) const BIT_WRAP_TEXT: u32 = 1 << 16;
/// Bit for `indent`: `Option<u32>`.
pub(crate) const BIT_INDENT: u32 = 1 << 17;
/// Bit for `text_rotation`: `Option<i32>`.
pub(crate) const BIT_TEXT_ROTATION: u32 = 1 << 18;
/// Bit for `shrink_to_fit`: `Option<bool>`.
pub(crate) const BIT_SHRINK_TO_FIT: u32 = 1 << 19;
/// Bit for `reading_order`: `Option<String>`.
pub(crate) const BIT_READING_ORDER: u32 = 1 << 20;
/// Bit for `number_format`: `Option<String>`.
pub(crate) const BIT_NUMBER_FORMAT: u32 = 1 << 21;
/// Bit for `background_color`: `Option<String>`.
pub(crate) const BIT_BACKGROUND_COLOR: u32 = 1 << 22;
/// Bit for `pattern_type`: `Option<String>`.
pub(crate) const BIT_PATTERN_TYPE: u32 = 1 << 23;
/// Bit for `pattern_foreground_color`: `Option<String>`.
pub(crate) const BIT_PATTERN_FG_COLOR: u32 = 1 << 24;
/// Bit for `gradient_fill`: `Option<GradientFillFormat>`.
pub(crate) const BIT_GRADIENT_FILL: u32 = 1 << 25;
/// Bit for `borders`: `Option<CellBorders>`.
pub(crate) const BIT_BORDERS: u32 = 1 << 26;
/// Bit for `locked`: `Option<bool>`.
pub(crate) const BIT_LOCKED: u32 = 1 << 27;
/// Bit for `hidden`: `Option<bool>`.
pub(crate) const BIT_HIDDEN: u32 = 1 << 28;

/// Palette header size: `u16` `start_index` + `u16` `format_count` + `u32` `string_pool_bytes`.
const PALETTE_HEADER_SIZE: usize = 8;

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

// ---------------------------------------------------------------------------
// String pool builder (interning)
// ---------------------------------------------------------------------------

struct StringPool {
    /// Maps string content to (offset, length) in the pool.
    index: HashMap<String, (u32, u16)>,
    /// Raw UTF-8 bytes.
    bytes: Vec<u8>,
}

impl StringPool {
    fn new() -> Self {
        Self {
            index: HashMap::new(),
            bytes: Vec::new(),
        }
    }

    /// Intern a string, returning its (offset, length) `StrRef`.
    fn intern(&mut self, s: &str) -> (u32, u16) {
        if let Some(&entry) = self.index.get(s) {
            return entry;
        }
        #[allow(clippy::cast_possible_truncation)]
        let offset = self.bytes.len() as u32;
        #[allow(clippy::cast_possible_truncation)]
        let length = s.len() as u16;
        self.bytes.extend_from_slice(s.as_bytes());
        let entry = (offset, length);
        self.index.insert(s.to_owned(), entry);
        entry
    }

    /// Consume the pool and return the raw bytes.
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/// Write a `StrRef` (`u32` offset + `u16` length) to `buf`.
fn write_str_ref(buf: &mut Vec<u8>, offset: u32, length: u16) {
    buf.extend_from_slice(&offset.to_le_bytes());
    buf.extend_from_slice(&length.to_le_bytes());
}

/// Intern a string and write its `StrRef` to `buf`.
fn write_string(buf: &mut Vec<u8>, s: &str, pool: &mut StringPool) {
    let (offset, length) = pool.intern(s);
    write_str_ref(buf, offset, length);
}

fn write_bool(buf: &mut Vec<u8>, v: bool) {
    buf.push(u8::from(v));
}

fn write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_i32(buf: &mut Vec<u8>, v: i32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_f64(buf: &mut Vec<u8>, v: f64) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

/// Build presence mask for a [`CellFormat`].
fn build_presence(fmt: &CellFormat) -> u32 {
    let mut mask: u32 = 0;
    if fmt.font_family.is_some() {
        mask |= BIT_FONT_FAMILY;
    }
    if fmt.font_size.is_some() {
        mask |= BIT_FONT_SIZE;
    }
    if fmt.font_color.is_some() {
        mask |= BIT_FONT_COLOR;
    }
    if fmt.bold.is_some() {
        mask |= BIT_BOLD;
    }
    if fmt.italic.is_some() {
        mask |= BIT_ITALIC;
    }
    if fmt.underline_type.is_some() {
        mask |= BIT_UNDERLINE_TYPE;
    }
    if fmt.strikethrough.is_some() {
        mask |= BIT_STRIKETHROUGH;
    }
    if fmt.superscript.is_some() {
        mask |= BIT_SUPERSCRIPT;
    }
    if fmt.subscript.is_some() {
        mask |= BIT_SUBSCRIPT;
    }
    if fmt.font_outline.is_some() {
        mask |= BIT_FONT_OUTLINE;
    }
    if fmt.font_shadow.is_some() {
        mask |= BIT_FONT_SHADOW;
    }
    if fmt.font_theme.is_some() {
        mask |= BIT_FONT_THEME;
    }
    if fmt.font_charset.is_some() {
        mask |= BIT_FONT_CHARSET;
    }
    if fmt.font_family_type.is_some() {
        mask |= BIT_FONT_FAMILY_TYPE;
    }
    if fmt.horizontal_align.is_some() {
        mask |= BIT_HORIZONTAL_ALIGN;
    }
    if fmt.vertical_align.is_some() {
        mask |= BIT_VERTICAL_ALIGN;
    }
    if fmt.wrap_text.is_some() {
        mask |= BIT_WRAP_TEXT;
    }
    if fmt.indent.is_some() {
        mask |= BIT_INDENT;
    }
    if fmt.text_rotation.is_some() {
        mask |= BIT_TEXT_ROTATION;
    }
    if fmt.shrink_to_fit.is_some() {
        mask |= BIT_SHRINK_TO_FIT;
    }
    if fmt.reading_order.is_some() {
        mask |= BIT_READING_ORDER;
    }
    if fmt.number_format.is_some() {
        mask |= BIT_NUMBER_FORMAT;
    }
    if fmt.background_color.is_some() {
        mask |= BIT_BACKGROUND_COLOR;
    }
    if fmt.pattern_type.is_some() {
        mask |= BIT_PATTERN_TYPE;
    }
    if fmt.pattern_foreground_color.is_some() {
        mask |= BIT_PATTERN_FG_COLOR;
    }
    if fmt.gradient_fill.is_some() {
        mask |= BIT_GRADIENT_FILL;
    }
    if fmt.borders.is_some() {
        mask |= BIT_BORDERS;
    }
    if fmt.locked.is_some() {
        mask |= BIT_LOCKED;
    }
    if fmt.hidden.is_some() {
        mask |= BIT_HIDDEN;
    }
    mask
}

/// Write a single [`CellFormat`] as a `FormatRecord`.
fn write_format_record(fmt: &CellFormat, buf: &mut Vec<u8>, pool: &mut StringPool) {
    let mask = build_presence(fmt);
    write_u32(buf, mask);

    // Fields in bit order — only present fields are written.
    if let Some(ref s) = fmt.font_family {
        write_string(buf, s, pool);
    }
    if let Some(fs) = fmt.font_size {
        write_u32(buf, fs.millipoints());
    }
    if let Some(ref s) = fmt.font_color {
        write_string(buf, s, pool);
    }
    if let Some(v) = fmt.bold {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.italic {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.underline_type {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(v) = fmt.strikethrough {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.superscript {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.subscript {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.font_outline {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.font_shadow {
        write_bool(buf, v);
    }
    if let Some(ref s) = fmt.font_theme {
        write_string(buf, s, pool);
    }
    if let Some(v) = fmt.font_charset {
        write_u32(buf, v);
    }
    if let Some(v) = fmt.font_family_type {
        write_u32(buf, v);
    }
    if let Some(v) = fmt.horizontal_align {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(v) = fmt.vertical_align {
        write_string(buf, v.to_kernel_token(), pool);
    }
    if let Some(v) = fmt.wrap_text {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.indent {
        write_u32(buf, v);
    }
    if let Some(v) = fmt.text_rotation {
        write_i32(buf, v);
    }
    if let Some(v) = fmt.shrink_to_fit {
        write_bool(buf, v);
    }
    if let Some(ref s) = fmt.reading_order {
        write_string(buf, s, pool);
    }
    if let Some(ref s) = fmt.number_format {
        write_string(buf, s, pool);
    }
    if let Some(ref s) = fmt.background_color {
        write_string(buf, s, pool);
    }
    if let Some(v) = fmt.pattern_type {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(ref s) = fmt.pattern_foreground_color {
        write_string(buf, s, pool);
    }
    if let Some(ref gf) = fmt.gradient_fill {
        write_gradient_fill(buf, gf, pool);
    }
    if let Some(ref b) = fmt.borders {
        write_borders(buf, b, pool);
    }
    if let Some(v) = fmt.locked {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.hidden {
        write_bool(buf, v);
    }
}

/// Write a `GradientFillRecord`.
fn write_gradient_fill(buf: &mut Vec<u8>, gf: &GradientFillFormat, pool: &mut StringPool) {
    // gradient_type — always present
    write_string(buf, &gf.gradient_type, pool);

    // sub_presence byte
    let mut sub: u8 = 0;
    if gf.degree.is_some() {
        sub |= 1;
    }
    if gf.center.is_some() {
        sub |= 2;
    }
    buf.push(sub);

    if let Some(deg) = gf.degree {
        write_f64(buf, deg);
    }
    if let Some(ref center) = gf.center {
        write_f64(buf, center.left);
        write_f64(buf, center.top);
    }

    // stops
    #[allow(clippy::cast_possible_truncation)]
    let stop_count = gf.stops.len() as u16;
    write_u16(buf, stop_count);
    for stop in &gf.stops {
        write_f64(buf, stop.position);
        write_string(buf, &stop.color, pool);
    }
}

/// Write a `BordersRecord`.
fn write_borders(buf: &mut Vec<u8>, b: &CellBorders, pool: &mut StringPool) {
    let mut presence: u16 = 0;
    if b.top.is_some() {
        presence |= 1 << 0;
    }
    if b.right.is_some() {
        presence |= 1 << 1;
    }
    if b.bottom.is_some() {
        presence |= 1 << 2;
    }
    if b.left.is_some() {
        presence |= 1 << 3;
    }
    if b.diagonal.is_some() {
        presence |= 1 << 4;
    }
    if b.diagonal_up.is_some() {
        presence |= 1 << 5;
    }
    if b.diagonal_down.is_some() {
        presence |= 1 << 6;
    }
    if b.vertical.is_some() {
        presence |= 1 << 7;
    }
    if b.horizontal.is_some() {
        presence |= 1 << 8;
    }
    if b.outline.is_some() {
        presence |= 1 << 9;
    }
    write_u16(buf, presence);

    // Fields in bit order.
    if let Some(ref side) = b.top {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.right {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.bottom {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.left {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.diagonal {
        write_border_side(buf, side, pool);
    }
    if let Some(v) = b.diagonal_up {
        write_bool(buf, v);
    }
    if let Some(v) = b.diagonal_down {
        write_bool(buf, v);
    }
    if let Some(ref side) = b.vertical {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.horizontal {
        write_border_side(buf, side, pool);
    }
    if let Some(v) = b.outline {
        write_bool(buf, v);
    }
}

/// Write a [`CellBorderSide`].
fn write_border_side(buf: &mut Vec<u8>, side: &CellBorderSide, pool: &mut StringPool) {
    let mut sp: u8 = 0;
    if side.style.is_some() {
        sp |= 1;
    }
    if side.color.is_some() {
        sp |= 2;
    }
    buf.push(sp);
    if let Some(v) = side.style {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(ref s) = side.color {
        write_string(buf, s, pool);
    }
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

// ---------------------------------------------------------------------------
// Read cursor
// ---------------------------------------------------------------------------

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    fn need(&self, n: usize, context: &'static str) -> Result<(), PaletteBinaryError> {
        if self.remaining() < n {
            Err(PaletteBinaryError::BufferTooShort {
                context,
                needed: n,
                available: self.remaining(),
            })
        } else {
            Ok(())
        }
    }

    fn read_u8(&mut self, context: &'static str) -> Result<u8, PaletteBinaryError> {
        self.need(1, context)?;
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn read_u16(&mut self, context: &'static str) -> Result<u16, PaletteBinaryError> {
        self.need(2, context)?;
        let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    fn read_u32(&mut self, context: &'static str) -> Result<u32, PaletteBinaryError> {
        self.need(4, context)?;
        // SAFETY: `need(N)` above guarantees `data[pos..pos+N]` has exactly N bytes.
        let bytes: [u8; 4] = self.data[self.pos..self.pos + 4].try_into().unwrap();
        let v = u32::from_le_bytes(bytes);
        self.pos += 4;
        Ok(v)
    }

    fn read_i32(&mut self, context: &'static str) -> Result<i32, PaletteBinaryError> {
        self.need(4, context)?;
        // SAFETY: `need(N)` above guarantees `data[pos..pos+N]` has exactly N bytes.
        let bytes: [u8; 4] = self.data[self.pos..self.pos + 4].try_into().unwrap();
        let v = i32::from_le_bytes(bytes);
        self.pos += 4;
        Ok(v)
    }

    fn read_f64(&mut self, context: &'static str) -> Result<f64, PaletteBinaryError> {
        self.need(8, context)?;
        // SAFETY: `need(N)` above guarantees `data[pos..pos+N]` has exactly N bytes.
        let bytes: [u8; 8] = self.data[self.pos..self.pos + 8].try_into().unwrap();
        let v = f64::from_le_bytes(bytes);
        self.pos += 8;
        Ok(v)
    }

    fn read_bool(&mut self, context: &'static str) -> Result<bool, PaletteBinaryError> {
        Ok(self.read_u8(context)? != 0)
    }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/// Read a `StrRef` and resolve it against the string pool.
fn read_string(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
    context: &'static str,
) -> Result<String, PaletteBinaryError> {
    let offset = cursor.read_u32(context)?;
    let length = cursor.read_u16(context)?;

    let end = offset as usize + length as usize;
    if end > pool_size as usize {
        return Err(PaletteBinaryError::InvalidStringRef {
            offset,
            length,
            pool_size,
        });
    }

    let slice = &pool[offset as usize..end];
    std::str::from_utf8(slice)
        .map(str::to_owned)
        .map_err(|_| PaletteBinaryError::InvalidUtf8 { offset, length })
}

/// Read a single `FormatRecord` and return a [`CellFormat`].
// Linear sequential decode of all format fields — splitting would not improve clarity.
#[allow(clippy::too_many_lines)]
fn read_format_record(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<CellFormat, PaletteBinaryError> {
    let mask = cursor.read_u32("format record presence mask")?;

    let font_family = if mask & BIT_FONT_FAMILY != 0 {
        Some(read_string(cursor, pool, pool_size, "font_family")?)
    } else {
        None
    };
    let font_size = if mask & BIT_FONT_SIZE != 0 {
        Some(FontSize::from_millipoints(cursor.read_u32("font_size")?))
    } else {
        None
    };
    let font_color = if mask & BIT_FONT_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "font_color")?)
    } else {
        None
    };
    let bold = if mask & BIT_BOLD != 0 {
        Some(cursor.read_bool("bold")?)
    } else {
        None
    };
    let italic = if mask & BIT_ITALIC != 0 {
        Some(cursor.read_bool("italic")?)
    } else {
        None
    };
    let underline_type = if mask & BIT_UNDERLINE_TYPE != 0 {
        let s = read_string(cursor, pool, pool_size, "underline_type")?;
        ooxml_types::styles::UnderlineStyle::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown UnderlineStyle in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let strikethrough = if mask & BIT_STRIKETHROUGH != 0 {
        Some(cursor.read_bool("strikethrough")?)
    } else {
        None
    };
    let superscript = if mask & BIT_SUPERSCRIPT != 0 {
        Some(cursor.read_bool("superscript")?)
    } else {
        None
    };
    let subscript = if mask & BIT_SUBSCRIPT != 0 {
        Some(cursor.read_bool("subscript")?)
    } else {
        None
    };
    let font_outline = if mask & BIT_FONT_OUTLINE != 0 {
        Some(cursor.read_bool("font_outline")?)
    } else {
        None
    };
    let font_shadow = if mask & BIT_FONT_SHADOW != 0 {
        Some(cursor.read_bool("font_shadow")?)
    } else {
        None
    };
    let font_theme = if mask & BIT_FONT_THEME != 0 {
        Some(read_string(cursor, pool, pool_size, "font_theme")?)
    } else {
        None
    };
    let font_charset = if mask & BIT_FONT_CHARSET != 0 {
        Some(cursor.read_u32("font_charset")?)
    } else {
        None
    };
    let font_family_type = if mask & BIT_FONT_FAMILY_TYPE != 0 {
        Some(cursor.read_u32("font_family_type")?)
    } else {
        None
    };
    let horizontal_align = if mask & BIT_HORIZONTAL_ALIGN != 0 {
        let s = read_string(cursor, pool, pool_size, "horizontal_align")?;
        ooxml_types::styles::HorizontalAlign::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown HorizontalAlign in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let vertical_align = if mask & BIT_VERTICAL_ALIGN != 0 {
        let s = read_string(cursor, pool, pool_size, "vertical_align")?;
        domain_types::CellVerticalAlign::from_kernel_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown CellVerticalAlign in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let wrap_text = if mask & BIT_WRAP_TEXT != 0 {
        Some(cursor.read_bool("wrap_text")?)
    } else {
        None
    };
    let indent = if mask & BIT_INDENT != 0 {
        Some(cursor.read_u32("indent")?)
    } else {
        None
    };
    let text_rotation = if mask & BIT_TEXT_ROTATION != 0 {
        Some(cursor.read_i32("text_rotation")?)
    } else {
        None
    };
    let shrink_to_fit = if mask & BIT_SHRINK_TO_FIT != 0 {
        Some(cursor.read_bool("shrink_to_fit")?)
    } else {
        None
    };
    let reading_order = if mask & BIT_READING_ORDER != 0 {
        Some(read_string(cursor, pool, pool_size, "reading_order")?)
    } else {
        None
    };
    let number_format = if mask & BIT_NUMBER_FORMAT != 0 {
        Some(read_string(cursor, pool, pool_size, "number_format")?)
    } else {
        None
    };
    let background_color = if mask & BIT_BACKGROUND_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "background_color")?)
    } else {
        None
    };
    let pattern_type = if mask & BIT_PATTERN_TYPE != 0 {
        let s = read_string(cursor, pool, pool_size, "pattern_type")?;
        ooxml_types::styles::PatternType::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown PatternType in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let pattern_foreground_color = if mask & BIT_PATTERN_FG_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "pattern_fg_color")?)
    } else {
        None
    };
    let gradient_fill = if mask & BIT_GRADIENT_FILL != 0 {
        Some(read_gradient_fill(cursor, pool, pool_size)?)
    } else {
        None
    };
    let borders = if mask & BIT_BORDERS != 0 {
        Some(read_borders(cursor, pool, pool_size)?)
    } else {
        None
    };
    let locked = if mask & BIT_LOCKED != 0 {
        Some(cursor.read_bool("locked")?)
    } else {
        None
    };
    let hidden = if mask & BIT_HIDDEN != 0 {
        Some(cursor.read_bool("hidden")?)
    } else {
        None
    };

    Ok(CellFormat {
        font_family,
        font_size,
        font_color,
        bold,
        italic,
        underline_type,
        strikethrough,
        superscript,
        subscript,
        font_outline,
        font_shadow,
        font_theme,
        font_charset,
        font_family_type,
        horizontal_align,
        vertical_align,
        wrap_text,
        indent,
        text_rotation,
        shrink_to_fit,
        reading_order,
        number_format,
        background_color,
        pattern_type,
        pattern_foreground_color,
        gradient_fill,
        borders,
        locked,
        hidden,
        // quote_prefix is not part of the binary wire format.
        quote_prefix: None,
        // tint / auto-indent fields are not part of the binary wire format.
        font_color_tint: None,
        auto_indent: None,
        background_color_tint: None,
        pattern_foreground_color_tint: None,
    })
}

/// Read a `GradientFillRecord`.
fn read_gradient_fill(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<GradientFillFormat, PaletteBinaryError> {
    let gradient_type = read_string(cursor, pool, pool_size, "gradient_type")?;

    let sub = cursor.read_u8("gradient sub_presence")?;

    let degree = if sub & 1 != 0 {
        Some(cursor.read_f64("gradient degree")?)
    } else {
        None
    };

    let center = if sub & 2 != 0 {
        let left = cursor.read_f64("gradient center left")?;
        let top = cursor.read_f64("gradient center top")?;
        Some(GradientCenter { left, top })
    } else {
        None
    };

    let stop_count = cursor.read_u16("gradient stop_count")?;
    let mut stops = Vec::with_capacity(stop_count as usize);
    for _ in 0..stop_count {
        let position = cursor.read_f64("gradient stop position")?;
        let color = read_string(cursor, pool, pool_size, "gradient stop color")?;
        stops.push(GradientStopFormat { position, color });
    }

    Ok(GradientFillFormat {
        gradient_type,
        degree,
        center,
        stops,
    })
}

/// Read a `BordersRecord`.
fn read_borders(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<CellBorders, PaletteBinaryError> {
    let presence = cursor.read_u16("borders presence")?;

    let top = if presence & (1 << 0) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let right = if presence & (1 << 1) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let bottom = if presence & (1 << 2) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let left = if presence & (1 << 3) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let diagonal = if presence & (1 << 4) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let diagonal_up = if presence & (1 << 5) != 0 {
        Some(cursor.read_bool("diagonal_up")?)
    } else {
        None
    };
    let diagonal_down = if presence & (1 << 6) != 0 {
        Some(cursor.read_bool("diagonal_down")?)
    } else {
        None
    };
    let vertical = if presence & (1 << 7) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let horizontal = if presence & (1 << 8) != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let outline = if presence & (1 << 9) != 0 {
        Some(cursor.read_bool("outline")?)
    } else {
        None
    };

    Ok(CellBorders {
        top,
        right,
        bottom,
        left,
        diagonal,
        diagonal_up,
        diagonal_down,
        vertical,
        horizontal,
        outline,
    })
}

/// Read a [`CellBorderSide`].
fn read_border_side(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<CellBorderSide, PaletteBinaryError> {
    let sp = cursor.read_u8("border side presence")?;

    let style = if sp & 1 != 0 {
        let s = read_string(cursor, pool, pool_size, "border style")?;
        ooxml_types::styles::BorderStyle::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown BorderStyle in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let color = if sp & 2 != 0 {
        Some(read_string(cursor, pool, pool_size, "border color")?)
    } else {
        None
    };

    Ok(CellBorderSide {
        style,
        color,
        color_tint: None,
    })
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: roundtrip serialize then deserialize, assert equality.
    fn roundtrip(formats: &[CellFormat], start_index: u16) -> Vec<CellFormat> {
        let bytes = serialize_palette_binary(formats, start_index);
        let (si, result) = deserialize_palette_binary(&bytes).expect("deserialize should succeed");
        assert_eq!(si, start_index);
        assert_eq!(result.len(), formats.len());
        result
    }

    #[test]
    fn empty_palette_roundtrip() {
        let result = roundtrip(&[], 0);
        assert!(result.is_empty());

        // Also check with non-zero start_index.
        let bytes = serialize_palette_binary(&[], 42);
        let (si, fmts) = deserialize_palette_binary(&bytes).unwrap();
        assert_eq!(si, 42);
        assert!(fmts.is_empty());
    }

    #[test]
    fn default_format_roundtrip() {
        let formats = vec![CellFormat::default()];
        let result = roundtrip(&formats, 0);
        assert_eq!(result[0], CellFormat::default());

        // Verify the binary is minimal: header (8) + presence u32 (4) + pool (0) = 12
        let bytes = serialize_palette_binary(&formats, 0);
        assert_eq!(bytes.len(), 12);
    }

    #[test]
    fn fully_populated_roundtrip() {
        let fmt = CellFormat {
            font_family: Some("Calibri".into()),
            font_size: Some(FontSize::from_millipoints(11000)),
            font_color: Some("#000000".into()),
            bold: Some(true),
            italic: Some(false),
            underline_type: Some(ooxml_types::styles::UnderlineStyle::Single),
            strikethrough: Some(false),
            superscript: Some(false),
            subscript: Some(false),
            font_outline: Some(true),
            font_shadow: Some(false),
            font_theme: Some("minor".into()),
            font_charset: Some(0),
            font_family_type: Some(2),
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Left),
            vertical_align: Some(domain_types::CellVerticalAlign::Top),
            wrap_text: Some(true),
            indent: Some(1),
            text_rotation: Some(-45),
            shrink_to_fit: Some(false),
            reading_order: Some("context".into()),
            number_format: Some("0.00%".into()),
            background_color: Some("#FFFFFF".into()),
            pattern_type: Some(ooxml_types::styles::PatternType::Solid),
            pattern_foreground_color: Some("#EEEEEE".into()),
            gradient_fill: Some(GradientFillFormat {
                gradient_type: "linear".into(),
                degree: Some(90.0),
                center: Some(GradientCenter {
                    left: 0.5,
                    top: 0.5,
                }),
                stops: vec![
                    GradientStopFormat {
                        position: 0.0,
                        color: "#FF0000".into(),
                    },
                    GradientStopFormat {
                        position: 1.0,
                        color: "#0000FF".into(),
                    },
                ],
            }),
            borders: Some(CellBorders {
                top: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Thin),
                    color: Some("#000000".into()),
                    color_tint: None,
                }),
                right: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Medium),
                    color: Some("#FF0000".into()),
                    color_tint: None,
                }),
                bottom: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Thick),
                    color: None,
                    color_tint: None,
                }),
                left: Some(CellBorderSide {
                    style: None,
                    color: Some("#00FF00".into()),
                    color_tint: None,
                }),
                diagonal: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Dashed),
                    color: Some("#0000FF".into()),
                    color_tint: None,
                }),
                diagonal_up: Some(true),
                diagonal_down: Some(false),
                vertical: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Dotted),
                    color: None,
                    color_tint: None,
                }),
                horizontal: Some(CellBorderSide {
                    style: None,
                    color: None,
                    color_tint: None,
                }),
                outline: Some(true),
            }),
            locked: Some(true),
            hidden: Some(false),
            // quote_prefix is not wire-encoded; it round-trips as None.
            quote_prefix: None,
            // tint / auto-indent fields are not wire-encoded; they round-trip as None.
            font_color_tint: None,
            auto_indent: None,
            background_color_tint: None,
            pattern_foreground_color_tint: None,
        };

        let result = roundtrip(std::slice::from_ref(&fmt), 5);
        assert_eq!(result[0], fmt);
    }

    #[test]
    fn string_dedup_in_pool() {
        // Two formats with the same font_family should share pool bytes.
        let fmt1 = CellFormat {
            font_family: Some("Arial".into()),
            ..Default::default()
        };
        let fmt2 = CellFormat {
            font_family: Some("Arial".into()),
            bold: Some(true),
            ..Default::default()
        };

        let bytes = serialize_palette_binary(&[fmt1.clone(), fmt2.clone()], 0);

        // The string "Arial" (5 bytes) should appear exactly once in the pool.
        // Header (8) + record1 (4 mask + 6 strref) + record2 (4 mask + 6 strref + 1 bool) + pool
        // pool should be exactly 5 bytes ("Arial").
        let pool_size = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        assert_eq!(pool_size, 5, "pool should contain 'Arial' exactly once");

        // Verify roundtrip.
        let (_, result) = deserialize_palette_binary(&bytes).unwrap();
        assert_eq!(result[0], fmt1);
        assert_eq!(result[1], fmt2);
    }

    #[test]
    #[allow(clippy::float_cmp)] // Roundtrip of exact bit patterns — exact comparison is correct.
    fn gradient_fill_with_stops() {
        let fmt = CellFormat {
            gradient_fill: Some(GradientFillFormat {
                gradient_type: "path".into(),
                degree: None,
                center: Some(GradientCenter {
                    left: 0.25,
                    top: 0.75,
                }),
                stops: vec![
                    GradientStopFormat {
                        position: 0.0,
                        color: "#AAAAAA".into(),
                    },
                    GradientStopFormat {
                        position: 0.5,
                        color: "#BBBBBB".into(),
                    },
                    GradientStopFormat {
                        position: 1.0,
                        color: "#CCCCCC".into(),
                    },
                ],
            }),
            ..Default::default()
        };

        let result = roundtrip(std::slice::from_ref(&fmt), 0);
        let gf = result[0].gradient_fill.as_ref().unwrap();
        assert_eq!(gf.gradient_type, "path");
        assert_eq!(gf.degree, None);
        assert!(gf.center.is_some());
        let center = gf.center.as_ref().unwrap();
        assert_eq!(center.left, 0.25);
        assert_eq!(center.top, 0.75);
        assert_eq!(gf.stops.len(), 3);
        assert_eq!(gf.stops[0].color, "#AAAAAA");
        assert_eq!(gf.stops[2].position, 1.0);
    }

    #[test]
    fn full_borders_roundtrip() {
        let fmt = CellFormat {
            borders: Some(CellBorders {
                top: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Thin),
                    color: Some("#111111".into()),
                    color_tint: None,
                }),
                right: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Medium),
                    color: Some("#222222".into()),
                    color_tint: None,
                }),
                bottom: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Thick),
                    color: Some("#333333".into()),
                    color_tint: None,
                }),
                left: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Double),
                    color: Some("#444444".into()),
                    color_tint: None,
                }),
                diagonal: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Dashed),
                    color: Some("#555555".into()),
                    color_tint: None,
                }),
                diagonal_up: Some(true),
                diagonal_down: Some(true),
                vertical: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Dotted),
                    color: Some("#666666".into()),
                    color_tint: None,
                }),
                horizontal: Some(CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Hair),
                    color: Some("#777777".into()),
                    color_tint: None,
                }),
                outline: Some(false),
            }),
            ..Default::default()
        };

        let result = roundtrip(std::slice::from_ref(&fmt), 0);
        assert_eq!(result[0], fmt);
    }

    #[test]
    fn partial_border_side() {
        use ooxml_types::styles::BorderStyle;
        // Style only
        let style_only = CellBorderSide {
            style: Some(BorderStyle::Thin),
            color: None,
            color_tint: None,
        };
        // Color only
        let color_only = CellBorderSide {
            style: None,
            color: Some("#ABCDEF".into()),
            color_tint: None,
        };
        // Both
        let both = CellBorderSide {
            style: Some(BorderStyle::Medium),
            color: Some("#123456".into()),
            color_tint: None,
        };

        let fmt = CellFormat {
            borders: Some(CellBorders {
                top: Some(style_only.clone()),
                right: Some(color_only.clone()),
                bottom: Some(both.clone()),
                ..Default::default()
            }),
            ..Default::default()
        };

        let result = roundtrip(&[fmt], 0);
        let borders = result[0].borders.as_ref().unwrap();
        assert_eq!(borders.top.as_ref().unwrap().style, Some(BorderStyle::Thin));
        assert_eq!(borders.top.as_ref().unwrap().color, None);
        assert_eq!(borders.right.as_ref().unwrap().style, None);
        assert_eq!(
            borders.right.as_ref().unwrap().color,
            Some("#ABCDEF".into())
        );
        assert_eq!(
            borders.bottom.as_ref().unwrap().style,
            Some(BorderStyle::Medium)
        );
        assert_eq!(
            borders.bottom.as_ref().unwrap().color,
            Some("#123456".into())
        );
        assert!(borders.left.is_none());
    }

    #[test]
    fn large_palette() {
        let formats: Vec<CellFormat> = (0..1000u32)
            .map(|i| CellFormat {
                font_family: Some(format!("Font{}", i % 50)),
                font_size: Some(FontSize::from_millipoints(8000 + i * 100)),
                bold: if i % 3 == 0 { Some(true) } else { None },
                font_color: if i % 5 == 0 {
                    Some(format!("#{:06X}", i * 257))
                } else {
                    None
                },
                number_format: if i % 7 == 0 {
                    Some("0.00".into())
                } else {
                    None
                },
                ..Default::default()
            })
            .collect();

        let bytes = serialize_palette_binary(&formats, 100);
        let (si, result) = deserialize_palette_binary(&bytes).unwrap();
        assert_eq!(si, 100);
        assert_eq!(result.len(), 1000);

        // Spot-check a few entries.
        for i in [0, 1, 42, 500, 999] {
            assert_eq!(result[i], formats[i], "mismatch at index {i}");
        }
    }

    #[test]
    fn truncated_buffer_returns_error() {
        let fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let bytes = serialize_palette_binary(&[fmt], 0);

        // Truncate to just the header.
        let result = deserialize_palette_binary(&bytes[..PALETTE_HEADER_SIZE]);
        assert!(result.is_err());
    }

    #[test]
    fn start_index_preserved() {
        let formats = vec![CellFormat {
            font_family: Some("Test".into()),
            ..Default::default()
        }];
        for si in [0u16, 1, 100, u16::MAX] {
            let bytes = serialize_palette_binary(&formats, si);
            let (got_si, _) = deserialize_palette_binary(&bytes).unwrap();
            assert_eq!(got_si, si);
        }
    }
}

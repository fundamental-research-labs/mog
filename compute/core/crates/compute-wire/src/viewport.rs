//! Binary serializer for viewport render data.
//!
//! Converts [`ViewportRenderData`] into a compact `Vec<u8>` following
//! the Viewport Binary Transfer Protocol. The resulting blob is sent
//! directly to the TypeScript renderer as a `Uint8Array`.
//!
//! # Wire Layout (all little-endian)
//!
//! ```text
//! [Header 36 B] [CellRecords N×32 B] [StringPool] [Merges M×16 B]
//! [RowDims R×12 B] [ColDims C×12 B] [FormatPalette(binary)]
//! [DataBars D×24 B] [Icons I×8 B]
//! [RowPositions R×8 B] [ColPositions C×8 B]
//! ```
//!
//! # Decomposition
//!
//! The serializer is split into focused helpers:
//! - `build_string_pool_and_records` — Step 1: string interning + cell record construction
//! - pass 2 now uses `palette_binary::serialize_palette_binary`
//! - `write_viewport_header` — Step 3: 36-byte header
//! - `write_cell_records` — Step 4: dense cell records
//! - `write_merge_records` — Step 5: merge regions
//! - `write_dimension_records` — Step 6: row/col dimensions
//! - `write_data_bar_entries` — Step 7: sparse data bar CF extras
//! - `write_icon_entries` — Step 8: sparse icon CF extras
//! - `write_position_arrays` — Step 9: row/col pixel positions

use std::collections::HashMap;

use crate::constants::{
    CELL_STRIDE, DATA_BAR_ENTRY_STRIDE, DIM_STRIDE, ICON_ENTRY_STRIDE, MERGE_STRIDE, NO_STRING,
    POSITION_ENTRY_SIZE, VIEWPORT_HEADER_SIZE as HEADER_SIZE, WIRE_VERSION,
};
use crate::flags as render_flags;
use crate::types::{
    DataBarRenderData, IconRenderData, RenderColDimension, RenderRowDimension, RenderViewportMerge,
    ViewportRenderCell, ViewportRenderData,
};

/// Cell record for viewport binary transfer (32 bytes).
///
/// # Wire Layout (little-endian byte offsets)
///
/// | Offset | Size | Field              |
/// |--------|------|--------------------|
/// | 0-7    | 8    | `f64 number_value` |
/// | 8-11   | 4    | `u32 display_off`  |
/// | 12-15  | 4    | `u32 error_off`    |
/// | 16-17  | 2    | `u16 flags`        |
/// | 18-19  | 2    | `u16 format_idx`   |
/// | 20-21  | 2    | `u16 display_len`  |
/// | 22-23  | 2    | `u16 error_len`    |
/// | 24-27  | 4    | `u32 bg_color_override`  |
/// | 28-31  | 4    | `u32 font_color_override` |
///
/// Serialized manually via `.to_le_bytes()` on each field (not via struct casting).
#[derive(Debug, Clone, Copy, Default)]
pub struct ViewportCellRecord {
    /// Numeric value (offset 0).
    pub number_value: f64,
    /// Byte offset into the string pool for the display string (offset 8).
    pub display_off: u32,
    /// Byte offset into the string pool for the error string (offset 12).
    pub error_off: u32,
    /// Bitfield flags (offset 16). See [`super::flags`].
    pub flags: u16,
    /// Index into the format palette (offset 18).
    pub format_idx: u16,
    /// Length of the display string in bytes (offset 20).
    pub display_len: u16,
    /// Length of the error string in bytes (offset 22).
    pub error_len: u16,
    /// Packed RGBA background color override (offset 24). 0 = no override.
    pub bg_color_override: u32,
    /// Packed RGBA font color override (offset 28). 0 = no override.
    pub font_color_override: u32,
}

// Compile-time size assertion — must match CELL_STRIDE (32 bytes).
const _: () = assert!(core::mem::size_of::<ViewportCellRecord>() == 32);

/// Header for viewport binary buffer (36 bytes).
///
/// Serialized manually via `.to_le_bytes()` on each field (not via struct casting).
#[derive(Debug, Clone, Copy, Default)]
pub struct ViewportHeader {
    /// Zero-based starting row of the viewport region.
    pub start_row: u32,
    /// Zero-based starting column of the viewport region.
    pub start_col: u32,
    /// Total number of cell records in the buffer.
    pub cell_count: u32,
    /// Length of the format palette JSON section in bytes.
    pub format_palette_len: u32,
    /// Total bytes in the string pool section.
    pub string_pool_bytes: u32,
    /// Number of rows in the viewport grid.
    pub viewport_rows: u16,
    /// Number of columns in the viewport grid.
    pub viewport_cols: u16,
    /// Number of merge records.
    pub merge_count: u16,
    /// Number of row dimension records.
    pub row_dim_count: u16,
    /// Number of column dimension records.
    pub col_dim_count: u16,
    /// Header flags (bit 0: `is_delta`; bits 4-7: [`WIRE_VERSION`]).
    pub flags: u8,
    /// Monotonic generation counter for stale-buffer detection.
    pub generation: u8,
    /// Number of data bar entries in the CF extras section.
    pub data_bar_count: u16,
    /// Number of icon entries in the CF extras section.
    pub icon_count: u16,
}

const _: () = assert!(core::mem::size_of::<ViewportHeader>() == 36);

// ---------------------------------------------------------------------------
// Step 1: Build string pool + cell records + CF extras
// ---------------------------------------------------------------------------

/// Intermediate result from [`build_string_pool_and_records`].
struct CellBuildResult<'a> {
    cell_records: Vec<ViewportCellRecord>,
    string_pool: Vec<u8>,
    data_bar_entries: Vec<(u32, &'a DataBarRenderData)>,
    icon_entries: Vec<(u32, &'a IconRenderData)>,
}

/// Iterate viewport cells, intern strings into a deduplicated byte pool, and
/// collect cell records plus sparse CF extras indices.
#[allow(clippy::cast_possible_truncation)] // string offsets bounded by pool size
fn build_string_pool_and_records(cells: &[ViewportRenderCell]) -> CellBuildResult<'_> {
    let estimated_pool = cells.len() * 12; // ~60% of cells have strings, ~20 bytes avg
    let mut pool = DedupStringPool::with_capacity(estimated_pool);
    let mut cell_records = Vec::with_capacity(cells.len());
    let mut data_bar_entries = Vec::new();
    let mut icon_entries = Vec::new();

    for (cell_idx, cell) in cells.iter().enumerate() {
        let mut flags = cell.flags;

        if let Some(ref extras) = cell.cf_extras {
            flags |= render_flags::HAS_CF_EXTRAS;
            if let Some(ref db) = extras.data_bar {
                data_bar_entries.push((cell_idx as u32, db));
            }
            if let Some(ref icon) = extras.icon {
                icon_entries.push((cell_idx as u32, icon));
            }
        }

        let (display_off, display_len) = pool.intern_optional(cell.formatted.as_deref());
        let (error_off, error_len) = pool.intern_optional(cell.error.as_deref());

        cell_records.push(ViewportCellRecord {
            number_value: cell.number_value,
            display_off,
            error_off,
            flags,
            format_idx: cell.format_idx,
            display_len,
            error_len,
            bg_color_override: cell.bg_color_override,
            font_color_override: cell.font_color_override,
        });
    }

    CellBuildResult {
        cell_records,
        string_pool: pool.into_bytes(),
        data_bar_entries,
        icon_entries,
    }
}

/// Deduplicated string pool for viewport and mutation binary serialization.
///
/// Tracks previously interned strings via a `HashMap` so identical strings
/// (e.g. "0.00", "TRUE", "#DIV/0!") are stored only once, returning the
/// existing `(offset, length)` on cache hits. Follows the same pattern as
/// [`crate::palette_binary::StringPool`].
pub(crate) struct DedupStringPool {
    /// Raw UTF-8 bytes backing the pool.
    pool: Vec<u8>,
    /// Maps string content → `(offset, length)` in the pool.
    index: HashMap<String, (u32, u16)>,
}

impl DedupStringPool {
    /// Create a new pool with an estimated initial capacity.
    pub(crate) fn with_capacity(estimated_bytes: usize) -> Self {
        Self {
            pool: Vec::with_capacity(estimated_bytes),
            index: HashMap::new(),
        }
    }

    /// Intern an optional string, returning `(offset, len)` or
    /// `(NO_STRING, 0)` if `None`.
    #[inline]
    pub(crate) fn intern_optional(&mut self, text: Option<&str>) -> (u32, u16) {
        match text {
            Some(s) => self.intern(s),
            None => (NO_STRING, 0),
        }
    }

    /// Intern a `&str`, returning `(offset, len)`.
    ///
    /// On cache hit, returns the existing offset+length without appending.
    /// Strings longer than `u16::MAX` bytes are truncated at a UTF-8 boundary.
    #[inline]
    #[allow(clippy::cast_possible_truncation)] // pool offset < 4 GB; len guarded below
    pub(crate) fn intern(&mut self, s: &str) -> (u32, u16) {
        if let Some(&entry) = self.index.get(s) {
            return entry;
        }
        let bytes = s.as_bytes();
        let truncated = if bytes.len() > u16::MAX as usize {
            let mut end = u16::MAX as usize;
            while end > 0 && !s.is_char_boundary(end) {
                end -= 1;
            }
            &bytes[..end]
        } else {
            bytes
        };
        let off = self.pool.len() as u32;
        let len = truncated.len() as u16;
        self.pool.extend_from_slice(truncated);
        let entry = (off, len);
        self.index.insert(s.to_owned(), entry);
        entry
    }

    /// Consume the pool, returning the raw byte buffer.
    pub(crate) fn into_bytes(self) -> Vec<u8> {
        self.pool
    }
}

/// Append an optional string to the pool. Returns `(offset, len)` or
/// `(NO_STRING, 0)` if `None`. Strings exceeding `u16::MAX` bytes are
/// truncated at a UTF-8 boundary.
///
/// Legacy non-dedup variant used by mutation paths that pass a raw `Vec<u8>`.
#[inline]
#[allow(clippy::cast_possible_truncation)] // pool offset < 4 GB, string < 64 KB
pub(crate) fn intern_optional_string(pool: &mut Vec<u8>, text: Option<&str>) -> (u32, u16) {
    match text {
        Some(s) => intern_str(pool, s),
        None => (NO_STRING, 0),
    }
}

/// Append a `&str` to the pool. Returns `(offset, len)`.
///
/// Legacy non-dedup variant used by mutation paths that pass a raw `Vec<u8>`.
/// Strings longer than `u16::MAX` bytes are truncated to `u16::MAX` bytes at
/// a UTF-8 character boundary.
#[inline]
#[allow(clippy::cast_possible_truncation)] // pool offset < 4 GB; len guarded below
pub(crate) fn intern_str(pool: &mut Vec<u8>, s: &str) -> (u32, u16) {
    let bytes = s.as_bytes();
    let truncated = if bytes.len() > u16::MAX as usize {
        let mut end = u16::MAX as usize;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &bytes[..end]
    } else {
        bytes
    };
    let off = pool.len() as u32;
    let len = truncated.len() as u16;
    pool.extend_from_slice(truncated);
    (off, len)
}

// ---------------------------------------------------------------------------
// Step 3: Write header (36 bytes)
// ---------------------------------------------------------------------------

/// Write a [`ViewportHeader`] as 36 little-endian bytes to `buf`.
fn write_viewport_header(buf: &mut Vec<u8>, header: &ViewportHeader) {
    buf.extend_from_slice(&header.start_row.to_le_bytes());
    buf.extend_from_slice(&header.start_col.to_le_bytes());
    buf.extend_from_slice(&header.cell_count.to_le_bytes());
    buf.extend_from_slice(&header.format_palette_len.to_le_bytes());
    buf.extend_from_slice(&header.string_pool_bytes.to_le_bytes());
    buf.extend_from_slice(&header.viewport_rows.to_le_bytes());
    buf.extend_from_slice(&header.viewport_cols.to_le_bytes());
    buf.extend_from_slice(&header.merge_count.to_le_bytes());
    buf.extend_from_slice(&header.row_dim_count.to_le_bytes());
    buf.extend_from_slice(&header.col_dim_count.to_le_bytes());
    buf.push(header.flags);
    buf.push(header.generation);
    buf.extend_from_slice(&header.data_bar_count.to_le_bytes());
    buf.extend_from_slice(&header.icon_count.to_le_bytes());

    debug_assert_eq!(buf.len(), HEADER_SIZE);
}

// ---------------------------------------------------------------------------
// Step 4: Write cell records
// ---------------------------------------------------------------------------

/// Write `N × 32`-byte cell records to `buf`.
///
/// Each record is assembled into a `[u8; CELL_STRIDE]` array first, then
/// written in a single `extend_from_slice` call per cell (1 call instead of 9).
fn write_cell_records(buf: &mut Vec<u8>, records: &[ViewportCellRecord]) {
    for r in records {
        let mut rec = [0u8; CELL_STRIDE];
        rec[0..8].copy_from_slice(&r.number_value.to_le_bytes());
        rec[8..12].copy_from_slice(&r.display_off.to_le_bytes());
        rec[12..16].copy_from_slice(&r.error_off.to_le_bytes());
        rec[16..18].copy_from_slice(&r.flags.to_le_bytes());
        rec[18..20].copy_from_slice(&r.format_idx.to_le_bytes());
        rec[20..22].copy_from_slice(&r.display_len.to_le_bytes());
        rec[22..24].copy_from_slice(&r.error_len.to_le_bytes());
        rec[24..28].copy_from_slice(&r.bg_color_override.to_le_bytes());
        rec[28..32].copy_from_slice(&r.font_color_override.to_le_bytes());
        buf.extend_from_slice(&rec);
    }
}

// ---------------------------------------------------------------------------
// Step 5: Write merge records
// ---------------------------------------------------------------------------

/// Write `M × 16`-byte merge records to `buf`.
fn write_merge_records(buf: &mut Vec<u8>, merges: &[RenderViewportMerge]) {
    for m in merges {
        buf.extend_from_slice(&m.start_row.to_le_bytes());
        buf.extend_from_slice(&m.start_col.to_le_bytes());
        buf.extend_from_slice(&m.end_row.to_le_bytes());
        buf.extend_from_slice(&m.end_col.to_le_bytes());
    }
}

// ---------------------------------------------------------------------------
// Step 6: Write dimension records
// ---------------------------------------------------------------------------

/// Write row dimension records (12 bytes each) to `buf`.
fn write_row_dimensions(buf: &mut Vec<u8>, dims: &[RenderRowDimension]) {
    for d in dims {
        buf.extend_from_slice(&d.row.to_le_bytes());
        buf.extend_from_slice(&d.height.to_le_bytes());
        buf.extend_from_slice(&u32::from(d.hidden).to_le_bytes());
    }
}

/// Write column dimension records (12 bytes each) to `buf`.
fn write_col_dimensions(buf: &mut Vec<u8>, dims: &[RenderColDimension]) {
    for d in dims {
        buf.extend_from_slice(&d.col.to_le_bytes());
        buf.extend_from_slice(&d.width.to_le_bytes());
        buf.extend_from_slice(&u32::from(d.hidden).to_le_bytes());
    }
}

// ---------------------------------------------------------------------------
// Step 7: Write data bar entries
// ---------------------------------------------------------------------------

/// Write sparse data bar entries (24 bytes each) to `buf`.
fn write_data_bar_entries(buf: &mut Vec<u8>, entries: &[(u32, &DataBarRenderData)]) {
    for &(cell_index, db) in entries {
        buf.extend_from_slice(&cell_index.to_le_bytes());
        buf.extend_from_slice(&db.fill_percent.to_le_bytes());
        buf.extend_from_slice(&db.color.to_le_bytes());
        let flags: u32 = u32::from(db.gradient)
            | (u32::from(db.is_negative) << 1)
            | (u32::from(db.show_value) << 2)
            | (u32::from(db.show_axis) << 3);
        buf.extend_from_slice(&flags.to_le_bytes());
        buf.extend_from_slice(&db.axis_position.to_le_bytes());
        buf.extend_from_slice(&db.negative_color.to_le_bytes());
    }
}

// ---------------------------------------------------------------------------
// Step 8: Write icon entries
// ---------------------------------------------------------------------------

/// Write sparse icon entries (8 bytes each) to `buf`.
fn write_icon_entries(buf: &mut Vec<u8>, entries: &[(u32, &IconRenderData)]) {
    for &(cell_index, icon) in entries {
        buf.extend_from_slice(&cell_index.to_le_bytes());
        buf.push(icon.set_name_index);
        buf.push(icon.icon_index);
        buf.push(u8::from(icon.icon_only));
        buf.push(0u8); // padding
    }
}

// ---------------------------------------------------------------------------
// Step 9: Write position arrays
// ---------------------------------------------------------------------------

/// Write row and column pixel-position arrays (f64 LE each) to `buf`.
///
/// Batches every 32 f64 values (256 bytes) into a single `extend_from_slice`
/// call to reduce per-element overhead.
fn write_position_arrays(buf: &mut Vec<u8>, row_positions: &[f64], col_positions: &[f64]) {
    write_f64_array(buf, row_positions);
    write_f64_array(buf, col_positions);
}

/// Write an f64 slice as little-endian bytes, batching into chunks of 32 values.
fn write_f64_array(buf: &mut Vec<u8>, values: &[f64]) {
    const BATCH: usize = 32;
    let mut batch_buf = [0u8; BATCH * 8];
    let mut i = 0;
    while i + BATCH <= values.len() {
        for j in 0..BATCH {
            batch_buf[j * 8..(j + 1) * 8].copy_from_slice(&values[i + j].to_le_bytes());
        }
        buf.extend_from_slice(&batch_buf);
        i += BATCH;
    }
    // Remainder
    for &pos in &values[i..] {
        buf.extend_from_slice(&pos.to_le_bytes());
    }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Serialize viewport render data into a compact binary blob.
///
/// # Arguments
/// - `data` — The viewport render data produced by `build_viewport_render_data()`.
/// - `generation` — Monotonic counter so the consumer can detect stale buffers.
/// - `is_delta` — Whether this is a delta (incremental) response.
/// - `palette_start_index` — 0 for full responses; N for deltas (only new entries).
///
/// # Returns
/// A `Vec<u8>` containing the binary blob ready for transfer to TypeScript.
///
/// # Wire version
///
/// The header flags byte embeds [`WIRE_VERSION`] in bits 4-7. TypeScript
/// decoders should validate this matches before reading the buffer.
#[must_use]
#[allow(clippy::cast_possible_truncation)] // counts clamped to protocol bounds
pub fn serialize_viewport_binary(
    data: &ViewportRenderData,
    generation: u8,
    is_delta: bool,
    palette_start_index: u16,
) -> Vec<u8> {
    // Step 1: Build string pool, cell records, and CF extras indices.
    let build = build_string_pool_and_records(&data.cells);

    // Step 2: Serialize format palette as binary.
    let palette_bytes =
        crate::palette_binary::serialize_palette_binary(&data.format_palette, palette_start_index);

    // Step 3: Pre-calculate total size.
    let cell_count = build.cell_records.len();
    let total_size = HEADER_SIZE
        + cell_count * CELL_STRIDE
        + build.string_pool.len()
        + data.merges.len() * MERGE_STRIDE
        + data.row_dimensions.len() * DIM_STRIDE
        + data.col_dimensions.len() * DIM_STRIDE
        + palette_bytes.len()
        + build.data_bar_entries.len() * DATA_BAR_ENTRY_STRIDE
        + build.icon_entries.len() * ICON_ENTRY_STRIDE
        + data.row_positions.len() * POSITION_ENTRY_SIZE
        + data.col_positions.len() * POSITION_ENTRY_SIZE;

    debug_assert!(u32::try_from(cell_count).is_ok(), "cell count exceeds u32");
    debug_assert!(
        u16::try_from(data.merges.len()).is_ok(),
        "merge count exceeds u16"
    );
    debug_assert!(
        u16::try_from(data.row_dimensions.len()).is_ok(),
        "row dimension count exceeds u16"
    );
    debug_assert!(
        u16::try_from(data.col_dimensions.len()).is_ok(),
        "col dimension count exceeds u16"
    );
    debug_assert!(
        u32::try_from(palette_bytes.len()).is_ok(),
        "palette JSON exceeds u32"
    );
    debug_assert!(
        u32::try_from(build.string_pool.len()).is_ok(),
        "string pool exceeds u32"
    );
    debug_assert!(
        u16::try_from(build.data_bar_entries.len()).is_ok(),
        "data bar count exceeds u16"
    );
    debug_assert!(
        u16::try_from(build.icon_entries.len()).is_ok(),
        "icon count exceeds u16"
    );

    let mut buf = Vec::with_capacity(total_size);

    // Step 4: Header.
    let rows_u16 = data.viewport_rows.min(u32::from(u16::MAX)) as u16;
    let cols_u16 = data.viewport_cols.min(u32::from(u16::MAX)) as u16;
    write_viewport_header(
        &mut buf,
        &ViewportHeader {
            start_row: data.start_row,
            start_col: data.start_col,
            cell_count: cell_count as u32,
            format_palette_len: palette_bytes.len() as u32,
            string_pool_bytes: build.string_pool.len() as u32,
            viewport_rows: rows_u16,
            viewport_cols: cols_u16,
            merge_count: data.merges.len() as u16,
            row_dim_count: data.row_dimensions.len() as u16,
            col_dim_count: data.col_dimensions.len() as u16,
            flags: u8::from(is_delta) | (WIRE_VERSION << 4),
            generation,
            data_bar_count: build.data_bar_entries.len() as u16,
            icon_count: build.icon_entries.len() as u16,
        },
    );

    // Step 5: Cell records.
    write_cell_records(&mut buf, &build.cell_records);

    // Step 6: String pool.
    buf.extend_from_slice(&build.string_pool);

    // Step 7: Merge records.
    write_merge_records(&mut buf, &data.merges);

    // Steps 8-9: Row + column dimensions.
    write_row_dimensions(&mut buf, &data.row_dimensions);
    write_col_dimensions(&mut buf, &data.col_dimensions);

    // Step 10: Format palette JSON.
    buf.extend_from_slice(&palette_bytes);

    // Steps 11-12: CF extras (data bars + icons).
    write_data_bar_entries(&mut buf, &build.data_bar_entries);
    write_icon_entries(&mut buf, &build.icon_entries);

    // Pass 13: Position arrays.
    write_position_arrays(&mut buf, &data.row_positions, &data.col_positions);

    debug_assert_eq!(buf.len(), total_size);
    buf
}

#[cfg(test)]
#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod tests {
    use super::*;
    use crate::flags as render_flags;
    use crate::types::{
        CellCFExtras, DataBarRenderData, IconRenderData, RenderColDimension, RenderRowDimension,
        RenderViewportMerge, ViewportRenderCell,
    };
    use domain_types::CellFormat;

    fn make_test_data() -> ViewportRenderData {
        ViewportRenderData {
            cells: vec![
                ViewportRenderCell {
                    row: 0,
                    col: 0,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_NUMBER | render_flags::HAS_FORMULA,
                    number_value: 42.0,
                    formatted: Some("42".to_string()),
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                ViewportRenderCell {
                    row: 0,
                    col: 1,
                    format_idx: 1,
                    flags: render_flags::VALUE_TYPE_TEXT,
                    number_value: f64::NAN,
                    formatted: Some("Hello".to_string()),
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                ViewportRenderCell {
                    row: 1,
                    col: 0,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_ERROR,
                    number_value: f64::NAN,
                    formatted: None,
                    error: Some("#DIV/0!".to_string()),
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                ViewportRenderCell {
                    row: 1,
                    col: 1,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_NULL,
                    number_value: f64::NAN,
                    formatted: None,
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
            ],
            format_palette: vec![
                CellFormat::default(),
                CellFormat {
                    bold: Some(true),
                    ..Default::default()
                },
            ],
            merges: vec![RenderViewportMerge {
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 1,
            }],
            row_dimensions: vec![RenderRowDimension {
                row: 0,
                height: 20.0,
                hidden: false,
            }],
            col_dimensions: vec![RenderColDimension {
                col: 1,
                width: 100.5,
                hidden: true,
            }],
            viewport_rows: 2,
            viewport_cols: 2,
            start_row: 0,
            start_col: 0,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        }
    }

    #[test]
    fn test_serialized_size_matches_expected() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        // 36 header + 4*32 cells + string_pool + 1*16 merge + 1*12 row_dim + 1*12 col_dim + palette_binary
        let string_pool_len = "42".len() + "Hello".len() + "#DIV/0!".len(); // 2 + 5 + 7 = 14
        let expected_min = HEADER_SIZE + 4 * CELL_STRIDE + string_pool_len + 16 + 12 + 12;
        assert!(buf.len() > expected_min); // palette JSON adds variable bytes
    }

    #[test]
    fn test_header_fields_roundtrip() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 42, false, 0);
        // Read header fields back (little-endian)
        assert_eq!(u32::from_le_bytes(buf[0..4].try_into().unwrap()), 0); // start_row
        assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()), 0); // start_col
        assert_eq!(u32::from_le_bytes(buf[8..12].try_into().unwrap()), 4); // cell_count
        assert_eq!(u16::from_le_bytes(buf[20..22].try_into().unwrap()), 2); // viewport_rows
        assert_eq!(u16::from_le_bytes(buf[22..24].try_into().unwrap()), 2); // viewport_cols
        assert_eq!(u16::from_le_bytes(buf[24..26].try_into().unwrap()), 1); // merge_count
        assert_eq!(u16::from_le_bytes(buf[26..28].try_into().unwrap()), 1); // row_dim_count
        assert_eq!(u16::from_le_bytes(buf[28..30].try_into().unwrap()), 1); // col_dim_count
        assert_eq!(buf[30] & 0x01, 0); // not delta
        assert_eq!(buf[30] >> 4, WIRE_VERSION); // version in bits 4-7
        assert_eq!(buf[31], 42); // generation
        assert_eq!(u16::from_le_bytes(buf[32..34].try_into().unwrap()), 0); // data_bar_count
        assert_eq!(u16::from_le_bytes(buf[34..36].try_into().unwrap()), 0); // icon_count
    }

    #[test]
    fn test_cell_record_fields() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        // First cell record starts at HEADER_SIZE
        let off = HEADER_SIZE;
        let num = f64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
        assert_eq!(num, 42.0);
        let flags = u16::from_le_bytes(buf[off + 16..off + 18].try_into().unwrap());
        assert_eq!(flags & 0x7, render_flags::VALUE_TYPE_NUMBER);
        assert_ne!(flags & render_flags::HAS_FORMULA, 0);
        // Color overrides should be 0
        let bg = u32::from_le_bytes(buf[off + 24..off + 28].try_into().unwrap());
        let fg = u32::from_le_bytes(buf[off + 28..off + 32].try_into().unwrap());
        assert_eq!(bg, 0);
        assert_eq!(fg, 0);
    }

    #[test]
    fn test_string_pool_roundtrip() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let pool_start = HEADER_SIZE + cell_count * CELL_STRIDE;

        // First cell: display_off=0, display_len=2 ("42")
        let cell0 = HEADER_SIZE;
        let d_off = u32::from_le_bytes(buf[cell0 + 8..cell0 + 12].try_into().unwrap()) as usize;
        let d_len = u16::from_le_bytes(buf[cell0 + 20..cell0 + 22].try_into().unwrap()) as usize;
        let text =
            std::str::from_utf8(&buf[pool_start + d_off..pool_start + d_off + d_len]).unwrap();
        assert_eq!(text, "42");

        // Verify string pool byte count
        assert_eq!(string_pool_bytes, 14); // "42" + "Hello" + "#DIV/0!"
    }

    #[test]
    fn test_null_cell_has_no_string() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        // Fourth cell (index 3)
        let off = HEADER_SIZE + 3 * CELL_STRIDE;
        let d_off = u32::from_le_bytes(buf[off + 8..off + 12].try_into().unwrap());
        assert_eq!(d_off, 0xFFFF_FFFF); // NO_STRING sentinel
        let e_off = u32::from_le_bytes(buf[off + 12..off + 16].try_into().unwrap());
        assert_eq!(e_off, 0xFFFF_FFFF); // NO_STRING sentinel
    }

    #[test]
    fn test_is_delta_flag() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, true, 5);
        assert_eq!(buf[30] & 0x01, 1); // is_delta bit set
    }

    #[test]
    fn test_format_palette_binary_included() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
        assert!(palette_len > 0);
        // Extract palette bytes from the buffer and decode them
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
        let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
        let palette_start = HEADER_SIZE
            + cell_count * CELL_STRIDE
            + string_pool_bytes
            + merge_count * crate::constants::MERGE_STRIDE
            + row_dim_count * crate::constants::DIM_STRIDE
            + col_dim_count * crate::constants::DIM_STRIDE;
        let palette_bytes = &buf[palette_start..palette_start + palette_len];
        let (start_idx, formats) =
            crate::palette_binary::deserialize_palette_binary(palette_bytes).unwrap();
        assert_eq!(start_idx, 0);
        assert_eq!(formats.len(), 2);
    }

    #[test]
    fn test_delta_palette_start_index() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, true, 7);
        let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
        let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
        let palette_start = HEADER_SIZE
            + cell_count * CELL_STRIDE
            + string_pool_bytes
            + merge_count * crate::constants::MERGE_STRIDE
            + row_dim_count * crate::constants::DIM_STRIDE
            + col_dim_count * crate::constants::DIM_STRIDE;
        let palette_bytes = &buf[palette_start..palette_start + palette_len];
        let (start_idx, _formats) =
            crate::palette_binary::deserialize_palette_binary(palette_bytes).unwrap();
        assert_eq!(start_idx, 7);
    }

    #[test]
    fn test_merge_record_roundtrip() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_start = HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes;
        let sr = u32::from_le_bytes(buf[merge_start..merge_start + 4].try_into().unwrap());
        let sc = u32::from_le_bytes(buf[merge_start + 4..merge_start + 8].try_into().unwrap());
        let er = u32::from_le_bytes(buf[merge_start + 8..merge_start + 12].try_into().unwrap());
        let ec = u32::from_le_bytes(buf[merge_start + 12..merge_start + 16].try_into().unwrap());
        assert_eq!((sr, sc, er, ec), (0, 0, 1, 1));
    }

    #[test]
    fn test_row_dimension_roundtrip() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_start =
            HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes + merge_count * MERGE_STRIDE;
        let row = u32::from_le_bytes(buf[row_dim_start..row_dim_start + 4].try_into().unwrap());
        let height = f32::from_le_bytes(
            buf[row_dim_start + 4..row_dim_start + 8]
                .try_into()
                .unwrap(),
        );
        let flags = u32::from_le_bytes(
            buf[row_dim_start + 8..row_dim_start + 12]
                .try_into()
                .unwrap(),
        );
        assert_eq!(row, 0);
        assert_eq!(height, 20.0);
        assert_eq!(flags, 0); // not hidden
    }

    #[test]
    fn test_col_dimension_roundtrip() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
        let col_dim_start = HEADER_SIZE
            + cell_count * CELL_STRIDE
            + string_pool_bytes
            + merge_count * MERGE_STRIDE
            + row_dim_count * DIM_STRIDE;
        let col = u32::from_le_bytes(buf[col_dim_start..col_dim_start + 4].try_into().unwrap());
        let width = f32::from_le_bytes(
            buf[col_dim_start + 4..col_dim_start + 8]
                .try_into()
                .unwrap(),
        );
        let flags = u32::from_le_bytes(
            buf[col_dim_start + 8..col_dim_start + 12]
                .try_into()
                .unwrap(),
        );
        assert_eq!(col, 1);
        assert_eq!(width, 100.5);
        assert_eq!(flags, 1); // hidden
    }

    #[test]
    fn test_empty_viewport() {
        let data = ViewportRenderData {
            cells: vec![],
            format_palette: vec![],
            merges: vec![],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: 0,
            viewport_cols: 0,
            start_row: 5,
            start_col: 3,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        };
        let buf = serialize_viewport_binary(&data, 1, false, 0);
        assert_eq!(u32::from_le_bytes(buf[0..4].try_into().unwrap()), 5); // start_row
        assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()), 3); // start_col
        assert_eq!(u32::from_le_bytes(buf[8..12].try_into().unwrap()), 0); // cell_count
        assert_eq!(buf[31], 1); // generation
        // Should still have palette JSON at the end
        let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
        assert!(palette_len > 0);
    }

    #[test]
    fn test_error_cell_string_pool() {
        let data = make_test_data();
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let pool_start = HEADER_SIZE + cell_count * CELL_STRIDE;

        // Third cell (index 2)
        let off = HEADER_SIZE + 2 * CELL_STRIDE;
        // display_off should be NO_STRING (no formatted text)
        let d_off = u32::from_le_bytes(buf[off + 8..off + 12].try_into().unwrap());
        assert_eq!(d_off, NO_STRING);
        // error_off should point to "#DIV/0!" in the string pool
        let e_off = u32::from_le_bytes(buf[off + 12..off + 16].try_into().unwrap()) as usize;
        let e_len = u16::from_le_bytes(buf[off + 22..off + 24].try_into().unwrap()) as usize;
        let error_text =
            std::str::from_utf8(&buf[pool_start + e_off..pool_start + e_off + e_len]).unwrap();
        assert_eq!(error_text, "#DIV/0!");
    }

    #[test]
    fn test_cf_extras_data_bar_and_icon() {
        let mut data = make_test_data();
        // Add CF extras to the first cell (data bar + icon)
        data.cells[0].bg_color_override = 0xFF0000FF; // red bg
        data.cells[0].font_color_override = 0x00FF00FF; // green font
        data.cells[0].cf_extras = Some(CellCFExtras {
            data_bar: Some(DataBarRenderData {
                fill_percent: 0.75,
                color: 0x0000FFFF,
                is_negative: false,
                gradient: true,
                show_value: true,
                show_axis: true,
                axis_position: 0.5,
                negative_color: 0xFF000088,
            }),
            icon: Some(IconRenderData {
                set_name_index: 3,
                icon_index: 2,
                icon_only: true,
            }),
        });
        // Add icon-only CF extras to the second cell
        data.cells[1].cf_extras = Some(CellCFExtras {
            data_bar: None,
            icon: Some(IconRenderData {
                set_name_index: 1,
                icon_index: 0,
                icon_only: false,
            }),
        });

        let buf = serialize_viewport_binary(&data, 0, false, 0);

        // Header: data_bar_count and icon_count
        let db_count = u16::from_le_bytes(buf[32..34].try_into().unwrap());
        let icon_count = u16::from_le_bytes(buf[34..36].try_into().unwrap());
        assert_eq!(db_count, 1);
        assert_eq!(icon_count, 2);

        // Cell 0: verify color overrides in the cell record
        let c0 = HEADER_SIZE;
        let bg = u32::from_le_bytes(buf[c0 + 24..c0 + 28].try_into().unwrap());
        let fg = u32::from_le_bytes(buf[c0 + 28..c0 + 32].try_into().unwrap());
        assert_eq!(bg, 0xFF0000FF);
        assert_eq!(fg, 0x00FF00FF);

        // Cell 0: HAS_CF_EXTRAS flag should be set
        let flags0 = u16::from_le_bytes(buf[c0 + 16..c0 + 18].try_into().unwrap());
        assert_ne!(flags0 & render_flags::HAS_CF_EXTRAS, 0);

        // Cell 1: HAS_CF_EXTRAS flag should also be set
        let c1 = HEADER_SIZE + CELL_STRIDE;
        let flags1 = u16::from_le_bytes(buf[c1 + 16..c1 + 18].try_into().unwrap());
        assert_ne!(flags1 & render_flags::HAS_CF_EXTRAS, 0);

        // Locate data bar section: after palette JSON
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
        let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
        let db_start = HEADER_SIZE
            + cell_count * CELL_STRIDE
            + string_pool_bytes
            + merge_count * MERGE_STRIDE
            + row_dim_count * DIM_STRIDE
            + col_dim_count * DIM_STRIDE
            + palette_len;

        // Read data bar entry (24 bytes)
        let db_cell_idx = u32::from_le_bytes(buf[db_start..db_start + 4].try_into().unwrap());
        assert_eq!(db_cell_idx, 0); // cell index 0
        let fill = f32::from_le_bytes(buf[db_start + 4..db_start + 8].try_into().unwrap());
        assert_eq!(fill, 0.75);
        let db_color = u32::from_le_bytes(buf[db_start + 8..db_start + 12].try_into().unwrap());
        assert_eq!(db_color, 0x0000FFFF);
        let db_flags = u32::from_le_bytes(buf[db_start + 12..db_start + 16].try_into().unwrap());
        assert_eq!(db_flags & 0x1, 1); // gradient
        assert_eq!(db_flags & 0x2, 0); // not negative
        assert_eq!(db_flags & 0x4, 4); // show_value
        assert_eq!(db_flags & 0x8, 8); // show_axis
        let axis = f32::from_le_bytes(buf[db_start + 16..db_start + 20].try_into().unwrap());
        assert_eq!(axis, 0.5);
        let neg_color = u32::from_le_bytes(buf[db_start + 20..db_start + 24].try_into().unwrap());
        assert_eq!(neg_color, 0xFF000088);

        // Read icon entries (8 bytes each)
        let icon_start = db_start + DATA_BAR_ENTRY_STRIDE;
        // First icon (cell 0)
        let icon0_cell = u32::from_le_bytes(buf[icon_start..icon_start + 4].try_into().unwrap());
        assert_eq!(icon0_cell, 0);
        assert_eq!(buf[icon_start + 4], 3); // set_name_index
        assert_eq!(buf[icon_start + 5], 2); // icon_index
        assert_eq!(buf[icon_start + 6], 1); // icon_only = true
        assert_eq!(buf[icon_start + 7], 0); // padding

        // Second icon (cell 1)
        let icon1_start = icon_start + ICON_ENTRY_STRIDE;
        let icon1_cell = u32::from_le_bytes(buf[icon1_start..icon1_start + 4].try_into().unwrap());
        assert_eq!(icon1_cell, 1);
        assert_eq!(buf[icon1_start + 4], 1); // set_name_index
        assert_eq!(buf[icon1_start + 5], 0); // icon_index
        assert_eq!(buf[icon1_start + 6], 0); // icon_only = false
    }

    #[test]
    fn test_row_col_positions_roundtrip() {
        let mut cells = Vec::new();
        for r in 0..3u32 {
            for c in 0..3u32 {
                cells.push(ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_NULL,
                    number_value: f64::NAN,
                    formatted: None,
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                });
            }
        }
        let data = ViewportRenderData {
            cells,
            format_palette: vec![CellFormat::default()],
            merges: Vec::new(),
            row_dimensions: Vec::new(),
            col_dimensions: Vec::new(),
            viewport_rows: 3,
            viewport_cols: 3,
            start_row: 0,
            start_col: 0,
            // Length = viewport_rows + 1 (3 in-range entries + 1 trailing sentinel).
            row_positions: vec![0.0, 25.5, 51.0, 76.5],
            col_positions: vec![0.0, 80.0, 160.5, 240.5],
        };
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        // (R+1) + (C+1) entries, each 8 bytes.
        let row_pos_count = 4usize;
        let col_pos_count = 4usize;
        let positions_total = (row_pos_count + col_pos_count) * POSITION_ENTRY_SIZE;
        let pos_start = buf.len() - positions_total;

        // Read row positions (including trailing sentinel)
        for i in 0..row_pos_count {
            let off = pos_start + i * 8;
            let val = f64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
            assert_eq!(val, data.row_positions[i]);
        }
        // Read col positions (including trailing sentinel)
        for i in 0..col_pos_count {
            let off = pos_start + row_pos_count * 8 + i * 8;
            let val = f64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
            assert_eq!(val, data.col_positions[i]);
        }
    }

    #[test]
    fn test_boolean_cell_roundtrip() {
        let data = ViewportRenderData {
            cells: vec![ViewportRenderCell {
                row: 0,
                col: 0,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_BOOL,
                number_value: 1.0,
                formatted: Some("TRUE".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }],
            format_palette: vec![CellFormat::default()],
            merges: Vec::new(),
            row_dimensions: Vec::new(),
            col_dimensions: Vec::new(),
            viewport_rows: 1,
            viewport_cols: 1,
            start_row: 0,
            start_col: 0,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        };
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        // Read the cell record
        let c0 = HEADER_SIZE;
        let number_value = f64::from_le_bytes(buf[c0..c0 + 8].try_into().unwrap());
        assert_eq!(number_value, 1.0);
        let flags = u16::from_le_bytes(buf[c0 + 16..c0 + 18].try_into().unwrap());
        assert_eq!(
            flags & render_flags::VALUE_TYPE_MASK,
            render_flags::VALUE_TYPE_BOOL
        );
        // Display string should be "TRUE"
        let display_off = u32::from_le_bytes(buf[c0 + 8..c0 + 12].try_into().unwrap());
        let display_len = u16::from_le_bytes(buf[c0 + 20..c0 + 22].try_into().unwrap());
        assert_ne!(display_off, NO_STRING);
        assert_eq!(display_len, 4); // "TRUE".len()
        let pool_start = HEADER_SIZE + CELL_STRIDE;
        let display_str = std::str::from_utf8(
            &buf[pool_start + display_off as usize
                ..pool_start + display_off as usize + display_len as usize],
        )
        .unwrap();
        assert_eq!(display_str, "TRUE");
    }

    #[test]
    fn test_multiple_merges() {
        let mut data = make_test_data();
        data.merges = vec![
            RenderViewportMerge {
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 1,
            },
            RenderViewportMerge {
                start_row: 2,
                start_col: 3,
                end_row: 4,
                end_col: 5,
            },
            RenderViewportMerge {
                start_row: 10,
                start_col: 20,
                end_row: 15,
                end_col: 25,
            },
        ];
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap());
        assert_eq!(merge_count, 3);

        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_start = HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes;

        let expected = [(0u32, 0u32, 1u32, 1u32), (2, 3, 4, 5), (10, 20, 15, 25)];
        for (i, &(sr, sc, er, ec)) in expected.iter().enumerate() {
            let off = merge_start + i * MERGE_STRIDE;
            assert_eq!(
                u32::from_le_bytes(buf[off..off + 4].try_into().unwrap()),
                sr
            );
            assert_eq!(
                u32::from_le_bytes(buf[off + 4..off + 8].try_into().unwrap()),
                sc
            );
            assert_eq!(
                u32::from_le_bytes(buf[off + 8..off + 12].try_into().unwrap()),
                er
            );
            assert_eq!(
                u32::from_le_bytes(buf[off + 12..off + 16].try_into().unwrap()),
                ec
            );
        }
    }

    #[test]
    fn test_hidden_row_and_col_dimensions() {
        let mut data = make_test_data();
        data.row_dimensions = vec![
            RenderRowDimension {
                row: 0,
                height: 20.0,
                hidden: true,
            },
            RenderRowDimension {
                row: 1,
                height: 30.0,
                hidden: false,
            },
        ];
        data.col_dimensions = vec![
            RenderColDimension {
                col: 0,
                width: 80.0,
                hidden: false,
            },
            RenderColDimension {
                col: 1,
                width: 100.0,
                hidden: true,
            },
        ];
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_start =
            HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes + merge_count * MERGE_STRIDE;

        // Row 0: hidden=true → flags=1
        let flags0 = u32::from_le_bytes(
            buf[row_dim_start + 8..row_dim_start + 12]
                .try_into()
                .unwrap(),
        );
        assert_eq!(flags0, 1);
        // Row 1: hidden=false → flags=0
        let flags1 = u32::from_le_bytes(
            buf[row_dim_start + DIM_STRIDE + 8..row_dim_start + DIM_STRIDE + 12]
                .try_into()
                .unwrap(),
        );
        assert_eq!(flags1, 0);

        let col_dim_start = row_dim_start + 2 * DIM_STRIDE;
        // Col 0: hidden=false → flags=0
        let cflags0 = u32::from_le_bytes(
            buf[col_dim_start + 8..col_dim_start + 12]
                .try_into()
                .unwrap(),
        );
        assert_eq!(cflags0, 0);
        // Col 1: hidden=true → flags=1
        let cflags1 = u32::from_le_bytes(
            buf[col_dim_start + DIM_STRIDE + 8..col_dim_start + DIM_STRIDE + 12]
                .try_into()
                .unwrap(),
        );
        assert_eq!(cflags1, 1);
    }

    #[test]
    fn test_large_viewport_cell_count() {
        let mut cells = Vec::new();
        for r in 0..10u32 {
            for c in 0..10u32 {
                cells.push(ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_NULL,
                    number_value: f64::NAN,
                    formatted: None,
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                });
            }
        }
        let data = ViewportRenderData {
            cells,
            format_palette: vec![CellFormat::default()],
            merges: Vec::new(),
            row_dimensions: Vec::new(),
            col_dimensions: Vec::new(),
            viewport_rows: 10,
            viewport_cols: 10,
            start_row: 0,
            start_col: 0,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        };
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap());
        assert_eq!(cell_count, 100);
        // Verify cell section is exactly 100 * 32 bytes
        assert!(buf.len() >= HEADER_SIZE + 100 * CELL_STRIDE);
    }

    #[test]
    fn test_cell_with_all_flags_set() {
        let all_flags = render_flags::VALUE_TYPE_NUMBER
            | render_flags::HAS_FORMULA
            | render_flags::HAS_COMMENT
            | render_flags::HAS_SPARKLINE
            | render_flags::HAS_HYPERLINK
            | render_flags::IS_CHECKBOX
            | render_flags::IS_SPILL_MEMBER
            | render_flags::HAS_VALIDATION_ERROR;
        let data = ViewportRenderData {
            cells: vec![ViewportRenderCell {
                row: 0,
                col: 0,
                format_idx: 0,
                flags: all_flags,
                number_value: 99.0,
                formatted: Some("99".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }],
            format_palette: vec![CellFormat::default()],
            merges: Vec::new(),
            row_dimensions: Vec::new(),
            col_dimensions: Vec::new(),
            viewport_rows: 1,
            viewport_cols: 1,
            start_row: 0,
            start_col: 0,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        };
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        let c0 = HEADER_SIZE;
        let flags = u16::from_le_bytes(buf[c0 + 16..c0 + 18].try_into().unwrap());
        assert_eq!(flags, all_flags);
    }

    #[test]
    fn test_data_bar_negative() {
        let data = ViewportRenderData {
            cells: vec![ViewportRenderCell {
                row: 0,
                col: 0,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_NUMBER,
                number_value: -5.0,
                formatted: Some("-5".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: Some(CellCFExtras {
                    data_bar: Some(DataBarRenderData {
                        fill_percent: 0.3,
                        color: 0xFF0000FF,
                        is_negative: true,
                        gradient: false,
                        show_value: false,
                        show_axis: false,
                        axis_position: 0.0,
                        negative_color: 0x00FF00FF,
                    }),
                    icon: None,
                }),
            }],
            format_palette: vec![CellFormat::default()],
            merges: Vec::new(),
            row_dimensions: Vec::new(),
            col_dimensions: Vec::new(),
            viewport_rows: 1,
            viewport_cols: 1,
            start_row: 0,
            start_col: 0,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        };
        let buf = serialize_viewport_binary(&data, 0, false, 0);

        // Locate data bar section
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
        let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
        let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
        let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
        let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
        let db_start = HEADER_SIZE
            + cell_count * CELL_STRIDE
            + string_pool_bytes
            + merge_count * MERGE_STRIDE
            + row_dim_count * DIM_STRIDE
            + col_dim_count * DIM_STRIDE
            + palette_len;

        let db_flags = u32::from_le_bytes(buf[db_start + 12..db_start + 16].try_into().unwrap());
        // gradient=false(0), is_negative=true(1<<1=2), show_value=false(0), show_axis=false(0)
        assert_eq!(db_flags, 0x2);

        // Verify fill_percent and colors too
        let fill = f32::from_le_bytes(buf[db_start + 4..db_start + 8].try_into().unwrap());
        assert_eq!(fill, 0.3);
        let neg_color = u32::from_le_bytes(buf[db_start + 20..db_start + 24].try_into().unwrap());
        assert_eq!(neg_color, 0x00FF00FF);
    }

    #[test]
    fn test_viewport_nonzero_start() {
        let data = ViewportRenderData {
            cells: vec![ViewportRenderCell {
                row: 100,
                col: 50,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_NULL,
                number_value: f64::NAN,
                formatted: None,
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }],
            format_palette: vec![CellFormat::default()],
            merges: Vec::new(),
            row_dimensions: Vec::new(),
            col_dimensions: Vec::new(),
            viewport_rows: 1,
            viewport_cols: 1,
            start_row: 100,
            start_col: 50,
            row_positions: Vec::new(),
            col_positions: Vec::new(),
        };
        let buf = serialize_viewport_binary(&data, 7, true, 0);

        let start_row = u32::from_le_bytes(buf[0..4].try_into().unwrap());
        let start_col = u32::from_le_bytes(buf[4..8].try_into().unwrap());
        assert_eq!(start_row, 100);
        assert_eq!(start_col, 50);

        let flags_byte = buf[30];
        assert_eq!(flags_byte & 0x01, 1); // is_delta = true

        let generation = buf[31];
        assert_eq!(generation, 7);
    }

    /// Regression test: extreme viewport dimensions with few actual cells
    /// must not OOM. Previously, `cell_count = viewport_rows * viewport_cols`
    /// was used for pre-allocation, causing a 128GB allocation attempt.
    #[test]
    fn test_extreme_viewport_dims_no_oom() {
        let data = ViewportRenderData {
            cells: vec![],
            format_palette: vec![],
            merges: vec![],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: u32::MAX,
            viewport_cols: u32::MAX,
            start_row: 0,
            start_col: 0,
            row_positions: vec![],
            col_positions: vec![],
        };
        // Must complete without OOM. Header cell_count should be 0.
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap());
        assert_eq!(cell_count, 0);
    }
}

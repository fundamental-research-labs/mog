//! Wire record shapes for viewport serialization.

use crate::constants::{CELL_STRIDE, VIEWPORT_HEADER_SIZE};

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
    /// Bitfield flags (offset 16). See `crate::flags`.
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

const _: () = assert!(core::mem::size_of::<ViewportCellRecord>() == CELL_STRIDE);

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
    /// Header flags (bit 0: `is_delta`; bits 4-7: wire version).
    pub flags: u8,
    /// Monotonic generation counter for stale-buffer detection.
    pub generation: u8,
    /// Number of data bar entries in the CF extras section.
    pub data_bar_count: u16,
    /// Number of icon entries in the CF extras section.
    pub icon_count: u16,
}

const _: () = assert!(core::mem::size_of::<ViewportHeader>() == VIEWPORT_HEADER_SIZE);

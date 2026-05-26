//! Binary viewport rendering types.
//!
//! These types are built by the viewport render logic and consumed by the
//! binary serializer. They are NOT exposed through the bridge -- the binary
//! blob is the only wire format.

use domain_types::CellFormat;

/// Inclusive viewport bounds for filtering cells.
///
/// Defines the rectangular region `(start_row..=end_row, start_col..=end_col)`
/// that a viewport covers. Used by mutation serializers to filter patches
/// to only cells visible in a given viewport.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewportBounds {
    /// First visible row (inclusive).
    pub start_row: u32,
    /// First visible column (inclusive).
    pub start_col: u32,
    /// Last visible row (inclusive).
    pub end_row: u32,
    /// Last visible column (inclusive).
    pub end_col: u32,
}

impl ViewportBounds {
    /// Return `true` if the given `(row, col)` falls within these inclusive bounds.
    #[inline]
    #[must_use]
    pub fn contains(self, row: u32, col: u32) -> bool {
        row >= self.start_row && row <= self.end_row && col >= self.start_col && col <= self.end_col
    }
}

impl From<(u32, u32, u32, u32)> for ViewportBounds {
    fn from((start_row, start_col, end_row, end_col): (u32, u32, u32, u32)) -> Self {
        Self {
            start_row,
            start_col,
            end_row,
            end_col,
        }
    }
}

/// A palette delta snapshot for inclusion in mutation binary blobs.
///
/// Contains the starting index and pre-serialized binary bytes of new
/// palette entries since that index.
#[derive(Debug, Clone, Copy)]
pub struct PaletteSnapshot<'a> {
    /// Index of the first new format in this delta.
    pub start_index: u16,
    /// Pre-serialized binary bytes of the palette entries.
    pub palette_bytes: &'a [u8],
}

/// Lean per-cell data for rendering only.
/// Internal to Rust -- serialized to binary in `viewport.rs`, never to JSON via bridge.
/// Note: row/col are used during building only; the binary serializer omits them
/// (position is implicit from dense row-major index).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ViewportRenderCell {
    /// Zero-based row (used during building; omitted in binary wire format).
    pub row: u32,
    /// Zero-based column (used during building; omitted in binary wire format).
    pub col: u32,
    /// Index into the format palette.
    pub format_idx: u16,
    /// Bitfield: `value_type`(3), `has_formula`, `has_comment`, `has_sparkline`,
    /// `has_hyperlink`, `is_checkbox`, `is_spill_member`, `has_validation_error`.
    /// See [`super::flags`] for constants.
    pub flags: u16,
    /// For Number/Boolean cells; NaN for others.
    pub number_value: f64,
    /// Formatted display string (number format applied).
    pub formatted: Option<String>,
    /// Error string if formula produced an error.
    pub error: Option<String>,
    /// Packed RGBA background color override (0 = no override).
    /// Set by CF color scales, style rules, etc.
    pub bg_color_override: u32,
    /// Packed RGBA font color override (0 = no override).
    /// Set by CF style rules, etc.
    pub font_color_override: u32,
    /// Optional CF extras (data bars, icons) for this cell.
    pub cf_extras: Option<CellCFExtras>,
}

/// CF extras for cells with data bars or icons.
/// These are render-only types in `compute-wire` -- NOT dependent on `compute-cf`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct CellCFExtras {
    /// Optional data bar render data.
    pub data_bar: Option<DataBarRenderData>,
    /// Optional icon render data.
    pub icon: Option<IconRenderData>,
}

/// Lean render-only data bar data. Converted from `compute-cf`'s `DataBarResult`
/// via `From` impl (in `viewport_render.rs`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[allow(clippy::struct_excessive_bools)] // mirrors wire protocol boolean flags
pub struct DataBarRenderData {
    /// Fill percentage (0.0 to 1.0).
    pub fill_percent: f32,
    /// Packed RGBA color.
    pub color: u32,
    /// Whether the bar represents a negative value.
    pub is_negative: bool,
    /// Whether to use gradient fill.
    pub gradient: bool,
    /// Whether to show the cell value alongside the bar.
    pub show_value: bool,
    /// Whether to show the axis line.
    pub show_axis: bool,
    /// Axis position as a fraction (0.0 to 1.0).
    pub axis_position: f32,
    /// Packed RGBA color for negative bars.
    pub negative_color: u32,
}

/// Lean render-only icon data. Converted from `compute-cf`'s `IconResult`
/// via `From` impl (in `viewport_render.rs`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct IconRenderData {
    /// `CFIconSetName` enum discriminant (0-23).
    pub set_name_index: u8,
    /// Icon index within the set.
    pub icon_index: u8,
    /// Whether to show only the icon (inverted from `compute-cf`'s `show_value`).
    pub icon_only: bool,
}

/// Merge region within viewport bounds (render path).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RenderViewportMerge {
    /// Zero-based start row of the merge.
    pub start_row: u32,
    /// Zero-based start column of the merge.
    pub start_col: u32,
    /// Zero-based end row of the merge (inclusive).
    pub end_row: u32,
    /// Zero-based end column of the merge (inclusive).
    pub end_col: u32,
}

/// Row dimension data for viewport (render path, `f32` precision).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RenderRowDimension {
    /// Zero-based row index.
    pub row: u32,
    /// Row height in points.
    pub height: f32,
    /// Whether the row is hidden.
    pub hidden: bool,
}

/// Column dimension data for viewport (render path, `f32` precision).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RenderColDimension {
    /// Zero-based column index.
    pub col: u32,
    /// Column width in character units.
    pub width: f32,
    /// Whether the column is hidden.
    pub hidden: bool,
}

/// Lean viewport data for rendering. Contains only what the renderer needs.
/// Built by the viewport logic, consumed by the binary serializer.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ViewportRenderData {
    /// Dense cell data for the viewport region (row-major order).
    pub cells: Vec<ViewportRenderCell>,
    /// Full current format palette (append-only).
    pub format_palette: Vec<CellFormat>,
    /// Merge regions intersecting the viewport.
    pub merges: Vec<RenderViewportMerge>,
    /// Row dimensions for viewport rows.
    pub row_dimensions: Vec<RenderRowDimension>,
    /// Column dimensions for viewport columns.
    pub col_dimensions: Vec<RenderColDimension>,
    /// Number of rows in the viewport grid (for dense layout).
    pub viewport_rows: u32,
    /// Number of columns in the viewport grid (for dense layout).
    pub viewport_cols: u32,
    /// Starting row of the viewport region (zero-based).
    pub start_row: u32,
    /// Starting column of the viewport region (zero-based).
    pub start_col: u32,
    /// Cumulative pixel position of each row's top edge in the viewport range,
    /// plus a trailing sentinel (top edge of the row after the range, i.e.
    /// `top_of(end_row - 1) + height_of(end_row - 1)`).
    /// Length = `viewport_rows + 1` for non-empty viewports, 0 otherwise.
    /// The sentinel lets consumers derive `height_of(end_row - 1)` as
    /// `row_positions[viewport_rows] - row_positions[viewport_rows - 1]`.
    /// Empty when `LayoutIndex` is not yet available.
    pub row_positions: Vec<f64>,
    /// Cumulative pixel position of each column's left edge in the viewport range,
    /// plus a trailing sentinel (left edge of the column after the range).
    /// Length = `viewport_cols + 1` for non-empty viewports, 0 otherwise.
    /// Empty when `LayoutIndex` is not yet available.
    pub col_positions: Vec<f64>,
}

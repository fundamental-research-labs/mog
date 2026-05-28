//! Spatial layout index for spreadsheet cell-to-pixel mapping.
//!
//! Provides O(log k) position lookups and inverse queries using a Fenwick tree
//! over dimension deltas, where k is the number of rows/columns with custom
//! dimensions (out of potentially millions of total entries).
//!
//! # Architecture
//!
//! - `FenwickTree`: Binary Indexed Tree storing prefix sums of dimension deltas.
//! - `AxisIndex`: Per-axis (rows or columns) spatial index combining a sparse
//!   BTreeMap of custom dimensions with a FenwickTree for O(log n) queries.
//! - `LayoutIndex`: Per-sheet struct owning row and column `AxisIndex` instances.

use domain_types::units::Pixels;

pub mod axis;
pub mod error;
pub mod fenwick;

pub use axis::AxisIndex;
pub use error::*;

/// Per-sheet spatial layout index for cell-to-pixel mapping.
///
/// Owns row and column `AxisIndex` instances. Constructed from dimension data
/// on sheet load, updated incrementally on dimension mutations.
#[derive(Debug, Clone)]
pub struct LayoutIndex {
    rows: AxisIndex,
    cols: AxisIndex,
}

/// Default row height in pixels (15pt at 96 DPI = 20.0px).
pub const DEFAULT_ROW_HEIGHT: Pixels = Pixels(20.0);

/// Default column width in pixels — Windows/Linux (8.43 char-width at MDW=7 = 64px).
pub const DEFAULT_COL_WIDTH: Pixels = Pixels(64.0);

/// Default column width in pixels — macOS (8.43 char-width at MDW=8 = 72px).
pub const DEFAULT_COL_WIDTH_MACOS: Pixels = Pixels(72.0);

/// Returns the platform-appropriate default column width.
///
/// Uses compile-time `cfg!(target_os)` for native builds (Tauri, N-API).
/// For WASM builds this returns `DEFAULT_COL_WIDTH` (64.0) — callers should
/// prefer the sheet metadata's `defaultColWidth` which TypeScript sets
/// based on runtime platform detection.
pub fn platform_default_col_width() -> Pixels {
    if cfg!(target_os = "macos") {
        DEFAULT_COL_WIDTH_MACOS
    } else {
        DEFAULT_COL_WIDTH
    }
}

/// Maximum number of rows per sheet.
pub const MAX_ROWS: usize = 1_048_576;

/// Maximum number of columns per sheet.
pub const MAX_COLS: usize = 16_384;

impl LayoutIndex {
    /// Create a new layout index with platform-appropriate default dimensions.
    pub fn new(row_count: usize, col_count: usize) -> Self {
        Self::with_defaults(
            row_count,
            col_count,
            DEFAULT_ROW_HEIGHT,
            platform_default_col_width(),
        )
    }

    /// Create a new layout index with explicit default dimensions.
    pub fn with_defaults(
        row_count: usize,
        col_count: usize,
        default_row_height: Pixels,
        default_col_width: Pixels,
    ) -> Self {
        Self {
            rows: AxisIndex::new(row_count, default_row_height),
            cols: AxisIndex::new(col_count, default_col_width),
        }
    }

    /// Build from sparse dimension data with explicit defaults.
    #[allow(clippy::too_many_arguments)]
    pub fn from_sparse(
        row_count: usize,
        col_count: usize,
        default_row_height: Pixels,
        default_col_width: Pixels,
        custom_row_heights: impl IntoIterator<Item = (usize, Pixels)>,
        custom_col_widths: impl IntoIterator<Item = (usize, Pixels)>,
        hidden_rows: impl IntoIterator<Item = usize>,
        hidden_cols: impl IntoIterator<Item = usize>,
    ) -> Self {
        Self {
            rows: AxisIndex::from_sparse(
                row_count,
                default_row_height,
                custom_row_heights,
                hidden_rows,
            ),
            cols: AxisIndex::from_sparse(
                col_count,
                default_col_width,
                custom_col_widths,
                hidden_cols,
            ),
        }
    }

    // -- Row operations (delegate to rows AxisIndex) --

    /// Get the pixel position of the top edge of `row`.
    pub fn get_row_position(&self, row: usize) -> Pixels {
        self.rows.get_position(row)
    }

    /// Get the height of `row` (0 if hidden).
    pub fn get_row_height(&self, row: usize) -> Pixels {
        self.rows.get_dimension(row)
    }

    /// Set the height of `row`.
    pub fn set_row_height(&mut self, row: usize, height: Pixels) {
        self.rows.set_dimension(row, height);
    }

    /// Hide `row`.
    pub fn hide_row(&mut self, row: usize) {
        self.rows.hide(row);
    }

    /// Unhide `row`.
    pub fn unhide_row(&mut self, row: usize) {
        self.rows.unhide(row);
    }

    /// Is `row` hidden?
    pub fn is_row_hidden(&self, row: usize) -> bool {
        self.rows.is_hidden(row)
    }

    /// Find the row index at pixel position `y`.
    pub fn get_row_at_pixel(&self, y: Pixels) -> usize {
        self.rows.get_index_at(y)
    }

    // -- Column operations (delegate to cols AxisIndex) --

    /// Get the pixel position of the left edge of `col`.
    pub fn get_col_position(&self, col: usize) -> Pixels {
        self.cols.get_position(col)
    }

    /// Get the width of `col` (0 if hidden).
    pub fn get_col_width(&self, col: usize) -> Pixels {
        self.cols.get_dimension(col)
    }

    /// Set the width of `col`.
    pub fn set_col_width(&mut self, col: usize, width: Pixels) {
        self.cols.set_dimension(col, width);
    }

    /// Hide `col`.
    pub fn hide_col(&mut self, col: usize) {
        self.cols.hide(col);
    }

    /// Unhide `col`.
    pub fn unhide_col(&mut self, col: usize) {
        self.cols.unhide(col);
    }

    /// Is `col` hidden?
    pub fn is_col_hidden(&self, col: usize) -> bool {
        self.cols.is_hidden(col)
    }

    /// Find the column index at pixel position `x`.
    pub fn get_col_at_pixel(&self, x: Pixels) -> usize {
        self.cols.get_index_at(x)
    }

    // -- Bulk operations --

    /// Build position arrays for a viewport range.
    pub fn build_row_positions(&self, start: usize, end: usize) -> Vec<f64> {
        self.rows.build_position_array(start, end)
    }

    /// Build position arrays for a column range.
    pub fn build_col_positions(&self, start: usize, end: usize) -> Vec<f64> {
        self.cols.build_position_array(start, end)
    }

    /// Get the visible row range for a pixel range.
    pub fn get_visible_row_range(&self, start_px: Pixels, end_px: Pixels) -> (usize, usize) {
        self.rows.get_visible_range(start_px, end_px)
    }

    /// Get the visible column range for a pixel range.
    pub fn get_visible_col_range(&self, start_px: Pixels, end_px: Pixels) -> (usize, usize) {
        self.cols.get_visible_range(start_px, end_px)
    }

    // -- Dimension arrays --

    /// Build a dimension array for a row range [start..end).
    pub fn build_row_dimensions(&self, start: usize, end: usize) -> Vec<f64> {
        self.rows.build_dimension_array(start, end)
    }

    /// Build a dimension array for a column range [start..end).
    pub fn build_col_dimensions(&self, start: usize, end: usize) -> Vec<f64> {
        self.cols.build_dimension_array(start, end)
    }

    // -- Aggregate queries --

    /// Total pixel height of all rows.
    pub fn total_row_size(&self) -> Pixels {
        self.rows.total_size()
    }

    /// Total pixel width of all columns.
    pub fn total_col_size(&self) -> Pixels {
        self.cols.total_size()
    }

    /// Number of rows.
    pub fn row_count(&self) -> usize {
        self.rows.count()
    }

    /// Number of columns.
    pub fn col_count(&self) -> usize {
        self.cols.count()
    }

    /// Default row height.
    pub fn default_row_height(&self) -> Pixels {
        self.rows.default_size()
    }

    /// Default column width.
    pub fn default_col_width(&self) -> Pixels {
        self.cols.default_size()
    }
}

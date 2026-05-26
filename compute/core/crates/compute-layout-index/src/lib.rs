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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_index_default() {
        // Use explicit defaults so the test is deterministic across platforms.
        let li = LayoutIndex::with_defaults(100, 50, DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
        assert_eq!(li.get_row_position(0), Pixels(0.0));
        assert_eq!(li.get_row_position(1), DEFAULT_ROW_HEIGHT);
        assert_eq!(li.get_col_position(0), Pixels(0.0));
        assert_eq!(li.get_col_position(1), DEFAULT_COL_WIDTH);
        assert_eq!(li.get_row_height(0), DEFAULT_ROW_HEIGHT);
        assert_eq!(li.get_col_width(0), DEFAULT_COL_WIDTH);
    }

    #[test]
    fn layout_index_from_sparse() {
        let li = LayoutIndex::from_sparse(
            100,
            50,
            DEFAULT_ROW_HEIGHT,
            DEFAULT_COL_WIDTH,
            vec![(5, Pixels(40.0))],  // row 5 is 40px
            vec![(2, Pixels(120.0))], // col 2 is 120px
            vec![10],                 // row 10 hidden
            vec![],
        );
        assert_eq!(li.get_row_height(5), Pixels(40.0));
        assert_eq!(li.get_col_width(2), Pixels(120.0));
        assert!(li.is_row_hidden(10));
        assert_eq!(li.get_row_height(10), Pixels(0.0));
    }

    #[test]
    fn layout_index_mutations() {
        let mut li = LayoutIndex::new(100, 50);
        li.set_row_height(5, Pixels(40.0));
        assert_eq!(li.get_row_height(5), Pixels(40.0));
        assert_eq!(
            li.get_row_position(6),
            DEFAULT_ROW_HEIGHT * 5.0 + Pixels(40.0)
        );

        li.hide_row(3);
        assert!(li.is_row_hidden(3));
        assert_eq!(li.get_row_height(3), Pixels(0.0));

        li.unhide_row(3);
        assert!(!li.is_row_hidden(3));
        assert_eq!(li.get_row_height(3), DEFAULT_ROW_HEIGHT);
    }

    #[test]
    fn layout_index_inverse_queries() {
        let li = LayoutIndex::with_defaults(100, 50, DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
        assert_eq!(li.get_row_at_pixel(Pixels(0.0)), 0);
        assert_eq!(li.get_row_at_pixel(DEFAULT_ROW_HEIGHT), 1);
        assert_eq!(li.get_col_at_pixel(Pixels(0.0)), 0);
        assert_eq!(li.get_col_at_pixel(DEFAULT_COL_WIDTH), 1);
    }

    #[test]
    fn layout_index_bulk_positions() {
        let li = LayoutIndex::from_sparse(
            10,
            5,
            DEFAULT_ROW_HEIGHT,
            DEFAULT_COL_WIDTH,
            vec![(3, Pixels(50.0))],
            vec![],
            vec![],
            vec![],
        );
        let row_positions = li.build_row_positions(2, 6);
        // Length is end-start+1 (4 in-range entries + 1 sentinel = 5).
        assert_eq!(row_positions.len(), 5);
        assert_eq!(row_positions[0], 40.0); // row 2: 2 * 20 = 40
        assert_eq!(row_positions[1], 60.0); // row 3: 3 * 20 = 60
        assert_eq!(row_positions[2], 110.0); // row 4: 3 * 20 + 50 = 110
        assert_eq!(row_positions[3], 130.0); // row 5: 4 * 20 + 50 = 130
        assert_eq!(row_positions[4], 150.0); // sentinel: top of row 6
    }

    #[test]
    fn build_row_positions_sentinel_lets_caller_derive_last_row_height() {
        // Without the sentinel, a caller cannot derive the height of the last
        // row in the range from the bulk array alone. With the sentinel, the
        // last in-range entry's height = positions[last+1] - positions[last].
        let li = LayoutIndex::from_sparse(
            10,
            5,
            DEFAULT_ROW_HEIGHT,
            DEFAULT_COL_WIDTH,
            vec![(5, Pixels(50.0))], // row 5 height 50
            vec![],
            vec![],
            vec![],
        );
        let row_positions = li.build_row_positions(2, 6);
        assert_eq!(row_positions.len(), 5);
        // Height of row 5 (the last in-range row) is positions[4] - positions[3].
        assert_eq!(row_positions[4] - row_positions[3], 50.0);
    }

    #[test]
    fn build_row_positions_empty_range() {
        let li = LayoutIndex::with_defaults(10, 5, DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
        // start == end → empty (no in-range entries means no sentinel either).
        assert!(li.build_row_positions(5, 5).is_empty());
        // start > end → empty.
        assert!(li.build_row_positions(7, 3).is_empty());
        assert!(li.build_col_positions(2, 2).is_empty());
    }

    #[test]
    fn build_row_positions_single_row_range() {
        let li = LayoutIndex::with_defaults(10, 5, Pixels(20.0), Pixels(64.0));
        let pos = li.build_row_positions(3, 4);
        // 1 in-range entry + 1 sentinel = 2 entries.
        assert_eq!(pos.len(), 2);
        assert_eq!(pos[0], 60.0); // row 3
        assert_eq!(pos[1], 80.0); // sentinel: top of row 4
    }

    // ================================================================
    // First-principles tests
    // ================================================================

    /// Helper: verify the position-dimension invariant for all rows in [0, count).
    /// pos(i+1) == pos(i) + height(i)
    fn assert_row_position_invariant(li: &LayoutIndex) {
        for i in 0..li.row_count() {
            let lhs = li.get_row_position(i + 1);
            let rhs = Pixels(li.get_row_position(i).0 + li.get_row_height(i).0);
            assert!(
                (lhs.0 - rhs.0).abs() < 1e-9,
                "Row position invariant violated at i={}: pos({})={:?} != pos({}) + height({}) = {:?}",
                i,
                i + 1,
                lhs,
                i,
                i,
                rhs
            );
        }
    }

    /// Helper: verify the position-dimension invariant for all cols in [0, count).
    fn assert_col_position_invariant(li: &LayoutIndex) {
        for j in 0..li.col_count() {
            let lhs = li.get_col_position(j + 1);
            let rhs = Pixels(li.get_col_position(j).0 + li.get_col_width(j).0);
            assert!(
                (lhs.0 - rhs.0).abs() < 1e-9,
                "Col position invariant violated at j={}: pos({})={:?} != pos({}) + width({}) = {:?}",
                j,
                j + 1,
                lhs,
                j,
                j,
                rhs
            );
        }
    }

    // -- 1. Column operations symmetry --

    #[test]
    fn fp_col_set_get_width() {
        let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        li.set_col_width(3, Pixels(120.0));
        assert_eq!(li.get_col_width(3), Pixels(120.0));
        // Other cols unchanged
        assert_eq!(li.get_col_width(0), Pixels(64.0));
        assert_eq!(li.get_col_width(4), Pixels(64.0));
    }

    #[test]
    fn fp_col_position_after_set_width() {
        let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        li.set_col_width(2, Pixels(100.0));
        // Position of col 3 = 2*64 + 100 = 228
        assert_eq!(li.get_col_position(3), Pixels(228.0));
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_col_hide_unhide_lifecycle() {
        let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
        assert!(!li.is_col_hidden(2));
        assert_eq!(li.get_col_width(2), Pixels(64.0));

        li.hide_col(2);
        assert!(li.is_col_hidden(2));
        assert_eq!(li.get_col_width(2), Pixels(0.0));

        li.unhide_col(2);
        assert!(!li.is_col_hidden(2));
        assert_eq!(li.get_col_width(2), Pixels(64.0));
    }

    #[test]
    fn fp_col_hide_custom_then_unhide_restores_custom() {
        let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
        li.set_col_width(1, Pixels(200.0));
        li.hide_col(1);
        assert_eq!(li.get_col_width(1), Pixels(0.0));
        li.unhide_col(1);
        assert_eq!(li.get_col_width(1), Pixels(200.0));
    }

    #[test]
    fn fp_col_get_col_at_pixel() {
        let li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        assert_eq!(li.get_col_at_pixel(Pixels(0.0)), 0);
        assert_eq!(li.get_col_at_pixel(Pixels(63.9)), 0);
        assert_eq!(li.get_col_at_pixel(Pixels(64.0)), 1);
        assert_eq!(li.get_col_at_pixel(Pixels(128.0)), 2);
    }

    #[test]
    fn fp_col_build_positions() {
        let li = LayoutIndex::from_sparse(
            5,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(1, Pixels(100.0))],
            vec![],
            vec![],
        );
        let pos = li.build_col_positions(0, 5);
        // 5 in-range entries + 1 sentinel = 6 entries.
        assert_eq!(pos.len(), 6);
        assert_eq!(pos[0], 0.0); // col 0
        assert_eq!(pos[1], 64.0); // col 1
        assert_eq!(pos[2], 164.0); // col 2: 64 + 100
        assert_eq!(pos[3], 228.0); // col 3: 64 + 100 + 64
        assert_eq!(pos[4], 292.0); // col 4: 64 + 100 + 64 + 64
        assert_eq!(pos[5], 356.0); // sentinel: left of col 5 (4 * 64 + 100)
    }

    #[test]
    fn fp_col_build_dimensions() {
        let li = LayoutIndex::from_sparse(
            5,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(2, Pixels(100.0))],
            vec![],
            vec![3],
        );
        let dims = li.build_col_dimensions(0, 5);
        assert_eq!(dims, vec![64.0, 64.0, 100.0, 0.0, 64.0]);
    }

    #[test]
    fn fp_row_build_dimensions() {
        let li = LayoutIndex::from_sparse(
            5,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![(1, Pixels(40.0))],
            vec![],
            vec![3],
            vec![],
        );
        let dims = li.build_row_dimensions(0, 5);
        assert_eq!(dims, vec![20.0, 40.0, 20.0, 0.0, 20.0]);
    }

    // -- 2. Position-dimension invariant --

    #[test]
    fn fp_position_dimension_invariant_defaults() {
        let li = LayoutIndex::with_defaults(20, 15, Pixels(20.0), Pixels(64.0));
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_position_dimension_invariant_after_mutations() {
        let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        li.set_row_height(0, Pixels(5.0));
        li.set_row_height(5, Pixels(100.0));
        li.hide_row(3);
        li.set_col_width(0, Pixels(10.0));
        li.set_col_width(9, Pixels(200.0));
        li.hide_col(7);
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_position_dimension_invariant_from_sparse() {
        let li = LayoutIndex::from_sparse(
            10,
            8,
            Pixels(20.0),
            Pixels(64.0),
            vec![(0, Pixels(5.0)), (3, Pixels(50.0)), (9, Pixels(100.0))],
            vec![(1, Pixels(30.0)), (7, Pixels(200.0))],
            vec![2, 6],
            vec![0, 5],
        );
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
    }

    // -- 3. Inverse function properties --

    #[test]
    fn fp_inverse_row_default() {
        let li = LayoutIndex::with_defaults(50, 10, Pixels(20.0), Pixels(64.0));
        for i in 0..50 {
            let px = li.get_row_position(i);
            assert_eq!(
                li.get_row_at_pixel(px),
                i,
                "get_row_at_pixel(get_row_position({})) should be {}",
                i,
                i
            );
        }
    }

    #[test]
    fn fp_inverse_col_default() {
        let li = LayoutIndex::with_defaults(10, 50, Pixels(20.0), Pixels(64.0));
        for j in 0..50 {
            let px = li.get_col_position(j);
            assert_eq!(
                li.get_col_at_pixel(px),
                j,
                "get_col_at_pixel(get_col_position({})) should be {}",
                j,
                j
            );
        }
    }

    #[test]
    fn fp_inverse_row_with_custom_and_hidden() {
        let mut li = LayoutIndex::with_defaults(20, 5, Pixels(20.0), Pixels(64.0));
        li.set_row_height(3, Pixels(50.0));
        li.set_row_height(10, Pixels(5.0));
        li.hide_row(7);

        for i in 0..20 {
            if li.is_row_hidden(i) {
                continue; // hidden rows share position with next, skip
            }
            let px = li.get_row_position(i);
            assert_eq!(
                li.get_row_at_pixel(px),
                i,
                "Inverse failed for row {}: pixel={:?}",
                i,
                px
            );
        }
    }

    #[test]
    fn fp_inverse_col_with_custom_and_hidden() {
        let mut li = LayoutIndex::with_defaults(5, 20, Pixels(20.0), Pixels(64.0));
        li.set_col_width(2, Pixels(150.0));
        li.set_col_width(15, Pixels(10.0));
        li.hide_col(5);

        for j in 0..20 {
            if li.is_col_hidden(j) {
                continue;
            }
            let px = li.get_col_position(j);
            assert_eq!(
                li.get_col_at_pixel(px),
                j,
                "Inverse failed for col {}: pixel={:?}",
                j,
                px
            );
        }
    }

    // -- 4. Visible range correctness --

    #[test]
    fn fp_visible_row_range_defaults() {
        let li = LayoutIndex::with_defaults(100, 10, Pixels(20.0), Pixels(64.0));
        let (start, end) = li.get_visible_row_range(Pixels(50.0), Pixels(90.0));
        // Row 2 starts at 40, row 4 starts at 80, row 5 starts at 100
        // Pixel 50 is in row 2, pixel 90 is in row 4
        assert_eq!(start, 2);
        assert_eq!(end, 5); // exclusive
        // Every row in [start, end) must overlap the pixel window
        for i in start..end {
            let pos = li.get_row_position(i);
            let dim = li.get_row_height(i);
            let entry_end = Pixels(pos.0 + dim.0);
            // entry overlaps [50, 90] iff pos < 90 and entry_end > 50
            assert!(
                pos.0 <= 90.0 && entry_end.0 > 50.0,
                "Row {} at pos {:?} with height {:?} does not overlap [50, 90]",
                i,
                pos,
                dim
            );
        }
    }

    #[test]
    fn fp_visible_col_range_defaults() {
        let li = LayoutIndex::with_defaults(10, 100, Pixels(20.0), Pixels(64.0));
        let (start, end) = li.get_visible_col_range(Pixels(100.0), Pixels(300.0));
        // Col 1 starts at 64, col 4 starts at 256, col 5 starts at 320
        assert!(start <= 1, "start should be <= 1, got {}", start);
        assert!(end >= 5, "end should be >= 5, got {}", end);
    }

    #[test]
    fn fp_visible_row_range_with_hidden() {
        let li = LayoutIndex::from_sparse(
            10,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![],
            vec![2, 3],
            vec![],
        );
        // Positions: [0, 20, 40, 40, 40, 60, 80, ...]
        // Pixel 40 is where rows 2,3,4 all start; rows 2,3 are hidden (0 height)
        let (start, end) = li.get_visible_row_range(Pixels(35.0), Pixels(45.0));
        // Must include row 4 which has content at pixel 40
        assert!(start <= 4, "start should include row 4 area, got {}", start);
        assert!(end > 4, "end should be past row 4, got {}", end);
    }

    #[test]
    fn fp_visible_col_range_custom_widths() {
        let li = LayoutIndex::from_sparse(
            5,
            10,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(0, Pixels(200.0))],
            vec![],
            vec![],
        );
        // Col 0: [0, 200), Col 1: [200, 264), Col 2: [264, 328)
        let (start, end) = li.get_visible_col_range(Pixels(150.0), Pixels(250.0));
        // Should include col 0 (extends to 200) and col 1 (starts at 200)
        assert!(start == 0, "start should be 0, got {}", start);
        assert!(end >= 2, "end should include col 1, got {}", end);
    }

    // -- 5. Total size and count accessors --

    #[test]
    fn fp_total_row_size_equals_sum_of_heights() {
        let li = LayoutIndex::from_sparse(
            10,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![(2, Pixels(50.0)), (7, Pixels(10.0))],
            vec![],
            vec![4],
            vec![],
        );
        let manual_sum: f64 = (0..10).map(|i| li.get_row_height(i).0).sum();
        assert!(
            (li.total_row_size().0 - manual_sum).abs() < 1e-9,
            "total_row_size {:?} != sum of heights {}",
            li.total_row_size(),
            manual_sum
        );
    }

    #[test]
    fn fp_total_col_size_equals_sum_of_widths() {
        let li = LayoutIndex::from_sparse(
            5,
            10,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(0, Pixels(100.0)), (5, Pixels(30.0))],
            vec![],
            vec![3, 8],
        );
        let manual_sum: f64 = (0..10).map(|j| li.get_col_width(j).0).sum();
        assert!(
            (li.total_col_size().0 - manual_sum).abs() < 1e-9,
            "total_col_size {:?} != sum of widths {}",
            li.total_col_size(),
            manual_sum
        );
    }

    #[test]
    fn fp_total_size_equals_last_position() {
        let li = LayoutIndex::from_sparse(
            10,
            8,
            Pixels(20.0),
            Pixels(64.0),
            vec![(3, Pixels(50.0))],
            vec![(2, Pixels(100.0))],
            vec![1],
            vec![5],
        );
        // total_size should equal position of the entry PAST the last
        assert_eq!(li.total_row_size(), li.get_row_position(li.row_count()));
        assert_eq!(li.total_col_size(), li.get_col_position(li.col_count()));
    }

    #[test]
    fn fp_row_col_count() {
        let li = LayoutIndex::with_defaults(42, 17, Pixels(20.0), Pixels(64.0));
        assert_eq!(li.row_count(), 42);
        assert_eq!(li.col_count(), 17);
    }

    #[test]
    fn fp_default_sizes_returned() {
        let li = LayoutIndex::with_defaults(10, 10, Pixels(25.0), Pixels(80.0));
        assert_eq!(li.default_row_height(), Pixels(25.0));
        assert_eq!(li.default_col_width(), Pixels(80.0));
    }

    // -- 6. from_sparse construction --

    #[test]
    fn fp_from_sparse_custom_heights_and_widths() {
        let li = LayoutIndex::from_sparse(
            5,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![(0, Pixels(10.0)), (4, Pixels(50.0))],
            vec![(0, Pixels(30.0)), (4, Pixels(100.0))],
            vec![],
            vec![],
        );
        assert_eq!(li.get_row_height(0), Pixels(10.0));
        assert_eq!(li.get_row_height(4), Pixels(50.0));
        assert_eq!(li.get_row_height(2), Pixels(20.0)); // default
        assert_eq!(li.get_col_width(0), Pixels(30.0));
        assert_eq!(li.get_col_width(4), Pixels(100.0));
        assert_eq!(li.get_col_width(2), Pixels(64.0)); // default
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_from_sparse_hidden_rows_and_cols() {
        let li = LayoutIndex::from_sparse(
            5,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![],
            vec![1, 3],
            vec![0, 4],
        );
        assert!(li.is_row_hidden(1));
        assert!(li.is_row_hidden(3));
        assert!(!li.is_row_hidden(0));
        assert!(li.is_col_hidden(0));
        assert!(li.is_col_hidden(4));
        assert!(!li.is_col_hidden(2));
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_from_sparse_hidden_overrides_custom() {
        // Custom width 200, but hidden → effective 0. Unhide restores 200.
        let mut li = LayoutIndex::from_sparse(
            5,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(2, Pixels(200.0))],
            vec![],
            vec![2],
        );
        assert_eq!(li.get_col_width(2), Pixels(0.0));
        assert!(li.is_col_hidden(2));
        li.unhide_col(2);
        assert_eq!(li.get_col_width(2), Pixels(200.0));
        assert_col_position_invariant(&li);
    }

    // -- 7. Row-column independence --

    #[test]
    fn fp_row_mutations_dont_affect_cols() {
        let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        // Record col positions before row mutations
        let col_positions_before: Vec<Pixels> = (0..=10).map(|j| li.get_col_position(j)).collect();
        let col_widths_before: Vec<Pixels> = (0..10).map(|j| li.get_col_width(j)).collect();

        // Mutate rows heavily
        li.set_row_height(0, Pixels(100.0));
        li.set_row_height(5, Pixels(1.0));
        li.hide_row(3);

        // Verify cols unchanged
        for j in 0..=10 {
            assert_eq!(
                li.get_col_position(j),
                col_positions_before[j],
                "Col position {} changed after row mutation",
                j
            );
        }
        for j in 0..10 {
            assert_eq!(
                li.get_col_width(j),
                col_widths_before[j],
                "Col width {} changed after row mutation",
                j
            );
        }
    }

    #[test]
    fn fp_col_mutations_dont_affect_rows() {
        let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        let row_positions_before: Vec<Pixels> = (0..=10).map(|i| li.get_row_position(i)).collect();
        let row_heights_before: Vec<Pixels> = (0..10).map(|i| li.get_row_height(i)).collect();

        li.set_col_width(0, Pixels(500.0));
        li.set_col_width(9, Pixels(1.0));
        li.hide_col(5);

        for i in 0..=10 {
            assert_eq!(
                li.get_row_position(i),
                row_positions_before[i],
                "Row position {} changed after col mutation",
                i
            );
        }
        for i in 0..10 {
            assert_eq!(
                li.get_row_height(i),
                row_heights_before[i],
                "Row height {} changed after col mutation",
                i
            );
        }
    }

    // -- 8. Bulk array consistency --

    #[test]
    fn fp_bulk_row_positions_match_individual() {
        let li = LayoutIndex::from_sparse(
            10,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![(2, Pixels(50.0)), (7, Pixels(5.0))],
            vec![],
            vec![4],
            vec![],
        );
        let bulk = li.build_row_positions(0, 10);
        // 10 in-range entries + 1 sentinel = 11 entries.
        assert_eq!(bulk.len(), 11);
        for i in 0..=10 {
            assert!(
                (bulk[i] - li.get_row_position(i).0).abs() < 1e-9,
                "Row position mismatch at {}: bulk={}, individual={:?}",
                i,
                bulk[i],
                li.get_row_position(i)
            );
        }
    }

    #[test]
    fn fp_bulk_col_positions_match_individual() {
        let li = LayoutIndex::from_sparse(
            5,
            10,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(0, Pixels(100.0)), (5, Pixels(30.0))],
            vec![],
            vec![3],
        );
        let bulk = li.build_col_positions(0, 10);
        // 10 in-range entries + 1 sentinel = 11 entries.
        assert_eq!(bulk.len(), 11);
        for j in 0..=10 {
            assert!(
                (bulk[j] - li.get_col_position(j).0).abs() < 1e-9,
                "Col position mismatch at {}: bulk={}, individual={:?}",
                j,
                bulk[j],
                li.get_col_position(j)
            );
        }
    }

    #[test]
    fn fp_bulk_row_dimensions_match_individual() {
        let li = LayoutIndex::from_sparse(
            10,
            5,
            Pixels(20.0),
            Pixels(64.0),
            vec![(1, Pixels(40.0)), (8, Pixels(5.0))],
            vec![],
            vec![3, 6],
            vec![],
        );
        let bulk = li.build_row_dimensions(0, 10);
        for i in 0..10 {
            assert!(
                (bulk[i] - li.get_row_height(i).0).abs() < 1e-9,
                "Row dim mismatch at {}: bulk={}, individual={:?}",
                i,
                bulk[i],
                li.get_row_height(i)
            );
        }
    }

    #[test]
    fn fp_bulk_col_dimensions_match_individual() {
        let li = LayoutIndex::from_sparse(
            5,
            10,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![(2, Pixels(120.0)), (9, Pixels(10.0))],
            vec![],
            vec![0, 7],
        );
        let bulk = li.build_col_dimensions(0, 10);
        for j in 0..10 {
            assert!(
                (bulk[j] - li.get_col_width(j).0).abs() < 1e-9,
                "Col dim mismatch at {}: bulk={}, individual={:?}",
                j,
                bulk[j],
                li.get_col_width(j)
            );
        }
    }

    #[test]
    fn fp_bulk_positions_subrange() {
        let li = LayoutIndex::with_defaults(20, 20, Pixels(20.0), Pixels(64.0));
        let bulk = li.build_row_positions(5, 10);
        // 5 in-range entries + 1 sentinel = 6 entries.
        assert_eq!(bulk.len(), 6);
        for (k, i) in (5..=10).enumerate() {
            assert_eq!(bulk[k], li.get_row_position(i).0);
        }
        let bulk_c = li.build_col_positions(3, 8);
        assert_eq!(bulk_c.len(), 6);
        for (k, j) in (3..=8).enumerate() {
            assert_eq!(bulk_c[k], li.get_col_position(j).0);
        }
    }

    // -- 9. Edge cases --

    #[test]
    fn fp_zero_rows_zero_cols() {
        let li = LayoutIndex::with_defaults(0, 0, Pixels(20.0), Pixels(64.0));
        assert_eq!(li.row_count(), 0);
        assert_eq!(li.col_count(), 0);
        assert_eq!(li.total_row_size(), Pixels(0.0));
        assert_eq!(li.total_col_size(), Pixels(0.0));
        assert_eq!(li.get_row_position(0), Pixels(0.0));
        assert_eq!(li.get_col_position(0), Pixels(0.0));
        // Bulk on empty range
        assert!(li.build_row_positions(0, 0).is_empty());
        assert!(li.build_col_positions(0, 0).is_empty());
        assert!(li.build_row_dimensions(0, 0).is_empty());
        assert!(li.build_col_dimensions(0, 0).is_empty());
    }

    #[test]
    fn fp_single_row_single_col() {
        let li = LayoutIndex::with_defaults(1, 1, Pixels(20.0), Pixels(64.0));
        assert_eq!(li.row_count(), 1);
        assert_eq!(li.col_count(), 1);
        assert_eq!(li.get_row_position(0), Pixels(0.0));
        assert_eq!(li.get_row_position(1), Pixels(20.0));
        assert_eq!(li.get_col_position(0), Pixels(0.0));
        assert_eq!(li.get_col_position(1), Pixels(64.0));
        assert_eq!(li.get_row_height(0), Pixels(20.0));
        assert_eq!(li.get_col_width(0), Pixels(64.0));
        assert_eq!(li.total_row_size(), Pixels(20.0));
        assert_eq!(li.total_col_size(), Pixels(64.0));
        assert_eq!(li.get_row_at_pixel(Pixels(0.0)), 0);
        assert_eq!(li.get_col_at_pixel(Pixels(0.0)), 0);
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_all_rows_hidden() {
        let hidden_rows: Vec<usize> = (0..5).collect();
        let li = LayoutIndex::from_sparse(
            5,
            3,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![],
            hidden_rows,
            vec![],
        );
        assert_eq!(li.total_row_size(), Pixels(0.0));
        for i in 0..5 {
            assert_eq!(li.get_row_height(i), Pixels(0.0));
            assert_eq!(li.get_row_position(i), Pixels(0.0));
        }
        // Cols should be unaffected
        assert_eq!(li.total_col_size(), Pixels(192.0)); // 3 * 64
        assert_col_position_invariant(&li);
    }

    #[test]
    fn fp_all_cols_hidden() {
        let hidden_cols: Vec<usize> = (0..4).collect();
        let li = LayoutIndex::from_sparse(
            3,
            4,
            Pixels(20.0),
            Pixels(64.0),
            vec![],
            vec![],
            vec![],
            hidden_cols,
        );
        assert_eq!(li.total_col_size(), Pixels(0.0));
        for j in 0..4 {
            assert_eq!(li.get_col_width(j), Pixels(0.0));
            assert_eq!(li.get_col_position(j), Pixels(0.0));
        }
        // Rows should be unaffected
        assert_eq!(li.total_row_size(), Pixels(60.0)); // 3 * 20
        assert_row_position_invariant(&li);
    }

    #[test]
    fn fp_very_large_custom_dimension() {
        let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
        li.set_row_height(2, Pixels(1_000_000.0));
        li.set_col_width(0, Pixels(1_000_000.0));
        assert_eq!(li.get_row_height(2), Pixels(1_000_000.0));
        assert_eq!(li.get_col_width(0), Pixels(1_000_000.0));
        assert_row_position_invariant(&li);
        assert_col_position_invariant(&li);
        // Position of row 3 should be 2*20 + 1_000_000 = 1_000_040
        assert_eq!(li.get_row_position(3), Pixels(1_000_040.0));
    }

    #[test]
    fn fp_negative_pixel_returns_zero_index() {
        let li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        assert_eq!(li.get_row_at_pixel(Pixels(-100.0)), 0);
        assert_eq!(li.get_col_at_pixel(Pixels(-1.0)), 0);
    }

    #[test]
    fn fp_pixel_beyond_total_clamps() {
        let li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
        // Total row size = 200, total col size = 640
        assert_eq!(li.get_row_at_pixel(Pixels(9999.0)), 9); // clamped to last
        assert_eq!(li.get_col_at_pixel(Pixels(9999.0)), 9);
    }

    #[test]
    fn fp_visible_range_empty_on_zero_count() {
        let li = LayoutIndex::with_defaults(0, 0, Pixels(20.0), Pixels(64.0));
        assert_eq!(li.get_visible_row_range(Pixels(0.0), Pixels(100.0)), (0, 0));
        assert_eq!(li.get_visible_col_range(Pixels(0.0), Pixels(100.0)), (0, 0));
    }

    #[test]
    fn fp_set_dimension_while_hidden_takes_effect_on_unhide() {
        let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
        li.hide_row(2);
        li.set_row_height(2, Pixels(80.0));
        // Still hidden, so effective height is 0
        assert_eq!(li.get_row_height(2), Pixels(0.0));
        li.unhide_row(2);
        // Now should reflect the custom height set while hidden
        assert_eq!(li.get_row_height(2), Pixels(80.0));
        assert_row_position_invariant(&li);
    }

    #[test]
    fn fp_multiple_mutations_position_invariant() {
        // Stress test: many mutations, invariant must hold after each
        let mut li = LayoutIndex::with_defaults(15, 12, Pixels(20.0), Pixels(64.0));
        li.set_row_height(0, Pixels(1.0));
        assert_row_position_invariant(&li);
        li.hide_row(5);
        assert_row_position_invariant(&li);
        li.set_row_height(5, Pixels(100.0)); // set while hidden
        assert_row_position_invariant(&li);
        li.unhide_row(5);
        assert_row_position_invariant(&li);
        li.set_row_height(14, Pixels(200.0));
        assert_row_position_invariant(&li);
        li.hide_row(0);
        assert_row_position_invariant(&li);
        li.set_col_width(0, Pixels(1.0));
        assert_col_position_invariant(&li);
        li.hide_col(11);
        assert_col_position_invariant(&li);
        li.set_col_width(6, Pixels(300.0));
        assert_col_position_invariant(&li);
    }
}

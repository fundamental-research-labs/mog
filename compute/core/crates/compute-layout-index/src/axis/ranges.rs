use domain_types::units::Pixels;

use super::AxisIndex;

impl AxisIndex {
    /// Build a position array for the given range [start..end).
    ///
    /// Returns positions (top/left edges) for each index in `start..end`,
    /// PLUS a trailing sentinel entry at index `end` (top edge of the entry
    /// after the range - equal to `top_of(end-1) + height_of(end-1)`).
    /// The sentinel lets callers derive `height_of(end-1)` as
    /// `result[end-start] - result[end-start-1]` without a separate query.
    ///
    /// Length: `end - start + 1` for non-empty ranges, 0 for empty.
    ///
    /// # Note on `count == 0`
    /// When `self.count == 0` (no custom dimensions stored, e.g. a freshly
    /// created sheet whose column axis has never been mutated), the previous
    /// implementation clamped `end` to `self.count = 0` and returned an empty
    /// Vec even when the caller requested a non-empty range. This caused the
    /// TypeScript side to receive zero col-position bytes and store
    /// `_colPositions = null`, so the canvas fell back to the default 64 px
    /// column width and could not reflect per-column geometry.
    ///
    /// The fix: remove the `end.min(self.count)` clamp. `get_position(i)`
    /// already handles `count == 0` by returning `default_size * i`, and
    /// handles `i > count` by extrapolating from the last explicit entry.
    pub fn build_position_array(&self, start: usize, end: usize) -> Vec<f64> {
        if start >= end {
            return Vec::new();
        }
        let mut result = Vec::with_capacity(end - start + 1);
        for i in start..=end {
            result.push(self.get_position(i).0);
        }
        result
    }

    /// Build a dimension array for the given range [start..end).
    ///
    /// Returns effective sizes for each index in the range.
    pub fn build_dimension_array(&self, start: usize, end: usize) -> Vec<f64> {
        let end = end.min(self.count);
        if start >= end {
            return Vec::new();
        }
        let mut result = Vec::with_capacity(end - start);
        for i in start..end {
            result.push(self.get_dimension(i).0);
        }
        result
    }

    /// Get the visible range of indices whose positions intersect [start_px, end_px].
    /// Returns (start, end) where end is exclusive.
    pub fn get_visible_range(&self, start_px: Pixels, end_px: Pixels) -> (usize, usize) {
        if self.count == 0 || end_px.0 <= 0.0 {
            return (0, 0);
        }
        let first = self.get_index_at(start_px);
        let last = self.get_index_at(end_px);
        // exclusive end: include the entry containing end_px
        (first, (last + 1).min(self.count))
    }

    /// Total pixel size of this axis (sum of all effective dimensions).
    pub fn total_size(&self) -> Pixels {
        self.get_position(self.count)
    }
}

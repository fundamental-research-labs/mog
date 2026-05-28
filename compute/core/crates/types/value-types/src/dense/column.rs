use crate::CellError;

/// A materialized dense column -- contiguous f64 values for SIMD aggregation.
/// Non-numeric cells are stored as `f64::NAN` (skipped during aggregation).
#[derive(Debug, Clone)]
pub struct DenseColumn {
    /// Contiguous values, indexed by row offset from `start_row`. NAN for non-numeric cells.
    values: Vec<f64>,
    /// Number of actual numeric values (non-NAN entries).
    numeric_count: usize,
    /// Start row (usually 0).
    start_row: u32,
    /// Error cells in this column, sorted by row offset from `start_row`.
    /// Stored as (`row_offset`, error).
    /// When non-empty, aggregation functions (SUM, AVERAGE, MIN, MAX) must propagate
    /// the first error in the requested range instead of computing a numeric result.
    /// COUNT is the exception — it skips errors by design.
    errors: Vec<(u32, CellError)>,
}

impl DenseColumn {
    /// Create a new `DenseColumn`.
    #[must_use]
    pub fn new(
        values: Vec<f64>,
        numeric_count: usize,
        start_row: u32,
        errors: Vec<(u32, CellError)>,
    ) -> Self {
        Self {
            values,
            numeric_count,
            start_row,
            errors,
        }
    }

    /// Contiguous values, indexed by row offset from `start_row`.
    /// NAN for non-numeric cells.
    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    /// Number of actual numeric values (non-NAN entries).
    #[must_use]
    pub fn numeric_count(&self) -> usize {
        self.numeric_count
    }

    /// Start row (usually 0).
    #[must_use]
    pub fn start_row(&self) -> u32 {
        self.start_row
    }

    /// Error cells in this column, sorted by row offset from `start_row`.
    /// Stored as `(row_offset, error)`.
    #[must_use]
    pub fn errors(&self) -> &[(u32, CellError)] {
        &self.errors
    }

    /// Sum all numeric values in the range `[start_row..=end_row]`.
    /// Auto-vectorizable loop (compiler will use SIMD on supported targets).
    #[must_use]
    pub fn sum_range(&self, start_row: u32, end_row: u32) -> f64 {
        let (start, end) = self.resolve_slice_bounds(start_row, end_row);
        if start >= end {
            return 0.0;
        }
        let slice = &self.values[start..end];
        // NAN-safe: filter then sum. The filter prevents NAN from poisoning the sum.
        slice.iter().filter(|v| !v.is_nan()).sum()
    }

    /// Count numeric values in range `[start_row..=end_row]`.
    #[must_use]
    pub fn count_range(&self, start_row: u32, end_row: u32) -> usize {
        let (start, end) = self.resolve_slice_bounds(start_row, end_row);
        if start >= end {
            return 0;
        }
        self.values[start..end]
            .iter()
            .filter(|v| !v.is_nan())
            .count()
    }

    /// Min of numeric values in range `[start_row..=end_row]`.
    #[must_use]
    pub fn min_range(&self, start_row: u32, end_row: u32) -> Option<f64> {
        let (start, end) = self.resolve_slice_bounds(start_row, end_row);
        if start >= end {
            return None;
        }
        self.values[start..end]
            .iter()
            .filter(|v| !v.is_nan())
            .copied()
            .reduce(f64::min)
    }

    /// Max of numeric values in range `[start_row..=end_row]`.
    #[must_use]
    pub fn max_range(&self, start_row: u32, end_row: u32) -> Option<f64> {
        let (start, end) = self.resolve_slice_bounds(start_row, end_row);
        if start >= end {
            return None;
        }
        self.values[start..end]
            .iter()
            .filter(|v| !v.is_nan())
            .copied()
            .reduce(f64::max)
    }

    /// Average of numeric values in range `[start_row..=end_row]`.
    /// Returns `None` if no numeric values exist in the range.
    #[must_use]
    pub fn average_range(&self, start_row: u32, end_row: u32) -> Option<f64> {
        let sum = self.sum_range(start_row, end_row);
        let count = self.count_range(start_row, end_row);
        if count == 0 {
            None
        } else {
            // Safe: count is a usize from counting elements, well within f64 precision
            #[allow(clippy::cast_precision_loss)]
            Some(sum / count as f64)
        }
    }

    /// Returns the first error in the absolute row range `[start_row..=end_row]`, or `None`.
    /// Uses binary search on the sorted offset-keyed `errors` vec for O(log n) lookup.
    #[must_use]
    pub fn first_error_in_range(&self, start_row: u32, end_row: u32) -> Option<CellError> {
        if self.errors.is_empty() {
            return None;
        }
        let (start, end) = self.resolve_slice_bounds(start_row, end_row);
        if start >= end {
            return None;
        }
        let start = u32::try_from(start).unwrap_or(u32::MAX);
        let end = u32::try_from(end.saturating_sub(1)).unwrap_or(u32::MAX);
        let idx = self
            .errors
            .partition_point(|&(row_offset, _)| row_offset < start);
        if idx < self.errors.len() && self.errors[idx].0 <= end {
            Some(self.errors[idx].1)
        } else {
            None
        }
    }

    /// Convert (`start_row`, `end_row`) to (`start_idx`, `end_idx`) slice bounds.
    /// Returns (`start_idx`, `end_idx`) where `end_idx` is exclusive.
    #[inline]
    fn resolve_slice_bounds(&self, start_row: u32, end_row: u32) -> (usize, usize) {
        if start_row > end_row || end_row < self.start_row {
            return (0, 0);
        }
        let start = (start_row.saturating_sub(self.start_row) as usize).min(self.values.len());
        let end = ((end_row.saturating_sub(self.start_row)) as usize + 1).min(self.values.len());
        (start, end)
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Helper constructors
    // -----------------------------------------------------------------------

    /// Build a simple `DenseColumn` from a slice (`start_row`=0, no errors).
    fn col(values: &[f64]) -> DenseColumn {
        let numeric_count = values.iter().filter(|v| !v.is_nan()).count();
        DenseColumn::new(values.to_vec(), numeric_count, 0, vec![])
    }

    /// Build a `DenseColumn` with errors.
    fn col_with_errors(values: &[f64], errors: Vec<(u32, CellError)>) -> DenseColumn {
        let numeric_count = values.iter().filter(|v| !v.is_nan()).count();
        DenseColumn::new(values.to_vec(), numeric_count, 0, errors)
    }

    // -----------------------------------------------------------------------
    // DenseColumn — sum_range
    // -----------------------------------------------------------------------

    #[test]
    fn sum_range_basic() {
        let dc = col(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(dc.sum_range(0, 4), 15.0);
    }

    #[test]
    fn sum_range_partial() {
        let dc = col(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(dc.sum_range(1, 3), 9.0); // 2+3+4
    }

    #[test]
    fn sum_range_with_nan() {
        let dc = col(&[1.0, f64::NAN, 3.0, f64::NAN, 5.0]);
        assert_eq!(dc.sum_range(0, 4), 9.0); // 1+3+5
    }

    #[test]
    fn sum_range_empty() {
        let dc = col(&[1.0, 2.0, 3.0]);
        // start > end => 0
        assert_eq!(dc.sum_range(3, 2), 0.0);
    }

    #[test]
    fn sum_range_single_element() {
        let dc = col(&[42.0]);
        assert_eq!(dc.sum_range(0, 0), 42.0);
    }

    #[test]
    fn sum_range_all_nan() {
        let dc = col(&[f64::NAN, f64::NAN, f64::NAN]);
        assert_eq!(dc.sum_range(0, 2), 0.0);
    }

    #[test]
    fn sum_range_full_range() {
        let dc = col(&[10.0, 20.0, 30.0]);
        assert_eq!(dc.sum_range(0, 2), 60.0);
    }

    // -----------------------------------------------------------------------
    // DenseColumn — count_range
    // -----------------------------------------------------------------------

    #[test]
    fn count_range_basic() {
        let dc = col(&[1.0, 2.0, 3.0]);
        assert_eq!(dc.count_range(0, 2), 3);
    }

    #[test]
    fn count_range_with_nan() {
        let dc = col(&[1.0, f64::NAN, 3.0, f64::NAN]);
        assert_eq!(dc.count_range(0, 3), 2);
    }

    #[test]
    fn count_range_all_nan() {
        let dc = col(&[f64::NAN, f64::NAN]);
        assert_eq!(dc.count_range(0, 1), 0);
    }

    #[test]
    fn count_range_empty() {
        let dc = col(&[1.0, 2.0]);
        assert_eq!(dc.count_range(5, 3), 0);
    }

    // -----------------------------------------------------------------------
    // DenseColumn — min_range / max_range
    // -----------------------------------------------------------------------

    #[test]
    fn min_range_basic() {
        let dc = col(&[3.0, 1.0, 4.0, 1.5, 9.0]);
        assert_eq!(dc.min_range(0, 4), Some(1.0));
    }

    #[test]
    fn max_range_basic() {
        let dc = col(&[3.0, 1.0, 4.0, 1.5, 9.0]);
        assert_eq!(dc.max_range(0, 4), Some(9.0));
    }

    #[test]
    fn min_range_all_nan() {
        let dc = col(&[f64::NAN, f64::NAN]);
        assert_eq!(dc.min_range(0, 1), None);
    }

    #[test]
    fn max_range_all_nan() {
        let dc = col(&[f64::NAN, f64::NAN]);
        assert_eq!(dc.max_range(0, 1), None);
    }

    #[test]
    fn min_range_single_element() {
        let dc = col(&[7.0]);
        assert_eq!(dc.min_range(0, 0), Some(7.0));
    }

    #[test]
    fn max_range_single_element() {
        let dc = col(&[7.0]);
        assert_eq!(dc.max_range(0, 0), Some(7.0));
    }

    #[test]
    fn min_range_negative_numbers() {
        let dc = col(&[-5.0, -1.0, -10.0, 0.0]);
        assert_eq!(dc.min_range(0, 3), Some(-10.0));
    }

    #[test]
    fn max_range_negative_numbers() {
        let dc = col(&[-5.0, -1.0, -10.0]);
        assert_eq!(dc.max_range(0, 2), Some(-1.0));
    }

    #[test]
    fn min_range_with_nan() {
        let dc = col(&[f64::NAN, 3.0, 1.0, f64::NAN]);
        assert_eq!(dc.min_range(0, 3), Some(1.0));
    }

    #[test]
    fn max_range_with_nan() {
        let dc = col(&[f64::NAN, 3.0, 1.0, f64::NAN]);
        assert_eq!(dc.max_range(0, 3), Some(3.0));
    }

    #[test]
    fn min_range_empty() {
        let dc = col(&[1.0, 2.0]);
        assert_eq!(dc.min_range(5, 3), None);
    }

    #[test]
    fn max_range_empty() {
        let dc = col(&[1.0, 2.0]);
        assert_eq!(dc.max_range(5, 3), None);
    }

    // -----------------------------------------------------------------------
    // DenseColumn — average_range
    // -----------------------------------------------------------------------

    #[test]
    fn average_range_basic() {
        let dc = col(&[2.0, 4.0, 6.0]);
        assert_eq!(dc.average_range(0, 2), Some(4.0));
    }

    #[test]
    fn average_range_with_nan() {
        let dc = col(&[2.0, f64::NAN, 6.0]);
        // avg of 2 and 6 = 4
        assert_eq!(dc.average_range(0, 2), Some(4.0));
    }

    #[test]
    fn average_range_all_nan() {
        let dc = col(&[f64::NAN, f64::NAN]);
        assert_eq!(dc.average_range(0, 1), None);
    }

    #[test]
    fn average_range_single() {
        let dc = col(&[10.0]);
        assert_eq!(dc.average_range(0, 0), Some(10.0));
    }

    // -----------------------------------------------------------------------
    // DenseColumn — first_error_in_range
    // -----------------------------------------------------------------------

    #[test]
    fn first_error_no_errors() {
        let dc = col(&[1.0, 2.0, 3.0]);
        assert_eq!(dc.first_error_in_range(0, 2), None);
    }

    #[test]
    fn first_error_at_start() {
        let dc = col_with_errors(&[f64::NAN, 2.0, 3.0], vec![(0, CellError::Div0)]);
        assert_eq!(dc.first_error_in_range(0, 2), Some(CellError::Div0));
    }

    #[test]
    fn first_error_at_end() {
        let dc = col_with_errors(&[1.0, 2.0, f64::NAN], vec![(2, CellError::Value)]);
        assert_eq!(dc.first_error_in_range(0, 2), Some(CellError::Value));
    }

    #[test]
    fn first_error_in_middle() {
        let dc = col_with_errors(&[1.0, f64::NAN, 3.0], vec![(1, CellError::Na)]);
        assert_eq!(dc.first_error_in_range(0, 2), Some(CellError::Na));
    }

    #[test]
    fn first_error_multiple_returns_first_in_range() {
        let dc = col_with_errors(
            &[f64::NAN, f64::NAN, f64::NAN],
            vec![
                (0, CellError::Div0),
                (1, CellError::Na),
                (2, CellError::Value),
            ],
        );
        // Range 1..2 => first error is at row 1
        assert_eq!(dc.first_error_in_range(1, 2), Some(CellError::Na));
    }

    #[test]
    fn first_error_outside_range() {
        let dc = col_with_errors(&[f64::NAN, 2.0, 3.0], vec![(0, CellError::Div0)]);
        // Error at row 0, but we query rows 1..2
        assert_eq!(dc.first_error_in_range(1, 2), None);
    }

    #[test]
    fn first_error_with_nonzero_start_row_uses_offsets() {
        let dc = DenseColumn::new(
            vec![1.0, 2.0, f64::NAN, 4.0],
            3,
            10,
            vec![(2, CellError::Na)],
        );
        assert_eq!(dc.first_error_in_range(12, 12), Some(CellError::Na));
        assert_eq!(dc.first_error_in_range(2, 2), None);
        assert_eq!(dc.first_error_in_range(10, 11), None);
    }

    #[test]
    fn first_error_and_sum_ranges_are_absolute_rows() {
        let dc = DenseColumn::new(
            vec![10.0, f64::NAN, 30.0, 40.0],
            3,
            20,
            vec![(1, CellError::Value)],
        );
        assert_eq!(dc.sum_range(20, 22), 40.0);
        assert_eq!(dc.first_error_in_range(21, 21), Some(CellError::Value));
    }

    // -----------------------------------------------------------------------
    // DenseColumn — start_row offset
    // -----------------------------------------------------------------------

    #[test]
    fn sum_range_with_start_row_offset() {
        let dc = DenseColumn::new(vec![10.0, 20.0, 30.0], 3, 5, vec![]);
        // values map to rows 5,6,7. Query rows 5..7.
        assert_eq!(dc.sum_range(5, 7), 60.0);
        // Query rows 6..6 => just 20.0
        assert_eq!(dc.sum_range(6, 6), 20.0);
        // Query rows 6..7 => 20+30
        assert_eq!(dc.sum_range(6, 7), 50.0);
    }

    #[test]
    fn range_normalization_caps_to_column_extent() {
        let dc = DenseColumn::new(vec![10.0, 20.0, 30.0], 3, 5, vec![]);
        assert_eq!(dc.sum_range(0, 20), 60.0);
        assert_eq!(dc.count_range(0, 4), 0);
        assert_eq!(dc.max_range(6, 20), Some(30.0));
    }

    // -----------------------------------------------------------------------
    // DenseColumn — accessors
    // -----------------------------------------------------------------------

    #[test]
    fn accessors() {
        let dc = DenseColumn::new(vec![1.0, 2.0], 2, 10, vec![(0, CellError::Na)]);
        assert_eq!(dc.values(), &[1.0, 2.0]);
        assert_eq!(dc.numeric_count(), 2);
        assert_eq!(dc.start_row(), 10);
        assert_eq!(dc.errors(), &[(0, CellError::Na)]);
    }

    // -----------------------------------------------------------------------
    // Edge cases — zero-length inputs
    // -----------------------------------------------------------------------

    #[test]
    fn empty_dense_column() {
        let dc = col(&[]);
        assert_eq!(dc.sum_range(0, 0), 0.0);
        assert_eq!(dc.count_range(0, 0), 0);
        assert_eq!(dc.min_range(0, 0), None);
        assert_eq!(dc.max_range(0, 0), None);
        assert_eq!(dc.average_range(0, 0), None);
        assert_eq!(dc.first_error_in_range(0, 0), None);
    }

    // -----------------------------------------------------------------------
    // Edge cases — single element
    // -----------------------------------------------------------------------

    #[test]
    fn single_element_column_operations() {
        let dc = col(&[42.0]);
        assert_eq!(dc.sum_range(0, 0), 42.0);
        assert_eq!(dc.count_range(0, 0), 1);
        assert_eq!(dc.min_range(0, 0), Some(42.0));
        assert_eq!(dc.max_range(0, 0), Some(42.0));
        assert_eq!(dc.average_range(0, 0), Some(42.0));
    }

    #[test]
    fn single_element_nan_column() {
        let dc = col(&[f64::NAN]);
        assert_eq!(dc.sum_range(0, 0), 0.0);
        assert_eq!(dc.count_range(0, 0), 0);
        assert_eq!(dc.min_range(0, 0), None);
        assert_eq!(dc.max_range(0, 0), None);
        assert_eq!(dc.average_range(0, 0), None);
    }
}

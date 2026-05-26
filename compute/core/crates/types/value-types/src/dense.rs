//! Dense columnar value types for SIMD-accelerated aggregation.
//!
//! Pure data types with zero internal dependencies. The materialization
//! logic and cache management live in `mirror/dense.rs`.

use crate::CellError;

/// Minimum number of cells in a range before the dense path is used.
/// Below this threshold, direct `FxHashMap` iteration is fast enough.
pub const DENSE_THRESHOLD: usize = 1000;

// ---------------------------------------------------------------------------
// DenseColumn
// ---------------------------------------------------------------------------

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
    /// Error cells in this column, sorted by row. Stored as (`row_offset`, error).
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

    /// Error cells in this column, sorted by row.
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

    /// Returns the first error in the range `[start_row..=end_row]`, or `None`.
    /// Uses binary search on the sorted `errors` vec for O(log n) lookup.
    #[must_use]
    pub fn first_error_in_range(&self, start_row: u32, end_row: u32) -> Option<CellError> {
        if self.errors.is_empty() {
            return None;
        }
        // Binary search for the first error with row >= start_row
        let idx = self.errors.partition_point(|&(row, _)| row < start_row);
        if idx < self.errors.len() && self.errors[idx].0 <= end_row {
            Some(self.errors[idx].1)
        } else {
            None
        }
    }

    /// Convert (`start_row`, `end_row`) to (`start_idx`, `end_idx`) slice bounds.
    /// Returns (`start_idx`, `end_idx`) where `end_idx` is exclusive.
    #[inline]
    fn resolve_slice_bounds(&self, start_row: u32, end_row: u32) -> (usize, usize) {
        let start = start_row.saturating_sub(self.start_row) as usize;
        let end = ((end_row.saturating_sub(self.start_row)) as usize + 1).min(self.values.len());
        (start, end)
    }
}

// ---------------------------------------------------------------------------
// DenseBoolMask
// ---------------------------------------------------------------------------

/// Parallel bitvec tracking which rows in a `DenseColumn` are boolean-sourced.
/// Uses packed u64 words (1 bit per row) for 8x less memory than `Vec<bool>`.
/// For 1M rows: `Vec<bool>` = 1MB, `BitVec` = 125KB.
#[derive(Debug, Clone)]
pub struct DenseBoolMask {
    /// Packed bits: bit i = 1 if `DenseColumn::values()[i]` came from `CellValue::Boolean`.
    /// Word j, bit k corresponds to row (j * 64 + k).
    words: Vec<u64>,
    /// Start row for this mask.
    start_row: u32,
    /// Number of rows covered by this mask.
    len: u32,
}

impl DenseBoolMask {
    /// Create a new `DenseBoolMask` with all bits cleared.
    #[must_use]
    pub fn new(words: Vec<u64>, start_row: u32, len: u32) -> Self {
        Self {
            words,
            start_row,
            len,
        }
    }

    /// Packed bit words. Word j, bit k corresponds to row (j * 64 + k).
    #[must_use]
    pub fn words(&self) -> &[u64] {
        &self.words
    }

    /// Start row for this mask.
    #[must_use]
    pub fn start_row(&self) -> u32 {
        self.start_row
    }

    /// Number of rows covered by this mask.
    #[must_use]
    pub fn len(&self) -> u32 {
        self.len
    }

    /// Returns true if row `i` (relative to `start_row`) is boolean-sourced.
    #[inline]
    #[must_use]
    pub fn is_bool(&self, i: usize) -> bool {
        if i >= self.len as usize {
            return false;
        }
        let word_idx = i / 64;
        let bit_idx = i % 64;
        if word_idx >= self.words.len() {
            return false;
        }
        (self.words[word_idx] >> bit_idx) & 1 == 1
    }

    /// Returns true if any bit is set in [start..end) (relative to `start_row`).
    #[must_use]
    pub fn any_in_range(&self, start: usize, end: usize) -> bool {
        let end = end.min(self.len as usize);
        if start >= end {
            return false;
        }
        let start_word = start / 64;
        let end_word = (end.saturating_sub(1)) / 64;

        if start_word == end_word {
            // Same word: mask the relevant bits
            let word = if start_word < self.words.len() {
                self.words[start_word]
            } else {
                return false;
            };
            let lo = start % 64;
            let hi = end % 64;
            // Mask from bit lo up to (but not including) bit hi.
            // If hi == 0, it means end is on a word boundary -- all bits from lo..64.
            let mask = if hi == 0 {
                !0u64 << lo
            } else {
                ((!0u64) << lo) & ((!0u64) >> (64 - hi))
            };
            return (word & mask) != 0;
        }

        // Check first partial word
        if start_word < self.words.len() {
            let lo = start % 64;
            let mask = !0u64 << lo;
            if (self.words[start_word] & mask) != 0 {
                return true;
            }
        }

        // Check full middle words
        for w in (start_word + 1)..end_word {
            if w < self.words.len() && self.words[w] != 0 {
                return true;
            }
        }

        // Check last partial word
        if end_word < self.words.len() {
            let hi = end % 64;
            let mask = if hi == 0 { !0u64 } else { (!0u64) >> (64 - hi) };
            if (self.words[end_word] & mask) != 0 {
                return true;
            }
        }

        false
    }

    /// Count of boolean-sourced rows in [start..end).
    #[must_use]
    pub fn count_in_range(&self, start: usize, end: usize) -> u32 {
        let end = end.min(self.len as usize);
        if start >= end {
            return 0;
        }
        let start_word = start / 64;
        let end_word = (end.saturating_sub(1)) / 64;

        if start_word == end_word {
            let word = if start_word < self.words.len() {
                self.words[start_word]
            } else {
                return 0;
            };
            let lo = start % 64;
            let hi = end % 64;
            let mask = if hi == 0 {
                !0u64 << lo
            } else {
                ((!0u64) << lo) & ((!0u64) >> (64 - hi))
            };
            return (word & mask).count_ones();
        }

        let mut count = 0u32;

        // First partial word
        if start_word < self.words.len() {
            let lo = start % 64;
            let mask = !0u64 << lo;
            count += (self.words[start_word] & mask).count_ones();
        }

        // Full middle words
        for w in (start_word + 1)..end_word {
            if w < self.words.len() {
                count += self.words[w].count_ones();
            }
        }

        // Last partial word
        if end_word < self.words.len() {
            let hi = end % 64;
            let mask = if hi == 0 { !0u64 } else { (!0u64) >> (64 - hi) };
            count += (self.words[end_word] & mask).count_ones();
        }

        count
    }

    /// Sum of `dense.values()[i]` where `is_bool(i)` is true, for `i` in `[start..end)`.
    #[must_use]
    pub fn bool_sum(&self, dense_values: &[f64], start: usize, end: usize) -> f64 {
        let end = end.min(self.len as usize).min(dense_values.len());
        if start >= end {
            return 0.0;
        }
        let mut sum = 0.0f64;
        // Iterate word-by-word for efficiency
        let start_word = start / 64;
        let end_word = (end.saturating_sub(1)) / 64;

        for w in start_word..=end_word {
            if w >= self.words.len() {
                break;
            }
            let mut word = self.words[w];
            if word == 0 {
                continue;
            }

            // Mask out bits outside [start..end)
            let word_base = w * 64;
            if w == start_word {
                let lo = start % 64;
                word &= !0u64 << lo;
            }
            if w == end_word {
                let hi = end % 64;
                if hi != 0 {
                    word &= (!0u64) >> (64 - hi);
                }
            }

            // Iterate over set bits
            while word != 0 {
                let bit = word.trailing_zeros() as usize;
                let idx = word_base + bit;
                if idx < end && idx < dense_values.len() {
                    let v = dense_values[idx];
                    if !v.is_nan() {
                        sum += v;
                    }
                }
                word &= word - 1; // clear lowest set bit
            }
        }
        sum
    }

    /// Returns true if no bits are set (no booleans in the column).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.words.iter().all(|&w| w == 0)
    }

    /// Set bit `i` (relative to `start_row`) to 1.
    #[inline]
    pub fn set_bit(&mut self, i: usize) {
        let word_idx = i / 64;
        let bit_idx = i % 64;
        if word_idx < self.words.len() {
            self.words[word_idx] |= 1u64 << bit_idx;
        }
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

    /// Build a zeroed `DenseBoolMask` covering `len` rows (`start_row`=0).
    fn mask(len: u32) -> DenseBoolMask {
        let num_words = (len as usize).div_ceil(64);
        DenseBoolMask::new(vec![0u64; num_words], 0, len)
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
    // DenseBoolMask — new / is_bool / set_bit
    // -----------------------------------------------------------------------

    #[test]
    fn mask_new_all_false() {
        let m = mask(128);
        assert_eq!(m.len(), 128);
        assert_eq!(m.start_row(), 0);
        assert_eq!(m.words().len(), 2);
        for i in 0..128 {
            assert!(!m.is_bool(i));
        }
    }

    #[test]
    fn mask_set_and_check_bits() {
        let mut m = mask(128);
        m.set_bit(0);
        m.set_bit(63);
        m.set_bit(64);
        m.set_bit(127);
        assert!(m.is_bool(0));
        assert!(m.is_bool(63));
        assert!(m.is_bool(64));
        assert!(m.is_bool(127));
        assert!(!m.is_bool(1));
        assert!(!m.is_bool(65));
    }

    #[test]
    fn mask_is_bool_out_of_range() {
        let m = mask(10);
        // Beyond len => false
        assert!(!m.is_bool(10));
        assert!(!m.is_bool(100));
    }

    #[test]
    fn mask_is_empty() {
        let m = mask(64);
        assert!(m.is_empty());

        let mut m2 = mask(64);
        m2.set_bit(5);
        assert!(!m2.is_empty());
    }

    // -----------------------------------------------------------------------
    // DenseBoolMask — any_in_range
    // -----------------------------------------------------------------------

    #[test]
    fn any_in_range_all_false() {
        let m = mask(128);
        assert!(!m.any_in_range(0, 128));
    }

    #[test]
    fn any_in_range_one_true() {
        let mut m = mask(128);
        m.set_bit(50);
        assert!(m.any_in_range(0, 128));
        assert!(m.any_in_range(50, 51));
        assert!(!m.any_in_range(51, 60));
        assert!(!m.any_in_range(0, 50));
    }

    #[test]
    fn any_in_range_empty_range() {
        let mut m = mask(64);
        m.set_bit(0);
        assert!(!m.any_in_range(5, 5)); // empty range
        assert!(!m.any_in_range(10, 5)); // start > end
    }

    #[test]
    fn any_in_range_cross_word_boundary() {
        let mut m = mask(200);
        m.set_bit(100); // in word 1 (bits 64..127)
        assert!(m.any_in_range(60, 110));
        assert!(!m.any_in_range(101, 200));
    }

    #[test]
    fn any_in_range_last_bit_of_word() {
        let mut m = mask(128);
        m.set_bit(63);
        assert!(m.any_in_range(63, 64));
        assert!(!m.any_in_range(64, 128));
    }

    // -----------------------------------------------------------------------
    // DenseBoolMask — count_in_range
    // -----------------------------------------------------------------------

    #[test]
    fn count_in_range_basic() {
        let mut m = mask(64);
        m.set_bit(0);
        m.set_bit(10);
        m.set_bit(63);
        assert_eq!(m.count_in_range(0, 64), 3);
    }

    #[test]
    fn count_in_range_partial() {
        let mut m = mask(64);
        m.set_bit(0);
        m.set_bit(10);
        m.set_bit(63);
        assert_eq!(m.count_in_range(5, 20), 1); // only bit 10
    }

    #[test]
    fn count_in_range_empty() {
        let m = mask(64);
        assert_eq!(m.count_in_range(0, 64), 0);
    }

    #[test]
    fn count_in_range_cross_word() {
        let mut m = mask(200);
        // Set bits across three words
        m.set_bit(10); // word 0
        m.set_bit(63); // word 0, last bit
        m.set_bit(64); // word 1, first bit
        m.set_bit(100); // word 1
        m.set_bit(128); // word 2, first bit
        m.set_bit(190); // word 2
        assert_eq!(m.count_in_range(0, 200), 6);
        assert_eq!(m.count_in_range(60, 130), 4); // 63, 64, 100, 128
        assert_eq!(m.count_in_range(64, 128), 2); // 64, 100
    }

    #[test]
    fn count_in_range_single_bit() {
        let mut m = mask(128);
        m.set_bit(70);
        assert_eq!(m.count_in_range(70, 71), 1);
        assert_eq!(m.count_in_range(69, 70), 0);
    }

    // -----------------------------------------------------------------------
    // DenseBoolMask — bool_sum
    // -----------------------------------------------------------------------

    #[test]
    fn bool_sum_basic() {
        let mut m = mask(5);
        m.set_bit(0);
        m.set_bit(2);
        m.set_bit(4);
        let values = [1.0, 2.0, 3.0, 4.0, 5.0];
        // sum of values[0] + values[2] + values[4] = 1+3+5 = 9
        assert_eq!(m.bool_sum(&values, 0, 5), 9.0);
    }

    #[test]
    fn bool_sum_all_true() {
        let mut m = mask(3);
        m.set_bit(0);
        m.set_bit(1);
        m.set_bit(2);
        let values = [10.0, 20.0, 30.0];
        assert_eq!(m.bool_sum(&values, 0, 3), 60.0);
    }

    #[test]
    fn bool_sum_all_false() {
        let m = mask(3);
        let values = [10.0, 20.0, 30.0];
        assert_eq!(m.bool_sum(&values, 0, 3), 0.0);
    }

    #[test]
    fn bool_sum_with_nan() {
        let mut m = mask(3);
        m.set_bit(0);
        m.set_bit(1);
        m.set_bit(2);
        let values = [1.0, f64::NAN, 3.0];
        // NaN is skipped => 1+3 = 4
        assert_eq!(m.bool_sum(&values, 0, 3), 4.0);
    }

    #[test]
    fn bool_sum_partial_range() {
        let mut m = mask(5);
        m.set_bit(0);
        m.set_bit(1);
        m.set_bit(2);
        m.set_bit(3);
        m.set_bit(4);
        let values = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(m.bool_sum(&values, 2, 4), 7.0); // 3+4
    }

    #[test]
    fn bool_sum_empty_range() {
        let mut m = mask(5);
        m.set_bit(0);
        let values = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(m.bool_sum(&values, 3, 3), 0.0);
        assert_eq!(m.bool_sum(&values, 5, 3), 0.0);
    }

    #[test]
    fn bool_sum_cross_word_boundary() {
        let mut m = mask(128);
        m.set_bit(63);
        m.set_bit(64);
        let mut values = vec![0.0; 128];
        values[63] = 100.0;
        values[64] = 200.0;
        assert_eq!(m.bool_sum(&values, 60, 70), 300.0);
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

    #[test]
    fn zero_length_mask() {
        let m = DenseBoolMask::new(vec![], 0, 0);
        assert!(!m.is_bool(0));
        assert!(!m.any_in_range(0, 0));
        assert_eq!(m.count_in_range(0, 0), 0);
        assert_eq!(m.bool_sum(&[], 0, 0), 0.0);
        assert!(m.is_empty());
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

    #[test]
    fn single_element_mask() {
        let mut m = mask(1);
        assert!(!m.is_bool(0));
        assert!(!m.any_in_range(0, 1));
        assert_eq!(m.count_in_range(0, 1), 0);

        m.set_bit(0);
        assert!(m.is_bool(0));
        assert!(m.any_in_range(0, 1));
        assert_eq!(m.count_in_range(0, 1), 1);
        assert_eq!(m.bool_sum(&[5.0], 0, 1), 5.0);
    }

    // -----------------------------------------------------------------------
    // Edge cases — cross-word boundary (> 64 elements)
    // -----------------------------------------------------------------------

    #[test]
    fn mask_many_bits_set_across_words() {
        let mut m = mask(256);
        // Set every 13th bit to cover multiple words
        for i in (0..256).step_by(13) {
            m.set_bit(i);
        }
        // Count: 0,13,26,39,52,65,78,91,104,117,130,143,156,169,182,195,208,221,234,247 = 20 bits
        assert_eq!(m.count_in_range(0, 256), 20);
        assert!(m.any_in_range(0, 256));

        // Check a range spanning words 0 and 1 (bits 50..80)
        // Set bits in that range: 52, 65, 78
        assert_eq!(m.count_in_range(50, 80), 3);
    }

    #[test]
    fn bool_sum_large_cross_word() {
        let n: usize = 200;
        let mut m = mask(u32::try_from(n).unwrap());
        let mut values = vec![0.0; n];
        // Set every other bit and give those positions value 1.0
        for i in (0..n).step_by(2) {
            m.set_bit(i);
            values[i] = 1.0;
        }
        // 100 bits set, each with value 1.0
        assert_eq!(m.bool_sum(&values, 0, n), 100.0);
        // Partial range across word boundary (60..70)
        // Even indices in 60..70: 60,62,64,66,68 => 5 bits
        assert_eq!(m.bool_sum(&values, 60, 70), 5.0);
    }

    #[test]
    fn count_in_range_all_bits_set_multi_word() {
        // All bits set in a 3-word mask
        let m = DenseBoolMask::new(vec![!0u64, !0u64, !0u64], 0, 192);
        assert_eq!(m.count_in_range(0, 192), 192);
        assert_eq!(m.count_in_range(10, 100), 90);
        assert_eq!(m.count_in_range(63, 65), 2);
    }
}

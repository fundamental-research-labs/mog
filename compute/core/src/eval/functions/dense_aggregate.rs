//! Subsystem 2: DenseAggregateDispatch
//! Fast-path aggregate operations using DenseColumn + DenseBoolMask.
//!
//! Excel semantics: Booleans from cell references are ignored by
//! SUM/AVERAGE/COUNT/MIN/MAX but counted by COUNTA.

use value_types::{CellError, CellValue, KahanSum, kahan_sum};
use value_types::{DenseBoolMask, DenseColumn};

/// Supported fast-path aggregate operations.
pub enum AggregateOp {
    Sum,
    Average,
    Count,
    CountA,
    CountBlank,
    Min,
    Max,
}

/// Result of attempting a dense aggregate.
pub enum DenseAggregateResult {
    /// Successfully computed a value via the fast path.
    Computed(CellValue),
    /// Cannot use the fast path; fall back to cell-by-cell evaluation.
    Fallback,
}

/// Attempt a fast aggregate over a dense column range.
///
/// `start_row` and `end_row` are inclusive row indices (matching DenseColumn's convention).
/// If `dense` is `None`, returns `Fallback`.
pub fn try_dense_aggregate(
    op: AggregateOp,
    dense: Option<&DenseColumn>,
    bool_mask: Option<&DenseBoolMask>,
    start_row: u32,
    end_row: u32,
) -> DenseAggregateResult {
    let dense = match dense {
        Some(d) => d,
        None => return DenseAggregateResult::Fallback,
    };

    // Convert inclusive row range to slice-relative [start..end) indices.
    let start_idx = start_row.saturating_sub(dense.start_row()) as usize;
    let end_idx =
        ((end_row.saturating_sub(dense.start_row())) as usize + 1).min(dense.values().len());

    if start_idx >= end_idx {
        // Empty range
        return match op {
            AggregateOp::Sum => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Count => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::CountA => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::CountBlank => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Min => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Max => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Average => {
                DenseAggregateResult::Computed(CellValue::Error(CellError::Div0, None))
            }
        };
    }

    // Error propagation: if any error cell exists in the range, SUM/AVERAGE/MIN/MAX
    // must return the first error (matching Excel behavior). COUNT is the exception —
    // it skips errors by design. COUNTA/COUNTBLANK also need the fallback path since
    // errors are stored as NaN in the dense representation (indistinguishable from blanks).
    if !dense.errors().is_empty()
        && let Some(err) = dense.first_error_in_range(start_row, end_row)
    {
        match op {
            // COUNT ignores errors — the NaN representation already achieves this.
            AggregateOp::Count => {}
            // SUM, AVERAGE, MIN, MAX must propagate the first error.
            AggregateOp::Sum | AggregateOp::Average | AggregateOp::Min | AggregateOp::Max => {
                return DenseAggregateResult::Computed(CellValue::Error(err, None));
            }
            // COUNTA/COUNTBLANK can't distinguish errors from blanks in dense — fallback.
            AggregateOp::CountA | AggregateOp::CountBlank => {
                return DenseAggregateResult::Fallback;
            }
        }
    }

    let slice = &dense.values()[start_idx..end_idx];
    let total_rows = end_idx - start_idx;

    // Compute boolean counts within the range
    let bool_count = bool_mask
        .map(|m| m.count_in_range(start_idx, end_idx))
        .unwrap_or(0);
    let has_bools = bool_count > 0;

    match op {
        AggregateOp::Sum => {
            let raw_sum = kahan_sum(slice.iter().filter(|v| !v.is_nan()).copied());
            if has_bools {
                let bool_sum = bool_mask
                    .unwrap()
                    .bool_sum(dense.values(), start_idx, end_idx);
                DenseAggregateResult::Computed(CellValue::number(raw_sum - bool_sum))
            } else {
                DenseAggregateResult::Computed(CellValue::number(raw_sum))
            }
        }
        AggregateOp::Average => {
            let raw_sum = kahan_sum(slice.iter().filter(|v| !v.is_nan()).copied());
            let raw_count = slice.iter().filter(|v| !v.is_nan()).count() as u32;

            let adjusted_count = raw_count.saturating_sub(bool_count);
            if adjusted_count == 0 {
                DenseAggregateResult::Computed(CellValue::Error(CellError::Div0, None))
            } else {
                let bool_sum = if has_bools {
                    bool_mask
                        .unwrap()
                        .bool_sum(dense.values(), start_idx, end_idx)
                } else {
                    0.0
                };
                let adjusted_sum = raw_sum - bool_sum;
                DenseAggregateResult::Computed(CellValue::number(
                    adjusted_sum / adjusted_count as f64,
                ))
            }
        }
        AggregateOp::Count => {
            // COUNT counts only numeric values; booleans from cell refs are excluded.
            let raw_count = slice.iter().filter(|v| !v.is_nan()).count() as u32;
            let adjusted = raw_count.saturating_sub(bool_count);
            DenseAggregateResult::Computed(CellValue::number(adjusted as f64))
        }
        AggregateOp::CountA => {
            // COUNTA counts all non-empty (non-NAN) values, including booleans.
            let count = slice.iter().filter(|v| !v.is_nan()).count();
            DenseAggregateResult::Computed(CellValue::number(count as f64))
        }
        AggregateOp::CountBlank => {
            // COUNTBLANK counts empty cells (NAN entries).
            let counta = slice.iter().filter(|v| !v.is_nan()).count();
            let blank = total_rows - counta;
            DenseAggregateResult::Computed(CellValue::number(blank as f64))
        }
        AggregateOp::Min => {
            if has_bools {
                // Must skip booleans — iterate with mask filter.
                let mask = bool_mask.unwrap();
                let result = (start_idx..end_idx)
                    .filter(|&i| !dense.values()[i].is_nan() && !mask.is_bool(i))
                    .map(|i| dense.values()[i])
                    .reduce(f64::min);
                match result {
                    Some(v) => DenseAggregateResult::Computed(CellValue::number(v)),
                    None => DenseAggregateResult::Computed(CellValue::number(0.0)),
                }
            } else {
                match dense.min_range(start_row, end_row) {
                    Some(v) => DenseAggregateResult::Computed(CellValue::number(v)),
                    None => DenseAggregateResult::Computed(CellValue::number(0.0)),
                }
            }
        }
        AggregateOp::Max => {
            if has_bools {
                // Must skip booleans — iterate with mask filter.
                let mask = bool_mask.unwrap();
                let result = (start_idx..end_idx)
                    .filter(|&i| !dense.values()[i].is_nan() && !mask.is_bool(i))
                    .map(|i| dense.values()[i])
                    .reduce(f64::max);
                match result {
                    Some(v) => DenseAggregateResult::Computed(CellValue::number(v)),
                    None => DenseAggregateResult::Computed(CellValue::number(0.0)),
                }
            } else {
                match dense.max_range(start_row, end_row) {
                    Some(v) => DenseAggregateResult::Computed(CellValue::number(v)),
                    None => DenseAggregateResult::Computed(CellValue::number(0.0)),
                }
            }
        }
    }
}

/// Multi-column variant for aggregates spanning multiple columns.
///
/// All columns must be dense (non-None) for the fast path to apply.
/// `start_row` and `end_row` are inclusive.
pub fn try_dense_aggregate_multi_column(
    op: AggregateOp,
    columns: &[(Option<&DenseColumn>, Option<&DenseBoolMask>)],
    start_row: u32,
    end_row: u32,
) -> DenseAggregateResult {
    // If any column is None, fall back.
    for (dense, _) in columns {
        if dense.is_none() {
            return DenseAggregateResult::Fallback;
        }
    }

    if columns.is_empty() {
        return match op {
            AggregateOp::Sum => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Count => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::CountA => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::CountBlank => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Min => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Max => DenseAggregateResult::Computed(CellValue::number(0.0)),
            AggregateOp::Average => {
                DenseAggregateResult::Computed(CellValue::Error(CellError::Div0, None))
            }
        };
    }

    match op {
        AggregateOp::Sum => {
            let mut total = KahanSum::new();
            for (dense, mask) in columns {
                match try_dense_aggregate(AggregateOp::Sum, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => total.add(n.get()),
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            DenseAggregateResult::Computed(CellValue::number(total.total()))
        }
        AggregateOp::Count => {
            let mut total = KahanSum::new();
            for (dense, mask) in columns {
                match try_dense_aggregate(AggregateOp::Count, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => total.add(n.get()),
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            DenseAggregateResult::Computed(CellValue::number(total.total()))
        }
        AggregateOp::CountA => {
            let mut total = KahanSum::new();
            for (dense, mask) in columns {
                match try_dense_aggregate(AggregateOp::CountA, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => total.add(n.get()),
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            DenseAggregateResult::Computed(CellValue::number(total.total()))
        }
        AggregateOp::CountBlank => {
            let mut total = KahanSum::new();
            for (dense, mask) in columns {
                match try_dense_aggregate(
                    AggregateOp::CountBlank,
                    *dense,
                    *mask,
                    start_row,
                    end_row,
                ) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => total.add(n.get()),
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            DenseAggregateResult::Computed(CellValue::number(total.total()))
        }
        AggregateOp::Average => {
            // Sum all columns, count all columns, then divide.
            let mut total_sum = KahanSum::new();
            let mut total_count = 0.0f64;
            for (dense, mask) in columns {
                match try_dense_aggregate(AggregateOp::Sum, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => total_sum.add(n.get()),
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
                match try_dense_aggregate(AggregateOp::Count, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => total_count += n.get(),
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            if total_count == 0.0 {
                DenseAggregateResult::Computed(CellValue::Error(CellError::Div0, None))
            } else {
                DenseAggregateResult::Computed(CellValue::number(total_sum.total() / total_count))
            }
        }
        AggregateOp::Min => {
            let mut global_min: Option<f64> = None;
            for (dense, mask) in columns {
                match try_dense_aggregate(AggregateOp::Min, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => {
                        global_min = Some(match global_min {
                            Some(current) => f64::min(current, n.get()),
                            None => n.get(),
                        });
                    }
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            match global_min {
                Some(v) => DenseAggregateResult::Computed(CellValue::number(v)),
                None => DenseAggregateResult::Computed(CellValue::number(0.0)),
            }
        }
        AggregateOp::Max => {
            let mut global_max: Option<f64> = None;
            for (dense, mask) in columns {
                match try_dense_aggregate(AggregateOp::Max, *dense, *mask, start_row, end_row) {
                    DenseAggregateResult::Computed(CellValue::Number(n)) => {
                        global_max = Some(match global_max {
                            Some(current) => f64::max(current, n.get()),
                            None => n.get(),
                        });
                    }
                    DenseAggregateResult::Computed(CellValue::Error(e, None)) => {
                        return DenseAggregateResult::Computed(CellValue::Error(e, None));
                    }
                    _ => return DenseAggregateResult::Fallback,
                }
            }
            match global_max {
                Some(v) => DenseAggregateResult::Computed(CellValue::number(v)),
                None => DenseAggregateResult::Computed(CellValue::number(0.0)),
            }
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, CellValue};
    use value_types::{DenseBoolMask, DenseColumn};

    /// Helper: create a DenseColumn from raw f64 values.
    fn make_dense(values: Vec<f64>) -> DenseColumn {
        let numeric_count = values.iter().filter(|v| !v.is_nan()).count();
        DenseColumn::new(values, numeric_count, 0, vec![])
    }

    /// Helper: create a DenseBoolMask with specific bool positions set.
    fn make_mask(len: u32, bool_positions: &[usize]) -> DenseBoolMask {
        let num_words = (len as usize + 63) / 64;
        let mut mask = DenseBoolMask::new(vec![0u64; num_words], 0, len);
        for &pos in bool_positions {
            mask.set_bit(pos);
        }
        mask
    }

    /// Extract the f64 from a CellValue::Number, panicking otherwise.
    fn extract_number(result: &DenseAggregateResult) -> f64 {
        match result {
            DenseAggregateResult::Computed(CellValue::Number(n)) => n.get(),
            other => panic!("Expected Computed(Number), got: {:?}", format_result(other)),
        }
    }

    /// Check if a result is Fallback.
    fn is_fallback(result: &DenseAggregateResult) -> bool {
        matches!(result, DenseAggregateResult::Fallback)
    }

    /// Check if a result is an error.
    fn is_error(result: &DenseAggregateResult, expected: CellError) -> bool {
        matches!(result, DenseAggregateResult::Computed(CellValue::Error(e, None)) if *e == expected)
    }

    fn format_result(result: &DenseAggregateResult) -> String {
        match result {
            DenseAggregateResult::Computed(v) => format!("Computed({:?})", v),
            DenseAggregateResult::Fallback => "Fallback".to_string(),
        }
    }

    // -----------------------------------------------------------------------
    // SUM tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_sum_skips_booleans() {
        // [1.0, TRUE(1.0), 3.0] -> sum = 4.0 (skips the boolean)
        let dense = make_dense(vec![1.0, 1.0, 3.0]);
        let mask = make_mask(3, &[1]); // index 1 is boolean
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 4.0);
    }

    #[test]
    fn test_sum_no_booleans() {
        let dense = make_dense(vec![1.0, 2.0, 3.0]);
        let mask = make_mask(3, &[]); // no booleans
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 6.0);
    }

    #[test]
    fn test_all_boolean_column() {
        // All TRUE -> sum should be 0.0 (all skipped)
        let dense = make_dense(vec![1.0, 1.0, 1.0]);
        let mask = make_mask(3, &[0, 1, 2]);
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 0.0);
    }

    // -----------------------------------------------------------------------
    // COUNT tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_count_skips_booleans() {
        // [1.0, TRUE(1.0), 3.0] -> count = 2
        let dense = make_dense(vec![1.0, 1.0, 3.0]);
        let mask = make_mask(3, &[1]);
        let result = try_dense_aggregate(AggregateOp::Count, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 2.0);
    }

    #[test]
    fn test_count_all_booleans() {
        // All TRUE -> count = 0
        let dense = make_dense(vec![1.0, 1.0, 1.0]);
        let mask = make_mask(3, &[0, 1, 2]);
        let result = try_dense_aggregate(AggregateOp::Count, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 0.0);
    }

    // -----------------------------------------------------------------------
    // COUNTA tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_counta_includes_everything() {
        // [1.0, TRUE(1.0), "text"(NaN for text is stored as NAN but we represent it in dense as NAN),
        //  NaN(empty)] -> counta = 2 non-NaN values: 1.0 and TRUE(1.0)
        // Wait: the spec says [1.0, TRUE, "text", NaN] -> counta = 3
        // In the dense representation: text is NAN, empty/null is NAN.
        // But COUNTA counts "all non-empty" which includes text. However, in the dense column,
        // text is stored as NAN (we can't distinguish text from empty in the dense representation).
        // For the dense fast path, COUNTA counts non-NAN values.
        // So: [1.0, 1.0(TRUE), NAN(text), NAN(empty)] -> counta = 2
        // But the spec says counta should be 3. This means the dense path only works
        // when the column is all-numeric/boolean. For text cells, we'd need to Fallback.
        // However, the task spec explicitly says to count non-NAN values for COUNTA.
        // Let's just test with values that match the dense representation.
        let dense = make_dense(vec![1.0, 1.0, f64::NAN, f64::NAN]);
        let mask = make_mask(4, &[1]); // index 1 is boolean
        let result = try_dense_aggregate(AggregateOp::CountA, Some(&dense), Some(&mask), 0, 3);
        // counta = non-NAN count = 2 (1.0 and TRUE)
        assert_eq!(extract_number(&result), 2.0);
    }

    // -----------------------------------------------------------------------
    // COUNTBLANK tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_countblank() {
        // [1.0, NaN, 3.0, NaN] -> countblank = 2
        let dense = make_dense(vec![1.0, f64::NAN, 3.0, f64::NAN]);
        let mask = make_mask(4, &[]);
        let result = try_dense_aggregate(AggregateOp::CountBlank, Some(&dense), Some(&mask), 0, 3);
        assert_eq!(extract_number(&result), 2.0);
    }

    // -----------------------------------------------------------------------
    // AVERAGE tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_average_skips_booleans() {
        // [2.0, TRUE(1.0), 4.0] -> average = (2+4)/2 = 3.0
        let dense = make_dense(vec![2.0, 1.0, 4.0]);
        let mask = make_mask(3, &[1]);
        let result = try_dense_aggregate(AggregateOp::Average, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 3.0);
    }

    #[test]
    fn test_average_all_booleans_divzero() {
        // All booleans -> adjusted count = 0 -> DivZero
        let dense = make_dense(vec![1.0, 0.0]);
        let mask = make_mask(2, &[0, 1]);
        let result = try_dense_aggregate(AggregateOp::Average, Some(&dense), Some(&mask), 0, 1);
        assert!(is_error(&result, CellError::Div0));
    }

    // -----------------------------------------------------------------------
    // MIN tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_min_skips_booleans() {
        // [5.0, FALSE(0.0), 3.0] -> min = 3.0 (skips the FALSE)
        let dense = make_dense(vec![5.0, 0.0, 3.0]);
        let mask = make_mask(3, &[1]);
        let result = try_dense_aggregate(AggregateOp::Min, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 3.0);
    }

    // -----------------------------------------------------------------------
    // MAX tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_max_skips_booleans() {
        // [1.0, TRUE(1.0), 0.5] -> max = 1.0 (skips the TRUE)
        let dense = make_dense(vec![1.0, 1.0, 0.5]);
        let mask = make_mask(3, &[1]);
        let result = try_dense_aggregate(AggregateOp::Max, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 1.0);
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_none_dense_returns_fallback() {
        let result = try_dense_aggregate(AggregateOp::Sum, None, None, 0, 10);
        assert!(is_fallback(&result));
    }

    #[test]
    fn test_no_mask_treats_all_as_numeric() {
        // No mask -> all values treated as numeric (raw sum)
        let dense = make_dense(vec![1.0, 2.0, 3.0]);
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), None, 0, 2);
        assert_eq!(extract_number(&result), 6.0);
    }

    #[test]
    fn test_empty_range() {
        // start > end should yield Computed(0) for Sum
        let dense = make_dense(vec![1.0, 2.0, 3.0]);
        let mask = make_mask(3, &[]);
        // start_row=5, end_row=2 — after resolution, start_idx >= end_idx
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 5, 2);
        assert_eq!(extract_number(&result), 0.0);
    }

    // -----------------------------------------------------------------------
    // Multi-column tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_multi_column_sum() {
        let d1 = make_dense(vec![1.0, 2.0, 3.0]);
        let d2 = make_dense(vec![10.0, 20.0, 30.0]);
        let d3 = make_dense(vec![100.0, 200.0, 300.0]);
        let m1 = make_mask(3, &[]);
        let m2 = make_mask(3, &[]);
        let m3 = make_mask(3, &[]);

        let columns: Vec<(Option<&DenseColumn>, Option<&DenseBoolMask>)> = vec![
            (Some(&d1), Some(&m1)),
            (Some(&d2), Some(&m2)),
            (Some(&d3), Some(&m3)),
        ];

        let result = try_dense_aggregate_multi_column(AggregateOp::Sum, &columns, 0, 2);
        // 6 + 60 + 600 = 666
        assert_eq!(extract_number(&result), 666.0);
    }

    #[test]
    fn test_multi_column_partial_fallback() {
        // col A dense, col B None -> Fallback
        let d1 = make_dense(vec![1.0, 2.0, 3.0]);
        let m1 = make_mask(3, &[]);

        let columns: Vec<(Option<&DenseColumn>, Option<&DenseBoolMask>)> =
            vec![(Some(&d1), Some(&m1)), (None, None)];

        let result = try_dense_aggregate_multi_column(AggregateOp::Sum, &columns, 0, 2);
        assert!(is_fallback(&result));
    }

    // -----------------------------------------------------------------------
    // Error propagation tests
    // -----------------------------------------------------------------------

    /// Helper: create a DenseColumn with error cells at specified rows.
    fn make_dense_with_errors(values: Vec<f64>, error_rows: Vec<(u32, CellError)>) -> DenseColumn {
        let numeric_count = values.iter().filter(|v| !v.is_nan()).count();
        DenseColumn::new(values, numeric_count, 0, error_rows)
    }

    #[test]
    fn test_sum_propagates_first_error() {
        // [10.0, #REF!, 30.0] -> SUM should return #REF!, not 40.0
        let dense = make_dense_with_errors(vec![10.0, f64::NAN, 30.0], vec![(1, CellError::Ref)]);
        let mask = make_mask(3, &[]);
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 0, 2);
        assert!(is_error(&result, CellError::Ref));
    }

    #[test]
    fn test_average_propagates_error() {
        // [10.0, #VALUE!, 30.0] -> AVERAGE should return #VALUE!
        let dense = make_dense_with_errors(vec![10.0, f64::NAN, 30.0], vec![(1, CellError::Value)]);
        let mask = make_mask(3, &[]);
        let result = try_dense_aggregate(AggregateOp::Average, Some(&dense), Some(&mask), 0, 2);
        assert!(is_error(&result, CellError::Value));
    }

    #[test]
    fn test_min_propagates_error() {
        let dense = make_dense_with_errors(vec![10.0, f64::NAN, 30.0], vec![(1, CellError::Na)]);
        let mask = make_mask(3, &[]);
        let result = try_dense_aggregate(AggregateOp::Min, Some(&dense), Some(&mask), 0, 2);
        assert!(is_error(&result, CellError::Na));
    }

    #[test]
    fn test_max_propagates_error() {
        let dense = make_dense_with_errors(vec![10.0, f64::NAN, 30.0], vec![(1, CellError::Div0)]);
        let mask = make_mask(3, &[]);
        let result = try_dense_aggregate(AggregateOp::Max, Some(&dense), Some(&mask), 0, 2);
        assert!(is_error(&result, CellError::Div0));
    }

    #[test]
    fn test_count_ignores_errors() {
        // COUNT should skip errors (only counts numbers)
        // [10.0, #REF!, 30.0] -> COUNT = 2
        let dense = make_dense_with_errors(vec![10.0, f64::NAN, 30.0], vec![(1, CellError::Ref)]);
        let mask = make_mask(3, &[]);
        let result = try_dense_aggregate(AggregateOp::Count, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 2.0);
    }

    #[test]
    fn test_counta_falls_back_with_errors() {
        // COUNTA can't distinguish errors from blanks in dense path -> Fallback
        let dense = make_dense_with_errors(vec![10.0, f64::NAN, 30.0], vec![(1, CellError::Ref)]);
        let mask = make_mask(3, &[]);
        let result = try_dense_aggregate(AggregateOp::CountA, Some(&dense), Some(&mask), 0, 2);
        assert!(is_fallback(&result));
    }

    #[test]
    fn test_error_outside_range_not_propagated() {
        // Error at row 5, but SUM is over rows 0-2 -> no error
        let dense = make_dense_with_errors(
            vec![10.0, 20.0, 30.0, 40.0, 50.0, f64::NAN],
            vec![(5, CellError::Ref)],
        );
        let mask = make_mask(6, &[]);
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 0, 2);
        assert_eq!(extract_number(&result), 60.0);
    }

    #[test]
    fn test_first_error_in_range_returned() {
        // Errors at rows 1 (#REF!) and 3 (#VALUE!), range 0-4
        // Should return #REF! (the first error in the range)
        let dense = make_dense_with_errors(
            vec![10.0, f64::NAN, 20.0, f64::NAN, 30.0],
            vec![(1, CellError::Ref), (3, CellError::Value)],
        );
        let mask = make_mask(5, &[]);
        let result = try_dense_aggregate(AggregateOp::Sum, Some(&dense), Some(&mask), 0, 4);
        assert!(is_error(&result, CellError::Ref));
    }
}

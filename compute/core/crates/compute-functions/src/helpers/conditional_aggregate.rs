//! Shared aggregation logic for conditional aggregate functions.
//!
//! This module provides the core row-aggregation logic used by both:
//! - `borrowed_multi_criteria.rs` (borrowed fast path, works with `&[CellValue]`)
//! - `counting.rs` (standard path, works with `&[&CellValue]`)
//!
//! By consolidating the aggregation here, we eliminate the semantic fork
//! that previously caused bugs when one path was updated but not the other.
//! The MAXIFS/MINIFS error propagation bug (silently skipping errors) is
//! also fixed here — all operations correctly propagate errors from the
//! value range, matching Excel behavior.

use value_types::{CellError, CellValue, KahanSum};

/// Which aggregation operation to perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggregateOp {
    Count,
    Sum,
    Average,
    Max,
    Min,
}

/// Uniform access to value data in both `&[CellValue]` and `&[&CellValue]` slices.
///
/// Monomorphized at compile time — zero overhead vs direct indexing.
pub trait ValueSlice {
    fn get_value(&self, index: usize) -> Option<&CellValue>;
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl ValueSlice for [CellValue] {
    #[inline]
    fn get_value(&self, index: usize) -> Option<&CellValue> {
        self.get(index)
    }
    #[inline]
    fn len(&self) -> usize {
        <[CellValue]>::len(self)
    }
}

impl ValueSlice for [&CellValue] {
    #[inline]
    fn get_value(&self, index: usize) -> Option<&CellValue> {
        self.get(index).copied()
    }
    #[inline]
    fn len(&self) -> usize {
        <[&CellValue]>::len(self)
    }
}

/// Extract a numeric value or error from a value slice at the given index.
/// Returns `None` for non-numeric, non-error values (booleans, text, null)
/// and for out-of-bounds indices.
#[inline]
fn get_numeric<V: ValueSlice + ?Sized>(data: &V, row: usize) -> Option<Result<f64, CellError>> {
    match data.get_value(row)? {
        CellValue::Error(e, _) => Some(Err(*e)),
        CellValue::Number(n) => Some(Ok(n.get())),
        _ => None,
    }
}

/// Core aggregation: aggregate values at matching row indices.
///
/// This is the single implementation of conditional aggregation logic.
/// Both the borrowed fast path and the standard function path delegate here.
///
/// # Arguments
/// * `matching_rows` — iterator of row indices that satisfy the criteria
/// * `value_data` — the value/sum range to aggregate (`None` only valid for `Count`)
/// * `op` — which aggregation operation to perform
///
/// # Error handling
/// All operations propagate errors from the value range. This matches Excel's
/// behavior and fixes a latent bug where MAXIFS/MINIFS in `counting.rs` silently
/// skipped errors.
#[inline]
pub fn aggregate_matching_rows<V: ValueSlice + ?Sized>(
    matching_rows: impl Iterator<Item = usize>,
    value_data: Option<&V>,
    op: AggregateOp,
) -> CellValue {
    match op {
        AggregateOp::Count => {
            // COUNTIF/COUNTIFS: just count matching rows, no value inspection.
            CellValue::number(matching_rows.count() as f64)
        }
        AggregateOp::Sum => {
            let data = match value_data {
                Some(d) => d,
                None => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "SUMIF/SUMIFS: missing value data for aggregation",
                    );
                }
            };
            let mut acc = KahanSum::new();
            for row in matching_rows {
                match get_numeric(data, row) {
                    Some(Ok(n)) => acc.add(n),
                    Some(Err(e)) => return CellValue::Error(e, None),
                    None => {}
                }
            }
            CellValue::number(acc.total())
        }
        AggregateOp::Average => {
            let data = match value_data {
                Some(d) => d,
                None => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "AVERAGEIF/AVERAGEIFS: missing value data for aggregation",
                    );
                }
            };
            let mut acc = KahanSum::new();
            let mut count: u64 = 0;
            for row in matching_rows {
                match get_numeric(data, row) {
                    Some(Ok(n)) => {
                        acc.add(n);
                        count += 1;
                    }
                    Some(Err(e)) => return CellValue::Error(e, None),
                    None => {}
                }
            }
            if count == 0 {
                CellValue::error_with_message(
                    CellError::Div0,
                    "AVERAGEIF/AVERAGEIFS: no numeric values in matching rows",
                )
            } else {
                CellValue::number(acc.total() / count as f64)
            }
        }
        AggregateOp::Max => {
            let data = match value_data {
                Some(d) => d,
                None => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "MAXIFS: missing value data for aggregation",
                    );
                }
            };
            let mut max: Option<f64> = None;
            for row in matching_rows {
                match get_numeric(data, row) {
                    Some(Ok(n)) => {
                        max = Some(match max {
                            Some(m) => m.max(n),
                            None => n,
                        });
                    }
                    Some(Err(e)) => return CellValue::Error(e, None),
                    None => {}
                }
            }
            CellValue::number(max.unwrap_or(0.0))
        }
        AggregateOp::Min => {
            let data = match value_data {
                Some(d) => d,
                None => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "MINIFS: missing value data for aggregation",
                    );
                }
            };
            let mut min: Option<f64> = None;
            for row in matching_rows {
                match get_numeric(data, row) {
                    Some(Ok(n)) => {
                        min = Some(match min {
                            Some(m) => m.min(n),
                            None => n,
                        });
                    }
                    Some(Err(e)) => return CellValue::Error(e, None),
                    None => {}
                }
            }
            CellValue::number(min.unwrap_or(0.0))
        }
    }
}

/// Single-criteria linear scan: iterate all rows, test criteria, aggregate.
///
/// Used by the borrowed fast path's slow fallback when no bitmask cache is
/// available. The criteria range and sum range can be different slice types
/// (e.g., `&[CellValue]` vs `&[&CellValue]`).
#[inline]
pub fn scan_single_criteria<CR: ValueSlice + ?Sized, SR: ValueSlice + ?Sized>(
    criteria_range: &CR,
    criteria_fn: &dyn Fn(&CellValue) -> bool,
    sum_range: Option<&SR>,
    total_rows: usize,
    op: AggregateOp,
) -> CellValue {
    let matching =
        (0..total_rows).filter(|&row| criteria_range.get_value(row).is_some_and(criteria_fn));
    aggregate_matching_rows(matching, sum_range, op)
}

/// Multi-criteria linear scan: iterate all rows, test all criteria, aggregate.
///
/// Used by the borrowed fast path's slow fallback when bitmask cache is
/// unavailable and multiple criteria pairs need evaluation.
#[inline]
#[allow(clippy::type_complexity)]
pub fn scan_multi_criteria(
    criteria_ranges: &[&[CellValue]],
    criteria_fns: &[Box<dyn Fn(&CellValue) -> bool>],
    sum_range: Option<&[CellValue]>,
    total_rows: usize,
    op: AggregateOp,
) -> CellValue {
    let matching = (0..total_rows).filter(|&row| {
        criteria_ranges
            .iter()
            .zip(criteria_fns.iter())
            .all(|(slice, pred)| {
                let v = slice.get(row).unwrap_or(&CellValue::Null);
                pred(v)
            })
    });
    aggregate_matching_rows(matching, sum_range, op)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    type CriteriaPredicate = Box<dyn Fn(&CellValue) -> bool>;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    // -----------------------------------------------------------------------
    // aggregate_matching_rows — Count
    // -----------------------------------------------------------------------

    #[test]
    fn count_basic() {
        let result = aggregate_matching_rows::<[CellValue]>(
            vec![0, 2, 4].into_iter(),
            None,
            AggregateOp::Count,
        );
        assert_eq!(result, num(3.0));
    }

    #[test]
    fn count_empty() {
        let result =
            aggregate_matching_rows::<[CellValue]>(std::iter::empty(), None, AggregateOp::Count);
        assert_eq!(result, num(0.0));
    }

    // -----------------------------------------------------------------------
    // aggregate_matching_rows — Sum
    // -----------------------------------------------------------------------

    #[test]
    fn sum_basic() {
        let data = [num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)];
        let result =
            aggregate_matching_rows(vec![0, 2, 4].into_iter(), Some(&data[..]), AggregateOp::Sum);
        assert_eq!(result, num(90.0));
    }

    #[test]
    fn sum_empty_matches() {
        let data = [num(10.0), num(20.0)];
        let result = aggregate_matching_rows(std::iter::empty(), Some(&data[..]), AggregateOp::Sum);
        assert_eq!(result, num(0.0));
    }

    #[test]
    fn sum_with_error_propagation() {
        let data = [num(10.0), err(CellError::Value), num(30.0)];
        let result =
            aggregate_matching_rows(vec![0, 1, 2].into_iter(), Some(&data[..]), AggregateOp::Sum);
        assert_eq!(result, err(CellError::Value));
    }

    #[test]
    fn sum_skips_non_numeric() {
        let data = [
            num(10.0),
            CellValue::Text("hello".into()),
            num(30.0),
            CellValue::Boolean(true),
            CellValue::Null,
        ];
        let result = aggregate_matching_rows(0..5, Some(&data[..]), AggregateOp::Sum);
        assert_eq!(result, num(40.0));
    }

    #[test]
    fn sum_uses_kahan() {
        // Verify we use Kahan summation (compensated) rather than naive.
        // Sum many 0.1 values; naive f64 accumulation drifts, Kahan stays closer.
        let data: Vec<CellValue> = (0..1000).map(|_| num(0.1)).collect();
        let result = aggregate_matching_rows(0..1000, Some(&data[..]), AggregateOp::Sum);
        if let CellValue::Number(n) = result {
            // Kahan should give a result very close to 100.0
            assert!(
                (n.get() - 100.0).abs() < 1e-12,
                "Expected ~100.0, got {}",
                n.get()
            );
        } else {
            panic!("Expected Number, got {:?}", result);
        }
    }

    // -----------------------------------------------------------------------
    // aggregate_matching_rows — Average
    // -----------------------------------------------------------------------

    #[test]
    fn average_basic() {
        let data = [num(10.0), num(20.0), num(30.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Average);
        assert_eq!(result, num(20.0));
    }

    #[test]
    fn average_empty_gives_div0() {
        let data = [num(10.0)];
        let result =
            aggregate_matching_rows(std::iter::empty(), Some(&data[..]), AggregateOp::Average);
        assert_eq!(result, err(CellError::Div0));
    }

    #[test]
    fn average_skips_non_numeric() {
        let data = [num(10.0), CellValue::Text("x".into()), num(30.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Average);
        // (10 + 30) / 2 = 20
        assert_eq!(result, num(20.0));
    }

    #[test]
    fn average_with_error_propagation() {
        let data = [num(10.0), err(CellError::Na), num(30.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Average);
        assert_eq!(result, err(CellError::Na));
    }

    // -----------------------------------------------------------------------
    // aggregate_matching_rows — Max
    // -----------------------------------------------------------------------

    #[test]
    fn max_basic() {
        let data = [num(10.0), num(50.0), num(30.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Max);
        assert_eq!(result, num(50.0));
    }

    #[test]
    fn max_empty_gives_zero() {
        let data = [num(10.0)];
        let result = aggregate_matching_rows(std::iter::empty(), Some(&data[..]), AggregateOp::Max);
        assert_eq!(result, num(0.0));
    }

    #[test]
    fn max_with_error_propagation() {
        // This is the MAXIFS bug fix: errors must propagate, not be silently skipped.
        let data = [num(10.0), err(CellError::Value), num(50.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Max);
        assert_eq!(result, err(CellError::Value));
    }

    #[test]
    fn max_negative_values() {
        let data = [num(-10.0), num(-5.0), num(-20.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Max);
        assert_eq!(result, num(-5.0));
    }

    // -----------------------------------------------------------------------
    // aggregate_matching_rows — Min
    // -----------------------------------------------------------------------

    #[test]
    fn min_basic() {
        let data = [num(10.0), num(5.0), num(30.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Min);
        assert_eq!(result, num(5.0));
    }

    #[test]
    fn min_empty_gives_zero() {
        let data = [num(10.0)];
        let result = aggregate_matching_rows(std::iter::empty(), Some(&data[..]), AggregateOp::Min);
        assert_eq!(result, num(0.0));
    }

    #[test]
    fn min_with_error_propagation() {
        // This is the MINIFS bug fix: errors must propagate, not be silently skipped.
        let data = [num(10.0), err(CellError::Div0), num(5.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Min);
        assert_eq!(result, err(CellError::Div0));
    }

    // -----------------------------------------------------------------------
    // aggregate_matching_rows — &[&CellValue] (counting.rs pattern)
    // -----------------------------------------------------------------------

    #[test]
    fn sum_with_ref_slice() {
        let v0 = num(10.0);
        let v1 = num(20.0);
        let v2 = num(30.0);
        let refs: Vec<&CellValue> = vec![&v0, &v1, &v2];
        let result =
            aggregate_matching_rows(vec![0, 2].into_iter(), Some(&refs[..]), AggregateOp::Sum);
        assert_eq!(result, num(40.0));
    }

    #[test]
    fn max_with_ref_slice_error() {
        let v0 = num(10.0);
        let v1 = err(CellError::Na);
        let v2 = num(50.0);
        let refs: Vec<&CellValue> = vec![&v0, &v1, &v2];
        let result = aggregate_matching_rows(0..3, Some(&refs[..]), AggregateOp::Max);
        assert_eq!(result, err(CellError::Na));
    }

    // -----------------------------------------------------------------------
    // scan_single_criteria
    // -----------------------------------------------------------------------

    #[test]
    fn scan_single_count() {
        let criteria = [num(1.0), num(2.0), num(1.0), num(3.0), num(1.0)];
        let target = num(1.0);
        let criteria_fn: Box<dyn Fn(&CellValue) -> bool> =
            Box::new(move |v: &CellValue| v == &target);
        let result = scan_single_criteria::<[CellValue], [CellValue]>(
            &criteria,
            &*criteria_fn,
            None,
            5,
            AggregateOp::Count,
        );
        assert_eq!(result, num(3.0));
    }

    #[test]
    fn scan_single_sum_with_sum_range() {
        let criteria = [
            CellValue::Text("yes".into()),
            CellValue::Text("no".into()),
            CellValue::Text("yes".into()),
        ];
        let sum_data = [num(10.0), num(20.0), num(30.0)];
        let target = CellValue::Text("yes".into());
        let criteria_fn: Box<dyn Fn(&CellValue) -> bool> =
            Box::new(move |v: &CellValue| v == &target);
        let result = scan_single_criteria(
            &criteria[..],
            &*criteria_fn,
            Some(&sum_data[..]),
            3,
            AggregateOp::Sum,
        );
        assert_eq!(result, num(40.0));
    }

    #[test]
    fn scan_single_average_no_matches() {
        let criteria = [num(1.0), num(2.0), num(3.0)];
        let sum_data = [num(10.0), num(20.0), num(30.0)];
        let criteria_fn: Box<dyn Fn(&CellValue) -> bool> = Box::new(|_: &CellValue| false);
        let result = scan_single_criteria(
            &criteria[..],
            &*criteria_fn,
            Some(&sum_data[..]),
            3,
            AggregateOp::Average,
        );
        assert_eq!(result, err(CellError::Div0));
    }

    // -----------------------------------------------------------------------
    // scan_multi_criteria
    // -----------------------------------------------------------------------

    #[test]
    fn scan_multi_count() {
        let range_a = [
            CellValue::Text("apple".into()),
            CellValue::Text("banana".into()),
            CellValue::Text("apple".into()),
        ];
        let range_b = [
            CellValue::Text("red".into()),
            CellValue::Text("yellow".into()),
            CellValue::Text("green".into()),
        ];
        let ranges: Vec<&[CellValue]> = vec![&range_a, &range_b];
        let fns: Vec<CriteriaPredicate> = vec![
            Box::new(|v: &CellValue| matches!(v, CellValue::Text(s) if &**s == "apple")),
            Box::new(|v: &CellValue| matches!(v, CellValue::Text(s) if &**s == "green")),
        ];
        let result = scan_multi_criteria(&ranges, &fns, None, 3, AggregateOp::Count);
        // Only row 2: apple AND green
        assert_eq!(result, num(1.0));
    }

    #[test]
    fn scan_multi_sum() {
        let range_a = [num(1.0), num(2.0), num(1.0), num(2.0)];
        let range_b = [
            CellValue::Text("a".into()),
            CellValue::Text("b".into()),
            CellValue::Text("a".into()),
            CellValue::Text("a".into()),
        ];
        let sum_data = [num(10.0), num(20.0), num(30.0), num(40.0)];
        let ranges: Vec<&[CellValue]> = vec![&range_a, &range_b];
        let target_num = num(1.0);
        let fns: Vec<CriteriaPredicate> = vec![
            Box::new(move |v: &CellValue| v == &target_num),
            Box::new(|v: &CellValue| matches!(v, CellValue::Text(s) if &**s == "a")),
        ];
        let result = scan_multi_criteria(&ranges, &fns, Some(&sum_data), 4, AggregateOp::Sum);
        // Rows matching (1, "a"): row 0 (10) and row 2 (30) = 40
        assert_eq!(result, num(40.0));
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn out_of_bounds_row_returns_none_for_get_numeric() {
        let data = [num(10.0)];
        // Row 5 is out of bounds; sum should skip it gracefully.
        let result =
            aggregate_matching_rows(vec![0, 5].into_iter(), Some(&data[..]), AggregateOp::Sum);
        assert_eq!(result, num(10.0));
    }

    #[test]
    fn mixed_types_in_value_range() {
        let data = [
            num(10.0),
            CellValue::Boolean(true),
            CellValue::Text("x".into()),
            CellValue::Null,
            num(20.0),
        ];
        let result = aggregate_matching_rows(0..5, Some(&data[..]), AggregateOp::Sum);
        // Only numbers: 10 + 20 = 30 (booleans, text, null skipped)
        assert_eq!(result, num(30.0));
    }

    #[test]
    fn error_stops_iteration_early() {
        // Error at row 1 should stop before reaching row 2
        let data = [num(10.0), err(CellError::Value), num(30.0)];
        let result = aggregate_matching_rows(0..3, Some(&data[..]), AggregateOp::Min);
        assert_eq!(result, err(CellError::Value));
    }
}

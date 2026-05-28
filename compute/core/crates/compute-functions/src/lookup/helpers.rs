//! Shared helpers for lookup & reference functions.
//!
//! Contains comparison logic (type ranking, cell value comparison, equality)
//! and return-value extraction used by XLOOKUP and other lookup functions.

use value_types::{CellError, CellValue};

/// Assign a numeric rank to each `CellValue` variant for comparison ordering.
/// Numbers < Text < Booleans < Errors < Arrays < Lambdas.
pub fn type_rank(v: &CellValue) -> u8 {
    match v {
        CellValue::Null => 0,
        CellValue::Number(_) => 1,
        CellValue::Text(_) => 2,
        CellValue::Boolean(_) | CellValue::Control(_) => 3,
        CellValue::Error(..) => 4,
        CellValue::Array(_) => 5,
        CellValue::Image(_) => 5,
    }
}

/// Compare two `CellValue`s, returning negative/zero/positive like C `strcmp`.
/// Values of different types are ordered by their type rank.
/// Same-type comparison: Numbers by value, Text case-insensitive, Booleans by value.
pub fn cell_value_cmp(a: &CellValue, b: &CellValue) -> i32 {
    cell_value_ord(a, b) as i32
}

/// Compare two `CellValue`s, returning `std::cmp::Ordering`.
///
/// Values of different types are ordered by their type rank
/// (Null < Number < Text < Boolean < Error < Array).
/// Same-type comparison: Numbers by value (15-digit precision),
/// Text case-insensitive, Booleans by value.
pub fn cell_value_ord(a: &CellValue, b: &CellValue) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let ra = type_rank(a);
    let rb = type_rank(b);
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (a, b) {
        (CellValue::Null, CellValue::Null) => Ordering::Equal,
        (CellValue::Number(x), CellValue::Number(y)) => {
            use value_types::precision::snap_to_15_significant_digits as snap15;
            snap15(x.get())
                .partial_cmp(&snap15(y.get()))
                .unwrap_or(Ordering::Equal)
        }
        (CellValue::Text(x), CellValue::Text(y)) => {
            // Allocation-free case-insensitive comparison: char::to_lowercase()
            // returns a small iterator, so flat_map avoids any heap allocation.
            x.chars()
                .flat_map(|c| c.to_lowercase())
                .cmp(y.chars().flat_map(|c| c.to_lowercase()))
        }
        (CellValue::Boolean(x), CellValue::Boolean(y)) => x.cmp(y),
        _ => Ordering::Equal,
    }
}

/// Check equality between two `CellValue`s using comparison.
pub fn cell_value_eq(a: &CellValue, b: &CellValue) -> bool {
    cell_value_cmp(a, b) == 0
}

/// Extract a return value from a return array at the given index.
/// Handles both single-row (horizontal) and multi-row (vertical) orientations.
/// When the return array has multiple columns, returns the entire row as an array.
pub fn get_return_value(return_arr: &CellValue, idx: usize) -> CellValue {
    match return_arr {
        CellValue::Array(arr) => {
            // Determine orientation: single column or single row
            if arr.rows() == 1 {
                // Single row: index into columns
                arr.get(0, idx)
                    .cloned()
                    .unwrap_or(CellValue::error_with_message(
                        CellError::Ref,
                        format!(
                            "return array column index ({idx}) out of range ({})",
                            arr.cols()
                        ),
                    ))
            } else {
                // Multi-row: index into rows
                if idx < arr.rows() {
                    let row = arr.row(idx);
                    if row.len() > 1 {
                        // Multi-column: return the entire row as an array
                        CellValue::row_array(row.to_vec())
                    } else {
                        // Single column: return the scalar value
                        row.first()
                            .cloned()
                            .unwrap_or(CellValue::error_with_message(
                                CellError::Ref,
                                "return array row is empty".to_string(),
                            ))
                    }
                } else {
                    CellValue::error_with_message(
                        CellError::Ref,
                        format!(
                            "return array row index ({idx}) out of range ({})",
                            arr.rows()
                        ),
                    )
                }
            }
        }
        other => {
            if idx == 0 {
                other.clone()
            } else {
                CellValue::error_with_message(
                    CellError::Ref,
                    format!("return value index ({idx}) out of range for scalar value"),
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Binary search utilities for sorted-data lookups
// ---------------------------------------------------------------------------

/// Whether to find the next-smaller or next-larger match.
#[derive(Clone, Copy)]
pub enum SearchMode {
    /// Largest value <= lookup.
    NextSmaller,
    /// Smallest value >= lookup.
    NextLarger,
}

/// Binary search for approximate match, **skipping error values**.
///
/// Excel's LOOKUP/XLOOKUP/XMATCH skip errors during approximate-match search.
/// This is critical for the `LOOKUP(2, 1/condition, result)` idiom where the
/// lookup_vector contains interleaved values and #DIV/0! errors.
///
/// Returns the **original index** (into the unfiltered `arr`) of the match.
pub fn binary_search_skip_errors(
    arr: &[CellValue],
    lookup: &CellValue,
    ascending: bool,
    mode: SearchMode,
) -> Option<usize> {
    // Build index of non-error entries, preserving original positions.
    let filtered: Vec<(usize, &CellValue)> = arr
        .iter()
        .enumerate()
        .filter(|(_, v)| !matches!(v, CellValue::Error(..)))
        .collect();
    if filtered.is_empty() {
        return None;
    }

    let values: Vec<&CellValue> = filtered.iter().map(|(_, v)| *v).collect();

    let fi = match mode {
        SearchMode::NextSmaller => {
            if ascending {
                let pos = values.partition_point(|v| cell_value_cmp(v, lookup) <= 0);
                if pos == 0 {
                    return None;
                }
                Some(pos - 1)
            } else {
                let pos = values.partition_point(|v| cell_value_cmp(v, lookup) > 0);
                if pos >= values.len() {
                    return None;
                }
                Some(pos)
            }
        }
        SearchMode::NextLarger => {
            if ascending {
                let pos = values.partition_point(|v| cell_value_cmp(v, lookup) < 0);
                if pos >= values.len() {
                    return None;
                }
                Some(pos)
            } else {
                let pos = values.partition_point(|v| cell_value_cmp(v, lookup) >= 0);
                if pos == 0 {
                    return None;
                }
                Some(pos - 1)
            }
        }
    }?;

    Some(filtered[fi].0)
}

/// Binary search for exact match in a sorted array.
/// `ascending` = true for ascending order, false for descending.
pub fn binary_search_exact(
    arr: &[CellValue],
    lookup: &CellValue,
    ascending: bool,
) -> Option<usize> {
    let n = arr.len();
    if n == 0 {
        return None;
    }
    let mut lo: usize = 0;
    let mut hi: usize = n;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let cmp = cell_value_cmp(&arr[mid], lookup);
        let cmp = if ascending { cmp } else { -cmp };
        if cmp < 0 {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if lo < n && cell_value_eq(&arr[lo], lookup) {
        Some(lo)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, CellValue};

    // -----------------------------------------------------------------------
    // Helpers to reduce boilerplate
    // -----------------------------------------------------------------------

    fn num(n: f64) -> CellValue {
        CellValue::from(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::from(s)
    }
    fn boolean(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn null() -> CellValue {
        CellValue::Null
    }

    // =======================================================================
    // type_rank -- Excel's type ordering for mixed-type comparisons
    // =======================================================================

    #[test]
    fn type_rank_null_is_lowest() {
        assert_eq!(type_rank(&null()), 0);
    }

    #[test]
    fn type_rank_number() {
        assert_eq!(type_rank(&num(42.0)), 1);
        assert_eq!(type_rank(&num(-1.0)), 1);
        assert_eq!(type_rank(&num(0.0)), 1);
    }

    #[test]
    fn type_rank_text() {
        assert_eq!(type_rank(&text("hello")), 2);
        assert_eq!(type_rank(&text("")), 2);
    }

    #[test]
    fn type_rank_boolean() {
        assert_eq!(type_rank(&boolean(true)), 3);
        assert_eq!(type_rank(&boolean(false)), 3);
    }

    #[test]
    fn type_rank_error() {
        assert_eq!(type_rank(&err(CellError::Na)), 4);
        assert_eq!(type_rank(&err(CellError::Value)), 4);
        assert_eq!(type_rank(&err(CellError::Ref)), 4);
        assert_eq!(type_rank(&err(CellError::Div0)), 4);
    }

    #[test]
    fn type_rank_ordering_numbers_lt_text_lt_booleans_lt_errors() {
        // Excel's documented order: Numbers < Text < Booleans < Errors
        assert!(type_rank(&num(0.0)) < type_rank(&text("")));
        assert!(type_rank(&text("")) < type_rank(&boolean(false)));
        assert!(type_rank(&boolean(false)) < type_rank(&err(CellError::Na)));
    }

    #[test]
    fn type_rank_null_sorts_before_numbers() {
        // Empty cells sort before numbers in Excel's approximate match
        assert!(type_rank(&null()) < type_rank(&num(f64::MIN)));
    }

    // =======================================================================
    // cell_value_cmp -- comparison semantics
    // =======================================================================

    // -- Same-type: Numbers --

    #[test]
    fn cmp_numbers_basic() {
        assert!(cell_value_cmp(&num(1.0), &num(2.0)) < 0);
        assert!(cell_value_cmp(&num(2.0), &num(1.0)) > 0);
        assert_eq!(cell_value_cmp(&num(1.0), &num(1.0)), 0);
    }

    #[test]
    fn cmp_numbers_negative() {
        assert!(cell_value_cmp(&num(-5.0), &num(-3.0)) < 0);
        assert!(cell_value_cmp(&num(-1.0), &num(1.0)) < 0);
    }

    #[test]
    fn cmp_numbers_zero() {
        assert_eq!(cell_value_cmp(&num(0.0), &num(0.0)), 0);
        // Negative zero and positive zero should be equal
        assert_eq!(cell_value_cmp(&num(-0.0), &num(0.0)), 0);
    }

    #[test]
    fn cmp_numbers_15_digit_precision() {
        // IEEE 754 has ~15.95 significant digits. Excel uses 15.
        // 1.0000000000000001 has a 1 in the 16th digit -- beyond 15-digit precision.
        // These should compare equal after snapping to 15 significant digits.
        assert_eq!(
            cell_value_cmp(&num(1.0000000000000001), &num(1.0)),
            0,
            "values differing only beyond 15th significant digit should be equal"
        );
    }

    #[test]
    fn cmp_numbers_ieee754_ghost_residual() {
        // 50 * 0.57 = 28.499999999999996 in IEEE 754, but Excel sees 28.5
        let a = num(50.0 * 0.57);
        let b = num(28.5);
        assert_eq!(
            cell_value_cmp(&a, &b),
            0,
            "IEEE 754 ghost residual should be eliminated by 15-digit snap"
        );
    }

    #[test]
    fn cmp_numbers_large_values() {
        assert!(cell_value_cmp(&num(1e15), &num(2e15)) < 0);
        assert_eq!(cell_value_cmp(&num(1e15), &num(1e15)), 0);
    }

    #[test]
    fn cmp_numbers_small_values() {
        assert!(cell_value_cmp(&num(1e-10), &num(2e-10)) < 0);
        assert_eq!(cell_value_cmp(&num(1e-10), &num(1e-10)), 0);
    }

    // -- Same-type: Text --

    #[test]
    fn cmp_text_case_insensitive() {
        assert_eq!(
            cell_value_cmp(&text("abc"), &text("ABC")),
            0,
            "text comparison must be case-insensitive"
        );
        assert_eq!(cell_value_cmp(&text("Hello"), &text("hello")), 0);
        assert_eq!(cell_value_cmp(&text("WORLD"), &text("world")), 0);
    }

    #[test]
    fn cmp_text_lexicographic_order() {
        assert!(cell_value_cmp(&text("abc"), &text("abd")) < 0);
        assert!(cell_value_cmp(&text("abd"), &text("abc")) > 0);
        assert!(cell_value_cmp(&text("a"), &text("b")) < 0);
    }

    #[test]
    fn cmp_text_empty_string() {
        assert_eq!(cell_value_cmp(&text(""), &text("")), 0);
        assert!(cell_value_cmp(&text(""), &text("a")) < 0);
    }

    #[test]
    fn cmp_text_prefix() {
        // "apple" < "applesauce" (prefix sorts before longer string)
        assert!(cell_value_cmp(&text("apple"), &text("applesauce")) < 0);
    }

    // -- Same-type: Booleans --

    #[test]
    fn cmp_booleans() {
        assert!(
            cell_value_cmp(&boolean(false), &boolean(true)) < 0,
            "FALSE < TRUE in Excel"
        );
        assert!(cell_value_cmp(&boolean(true), &boolean(false)) > 0);
        assert_eq!(cell_value_cmp(&boolean(true), &boolean(true)), 0);
        assert_eq!(cell_value_cmp(&boolean(false), &boolean(false)), 0);
    }

    // -- Same-type: Null --

    #[test]
    fn cmp_null_vs_null() {
        assert_eq!(cell_value_cmp(&null(), &null()), 0);
    }

    // -- Cross-type ordering --

    #[test]
    fn cmp_null_less_than_number() {
        assert!(
            cell_value_cmp(&null(), &num(0.0)) < 0,
            "Null (empty cell) sorts before numbers"
        );
        assert!(cell_value_cmp(&null(), &num(-1000.0)) < 0);
    }

    #[test]
    fn cmp_number_less_than_text() {
        assert!(cell_value_cmp(&num(999999.0), &text("a")) < 0);
        assert!(cell_value_cmp(&num(0.0), &text("")) < 0);
    }

    #[test]
    fn cmp_text_less_than_boolean() {
        assert!(cell_value_cmp(&text("zzz"), &boolean(false)) < 0);
    }

    #[test]
    fn cmp_boolean_less_than_error() {
        assert!(cell_value_cmp(&boolean(true), &err(CellError::Na)) < 0);
    }

    #[test]
    fn cmp_cross_type_transitivity() {
        // Null < Number < Text < Boolean < Error
        let values = [
            null(),
            num(0.0),
            text(""),
            boolean(false),
            err(CellError::Na),
        ];
        for i in 0..values.len() {
            for j in (i + 1)..values.len() {
                assert!(
                    cell_value_cmp(&values[i], &values[j]) < 0,
                    "Expected {:?} < {:?}",
                    values[i],
                    values[j]
                );
                assert!(
                    cell_value_cmp(&values[j], &values[i]) > 0,
                    "Expected {:?} > {:?}",
                    values[j],
                    values[i]
                );
            }
        }
    }

    // =======================================================================
    // cell_value_eq -- equality semantics
    // =======================================================================

    #[test]
    fn eq_text_case_insensitive() {
        assert!(cell_value_eq(&text("Hello"), &text("HELLO")));
        assert!(cell_value_eq(&text("abc"), &text("ABC")));
    }

    #[test]
    fn eq_numbers() {
        assert!(cell_value_eq(&num(1.0), &num(1.0)));
        assert!(!cell_value_eq(&num(1.0), &num(2.0)));
    }

    #[test]
    fn eq_null() {
        assert!(cell_value_eq(&null(), &null()));
    }

    #[test]
    fn eq_booleans() {
        assert!(cell_value_eq(&boolean(true), &boolean(true)));
        assert!(cell_value_eq(&boolean(false), &boolean(false)));
        assert!(!cell_value_eq(&boolean(true), &boolean(false)));
    }

    #[test]
    fn eq_number_zero_not_eq_boolean_false() {
        // In Excel, 0 and FALSE are different types -- they are NOT equal
        // in lookup/comparison context (VLOOKUP, XLOOKUP, MATCH)
        assert!(
            !cell_value_eq(&num(0.0), &boolean(false)),
            "Number(0) must NOT equal Boolean(false) -- different types"
        );
    }

    #[test]
    fn eq_number_one_not_eq_boolean_true() {
        assert!(
            !cell_value_eq(&num(1.0), &boolean(true)),
            "Number(1) must NOT equal Boolean(true) -- different types"
        );
    }

    #[test]
    fn eq_number_not_eq_text() {
        assert!(
            !cell_value_eq(&num(0.0), &text("0")),
            "Number(0) must NOT equal Text(\"0\") -- different types"
        );
        assert!(!cell_value_eq(&num(1.0), &text("1")));
    }

    #[test]
    fn eq_null_not_eq_number_zero() {
        // Null and 0 are different types
        assert!(!cell_value_eq(&null(), &num(0.0)));
    }

    #[test]
    fn eq_null_not_eq_empty_text() {
        // Null and "" are different types
        assert!(!cell_value_eq(&null(), &text("")));
    }

    #[test]
    fn eq_different_errors_compare_equal() {
        // Errors of the same type rank -- cell_value_cmp falls through to the
        // catch-all arm which returns 0 for any Error vs Error, regardless of
        // error variant. This matches Excel: errors are "incomparable" but
        // in type-rank terms they are all the same rank.
        assert!(cell_value_eq(&err(CellError::Na), &err(CellError::Na)));
    }

    // =======================================================================
    // get_return_value
    // =======================================================================

    #[test]
    fn get_return_value_scalar_at_zero() {
        let v = num(42.0);
        assert_eq!(get_return_value(&v, 0), num(42.0));
    }

    #[test]
    fn get_return_value_scalar_at_nonzero_is_ref_error() {
        let v = num(42.0);
        assert_eq!(get_return_value(&v, 1), err(CellError::Ref));
        assert_eq!(get_return_value(&v, 100), err(CellError::Ref));
    }

    #[test]
    fn get_return_value_scalar_text() {
        let v = text("hello");
        assert_eq!(get_return_value(&v, 0), text("hello"));
        assert_eq!(get_return_value(&v, 1), err(CellError::Ref));
    }

    #[test]
    fn get_return_value_single_row_indexes_columns() {
        // Single-row array: [10, 20, 30]
        let arr = CellValue::row_array(vec![num(10.0), num(20.0), num(30.0)]);
        assert_eq!(get_return_value(&arr, 0), num(10.0));
        assert_eq!(get_return_value(&arr, 1), num(20.0));
        assert_eq!(get_return_value(&arr, 2), num(30.0));
    }

    #[test]
    fn get_return_value_single_row_out_of_bounds() {
        let arr = CellValue::row_array(vec![num(10.0), num(20.0)]);
        assert_eq!(get_return_value(&arr, 2), err(CellError::Ref));
        assert_eq!(get_return_value(&arr, 100), err(CellError::Ref));
    }

    #[test]
    fn get_return_value_single_column_indexes_rows() {
        // Multi-row, single-column: [[10], [20], [30]]
        let arr = CellValue::array(vec![num(10.0), num(20.0), num(30.0)], 1);
        assert_eq!(get_return_value(&arr, 0), num(10.0));
        assert_eq!(get_return_value(&arr, 1), num(20.0));
        assert_eq!(get_return_value(&arr, 2), num(30.0));
    }

    #[test]
    fn get_return_value_single_column_out_of_bounds() {
        let arr = CellValue::array(vec![num(10.0), num(20.0)], 1);
        assert_eq!(get_return_value(&arr, 2), err(CellError::Ref));
    }

    #[test]
    fn get_return_value_multi_row_multi_col_returns_row_array() {
        // 3x2 array:
        //   [1, 2]
        //   [3, 4]
        //   [5, 6]
        let arr = CellValue::array(
            vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0), num(6.0)],
            2,
        );
        // Index 0 -> row [1, 2] as array
        let row0 = get_return_value(&arr, 0);
        match &row0 {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 1);
                assert_eq!(a.cols(), 2);
                assert_eq!(a.get(0, 0), Some(&num(1.0)));
                assert_eq!(a.get(0, 1), Some(&num(2.0)));
            }
            _ => panic!("expected array for multi-col row, got {:?}", row0),
        }
        // Index 2 -> row [5, 6]
        let row2 = get_return_value(&arr, 2);
        match &row2 {
            CellValue::Array(a) => {
                assert_eq!(a.get(0, 0), Some(&num(5.0)));
                assert_eq!(a.get(0, 1), Some(&num(6.0)));
            }
            _ => panic!("expected array for multi-col row, got {:?}", row2),
        }
    }

    #[test]
    fn get_return_value_multi_row_multi_col_out_of_bounds() {
        let arr = CellValue::array(vec![num(1.0), num(2.0), num(3.0), num(4.0)], 2);
        // 2 rows, so index 2 is out of bounds
        assert_eq!(get_return_value(&arr, 2), err(CellError::Ref));
    }

    // =======================================================================
    // binary_search_skip_errors -- approximate match with error skipping
    // =======================================================================

    // -- Ascending, NextSmaller --

    #[test]
    fn bsearch_ascending_next_smaller_exact_match() {
        let arr = vec![num(10.0), num(20.0), num(30.0), num(40.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(20.0), true, SearchMode::NextSmaller),
            Some(1)
        );
    }

    #[test]
    fn bsearch_ascending_next_smaller_between_values() {
        let arr = vec![num(10.0), num(20.0), num(30.0), num(40.0)];
        // 25 is between 20 and 30; NextSmaller should return 20 (index 1)
        assert_eq!(
            binary_search_skip_errors(&arr, &num(25.0), true, SearchMode::NextSmaller),
            Some(1)
        );
    }

    #[test]
    fn bsearch_ascending_next_smaller_before_all() {
        let arr = vec![num(10.0), num(20.0), num(30.0)];
        // Lookup value smaller than all elements -> None
        assert_eq!(
            binary_search_skip_errors(&arr, &num(5.0), true, SearchMode::NextSmaller),
            None
        );
    }

    #[test]
    fn bsearch_ascending_next_smaller_after_all() {
        let arr = vec![num(10.0), num(20.0), num(30.0)];
        // Lookup value larger than all -> returns last element
        assert_eq!(
            binary_search_skip_errors(&arr, &num(100.0), true, SearchMode::NextSmaller),
            Some(2)
        );
    }

    // -- Ascending, NextLarger --

    #[test]
    fn bsearch_ascending_next_larger_exact_match() {
        let arr = vec![num(10.0), num(20.0), num(30.0), num(40.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(20.0), true, SearchMode::NextLarger),
            Some(1)
        );
    }

    #[test]
    fn bsearch_ascending_next_larger_between_values() {
        let arr = vec![num(10.0), num(20.0), num(30.0), num(40.0)];
        // 25 is between 20 and 30; NextLarger should return 30 (index 2)
        assert_eq!(
            binary_search_skip_errors(&arr, &num(25.0), true, SearchMode::NextLarger),
            Some(2)
        );
    }

    #[test]
    fn bsearch_ascending_next_larger_after_all() {
        let arr = vec![num(10.0), num(20.0), num(30.0)];
        // Lookup value larger than all -> None
        assert_eq!(
            binary_search_skip_errors(&arr, &num(100.0), true, SearchMode::NextLarger),
            None
        );
    }

    #[test]
    fn bsearch_ascending_next_larger_before_all() {
        let arr = vec![num(10.0), num(20.0), num(30.0)];
        // Lookup value smaller than all -> returns first element
        assert_eq!(
            binary_search_skip_errors(&arr, &num(5.0), true, SearchMode::NextLarger),
            Some(0)
        );
    }

    // -- Descending, NextSmaller --

    #[test]
    fn bsearch_descending_next_smaller_exact_match() {
        let arr = vec![num(40.0), num(30.0), num(20.0), num(10.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(30.0), false, SearchMode::NextSmaller),
            Some(1)
        );
    }

    #[test]
    fn bsearch_descending_next_smaller_between_values() {
        let arr = vec![num(40.0), num(30.0), num(20.0), num(10.0)];
        // 25 between 30 and 20; NextSmaller -> 20 (index 2)
        assert_eq!(
            binary_search_skip_errors(&arr, &num(25.0), false, SearchMode::NextSmaller),
            Some(2)
        );
    }

    #[test]
    fn bsearch_descending_next_smaller_before_all() {
        let arr = vec![num(40.0), num(30.0), num(20.0)];
        // Smaller than all elements -> None
        assert_eq!(
            binary_search_skip_errors(&arr, &num(5.0), false, SearchMode::NextSmaller),
            None
        );
    }

    // -- Descending, NextLarger --

    #[test]
    fn bsearch_descending_next_larger_exact_match() {
        let arr = vec![num(40.0), num(30.0), num(20.0), num(10.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(30.0), false, SearchMode::NextLarger),
            Some(1)
        );
    }

    #[test]
    fn bsearch_descending_next_larger_between_values() {
        let arr = vec![num(40.0), num(30.0), num(20.0), num(10.0)];
        // 25 between 30 and 20; NextLarger -> 30 (index 1)
        assert_eq!(
            binary_search_skip_errors(&arr, &num(25.0), false, SearchMode::NextLarger),
            Some(1)
        );
    }

    #[test]
    fn bsearch_descending_next_larger_after_all() {
        let arr = vec![num(40.0), num(30.0), num(20.0)];
        // Lookup larger than all values: no value >= 100 exists -> None
        assert_eq!(
            binary_search_skip_errors(&arr, &num(100.0), false, SearchMode::NextLarger),
            None
        );
    }

    #[test]
    fn bsearch_descending_next_larger_before_all() {
        let arr = vec![num(40.0), num(30.0), num(20.0)];
        // Lookup smaller than all: smallest value >= 5 is 20 (last in descending)
        assert_eq!(
            binary_search_skip_errors(&arr, &num(5.0), false, SearchMode::NextLarger),
            Some(2)
        );
    }

    // -- Error skipping --

    #[test]
    fn bsearch_skips_interspersed_errors() {
        // The classic LOOKUP(2, 1/cond, result) idiom produces:
        // [#DIV/0!, 10, #DIV/0!, 20, #DIV/0!, 30]
        // The non-error values [10, 20, 30] are ascending.
        let arr = vec![
            err(CellError::Div0),
            num(10.0),
            err(CellError::Div0),
            num(20.0),
            err(CellError::Div0),
            num(30.0),
        ];
        // NextSmaller for 25 -> 20, which is at original index 3
        assert_eq!(
            binary_search_skip_errors(&arr, &num(25.0), true, SearchMode::NextSmaller),
            Some(3)
        );
        // NextLarger for 25 -> 30, which is at original index 5
        assert_eq!(
            binary_search_skip_errors(&arr, &num(25.0), true, SearchMode::NextLarger),
            Some(5)
        );
    }

    #[test]
    fn bsearch_skips_errors_exact_match_at_original_index() {
        // Errors interspersed, exact match
        let arr = vec![err(CellError::Na), num(10.0), err(CellError::Na), num(20.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(20.0), true, SearchMode::NextSmaller),
            Some(3),
            "should return original index 3, not filtered index"
        );
    }

    #[test]
    fn bsearch_empty_array() {
        let arr: Vec<CellValue> = vec![];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(1.0), true, SearchMode::NextSmaller),
            None
        );
        assert_eq!(
            binary_search_skip_errors(&arr, &num(1.0), true, SearchMode::NextLarger),
            None
        );
    }

    #[test]
    fn bsearch_all_errors() {
        let arr = vec![
            err(CellError::Div0),
            err(CellError::Na),
            err(CellError::Value),
        ];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(1.0), true, SearchMode::NextSmaller),
            None
        );
        assert_eq!(
            binary_search_skip_errors(&arr, &num(1.0), true, SearchMode::NextLarger),
            None
        );
    }

    #[test]
    fn bsearch_single_element_match() {
        let arr = vec![num(10.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(10.0), true, SearchMode::NextSmaller),
            Some(0)
        );
        assert_eq!(
            binary_search_skip_errors(&arr, &num(10.0), true, SearchMode::NextLarger),
            Some(0)
        );
    }

    #[test]
    fn bsearch_single_element_no_match() {
        let arr = vec![num(10.0)];
        assert_eq!(
            binary_search_skip_errors(&arr, &num(5.0), true, SearchMode::NextSmaller),
            None,
            "lookup smaller than only element, NextSmaller -> None"
        );
        assert_eq!(
            binary_search_skip_errors(&arr, &num(15.0), true, SearchMode::NextLarger),
            None,
            "lookup larger than only element, NextLarger -> None"
        );
    }

    #[test]
    fn bsearch_mixed_types_ascending() {
        // Excel sorts: Null < Numbers < Text < Booleans
        // Ascending mixed array (valid in XLOOKUP approximate match)
        let arr = vec![num(1.0), num(2.0), text("a"), text("b"), boolean(false)];
        // Looking up text "a" with NextSmaller -> "a" at index 2
        assert_eq!(
            binary_search_skip_errors(&arr, &text("a"), true, SearchMode::NextSmaller),
            Some(2)
        );
    }

    // =======================================================================
    // binary_search_exact
    // =======================================================================

    #[test]
    fn exact_search_ascending_found() {
        let arr = vec![num(10.0), num(20.0), num(30.0), num(40.0)];
        assert_eq!(binary_search_exact(&arr, &num(30.0), true), Some(2));
        assert_eq!(binary_search_exact(&arr, &num(10.0), true), Some(0));
        assert_eq!(binary_search_exact(&arr, &num(40.0), true), Some(3));
    }

    #[test]
    fn exact_search_ascending_not_found() {
        let arr = vec![num(10.0), num(20.0), num(30.0)];
        assert_eq!(binary_search_exact(&arr, &num(25.0), true), None);
        assert_eq!(binary_search_exact(&arr, &num(5.0), true), None);
        assert_eq!(binary_search_exact(&arr, &num(35.0), true), None);
    }

    #[test]
    fn exact_search_descending_found() {
        let arr = vec![num(40.0), num(30.0), num(20.0), num(10.0)];
        assert_eq!(binary_search_exact(&arr, &num(30.0), false), Some(1));
        assert_eq!(binary_search_exact(&arr, &num(40.0), false), Some(0));
        assert_eq!(binary_search_exact(&arr, &num(10.0), false), Some(3));
    }

    #[test]
    fn exact_search_descending_not_found() {
        let arr = vec![num(40.0), num(30.0), num(20.0)];
        assert_eq!(binary_search_exact(&arr, &num(25.0), false), None);
    }

    #[test]
    fn exact_search_empty() {
        let arr: Vec<CellValue> = vec![];
        assert_eq!(binary_search_exact(&arr, &num(1.0), true), None);
        assert_eq!(binary_search_exact(&arr, &num(1.0), false), None);
    }

    #[test]
    fn exact_search_text_case_insensitive() {
        let arr = vec![text("Alpha"), text("Beta"), text("Gamma")];
        // "beta" should match "Beta" case-insensitively
        assert_eq!(binary_search_exact(&arr, &text("beta"), true), Some(1));
        assert_eq!(binary_search_exact(&arr, &text("ALPHA"), true), Some(0));
        assert_eq!(binary_search_exact(&arr, &text("GAMMA"), true), Some(2));
    }

    #[test]
    fn exact_search_single_element() {
        let arr = vec![num(42.0)];
        assert_eq!(binary_search_exact(&arr, &num(42.0), true), Some(0));
        assert_eq!(binary_search_exact(&arr, &num(43.0), true), None);
    }

    #[test]
    fn exact_search_booleans() {
        let arr = vec![boolean(false), boolean(true)];
        assert_eq!(binary_search_exact(&arr, &boolean(false), true), Some(0));
        assert_eq!(binary_search_exact(&arr, &boolean(true), true), Some(1));
    }

    #[test]
    fn exact_search_does_not_cross_types() {
        // Array of numbers; searching for text should not find anything
        let arr = vec![num(0.0), num(1.0), num(2.0)];
        assert_eq!(
            binary_search_exact(&arr, &text("1"), true),
            None,
            "text '1' should not match number 1"
        );
    }
}

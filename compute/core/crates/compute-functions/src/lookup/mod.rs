//! Lookup & Reference functions: XLOOKUP, XMATCH, CHOOSE, LOOKUP,
//! ADDRESS, AREAS, and array-returning markers (FILTER, SORT, UNIQUE, SEQUENCE).

#[cfg(feature = "__internal")]
pub mod helpers;
#[cfg(not(feature = "__internal"))]
pub(crate) mod helpers;

mod classic;
mod dynamic_arrays;
mod index_match;
mod manipulation;
mod misc;
mod modern;
mod reference;
mod stack;

use crate::FunctionRegistry;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    classic::register(registry);
    dynamic_arrays::register(registry);
    index_match::register(registry);
    manipulation::register(registry);
    misc::register(registry);
    modern::register(registry);
    reference::register(registry);
    stack::register(registry);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::classic::*;
    use super::dynamic_arrays::*;
    use super::index_match::*;
    use super::manipulation::*;
    use super::misc::*;
    use super::modern::*;
    use super::reference::*;
    use super::stack::*;
    use crate::{FunctionRegistry, PureFunction};
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }

    fn test_array() -> CellValue {
        CellValue::from_rows(vec![
            vec![num(1.0), text("a"), num(100.0)],
            vec![num(2.0), text("b"), num(200.0)],
            vec![num(3.0), text("c"), num(300.0)],
        ])
    }

    #[test]
    fn test_choose() {
        let f = FnChoose;
        assert_eq!(
            f.call(&[num(2.0), text("a"), text("b"), text("c")]),
            text("b")
        );
        assert_eq!(f.call(&[num(0.0), text("a")]), err(CellError::Value));
        assert_eq!(f.call(&[num(5.0), text("a")]), err(CellError::Value));
    }

    #[test]
    fn test_xlookup_exact() {
        let f = FnXlookup;
        let lookup_arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        let return_arr = CellValue::from_rows(vec![vec![text("a"), text("b"), text("c")]]);
        assert_eq!(f.call(&[num(2.0), lookup_arr, return_arr]), text("b"));
    }

    #[test]
    fn test_xlookup_not_found_default() {
        let f = FnXlookup;
        let lookup_arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        let return_arr = CellValue::from_rows(vec![vec![text("a"), text("b"), text("c")]]);
        assert_eq!(
            f.call(&[
                num(5.0),
                lookup_arr.clone(),
                return_arr.clone(),
                text("N/A")
            ]),
            text("N/A")
        );
        assert_eq!(
            f.call(&[num(5.0), lookup_arr, return_arr]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_address() {
        let f = FnAddress;
        assert_eq!(f.call(&[num(1.0), num(1.0)]), text("$A$1"));
        assert_eq!(f.call(&[num(1.0), num(1.0), num(4.0)]), text("A1"));
        assert_eq!(
            f.call(&[num(1.0), num(1.0), num(1.0), bool_val(true), text("Sheet1")]),
            text("Sheet1!$A$1")
        );
    }

    #[test]
    fn test_array_markers_are_flagged() {
        assert!(FnArrayConstrain.returns_array());
        assert!(FnFlatten.returns_array());
        assert!(FnFilter.returns_array());
        assert!(FnSortN.returns_array());
        assert!(FnSort.returns_array());
        assert!(FnTrimRange.returns_array());
        assert!(FnUnique.returns_array());
        assert!(FnSequence.returns_array());
    }

    #[test]
    fn test_array_constrain_limits_without_padding() {
        let f = FnArrayConstrain;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), num(2.0), num(3.0)],
            vec![num(4.0), num(5.0), num(6.0)],
        ]);
        let expected_full = arr.clone();
        assert_eq!(
            f.call(&[arr.clone(), num(1.0), num(2.0)]),
            CellValue::from_rows(vec![vec![num(1.0), num(2.0)]])
        );
        assert_eq!(f.call(&[arr, num(9.0), num(9.0)]), expected_full);
    }

    #[test]
    fn test_flatten_preserves_argument_row_major_order() {
        let f = FnFlatten;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), CellValue::Null],
            vec![err(CellError::Div0), text("x")],
        ]);
        assert_eq!(
            f.call(&[arr, bool_val(true)]),
            CellValue::column_array(vec![
                num(1.0),
                CellValue::Null,
                err(CellError::Div0),
                text("x"),
                bool_val(true),
            ])
        );
    }

    #[test]
    fn test_sortn_default_and_unique_modes() {
        let f = FnSortN;
        let arr = CellValue::from_rows(vec![
            vec![text("b"), num(2.0)],
            vec![text("a"), num(1.0)],
            vec![text("a"), num(1.0)],
            vec![text("c"), num(3.0)],
        ]);
        assert_eq!(
            f.call(&[arr.clone(), num(2.0), num(0.0), num(2.0), bool_val(true)]),
            CellValue::from_rows(vec![vec![text("a"), num(1.0)], vec![text("a"), num(1.0)]])
        );
        assert_eq!(
            f.call(&[arr, num(2.0), num(2.0), num(2.0), bool_val(true)]),
            CellValue::from_rows(vec![vec![text("a"), num(1.0)], vec![text("b"), num(2.0)]])
        );
    }

    #[test]
    fn test_trimrange_trims_only_null_boundaries() {
        let f = FnTrimRange;
        let arr = CellValue::from_rows(vec![
            vec![CellValue::Null, CellValue::Null, CellValue::Null],
            vec![CellValue::Null, text(""), CellValue::Null],
            vec![CellValue::Null, CellValue::Null, CellValue::Null],
        ]);
        assert_eq!(f.call(&[arr]), CellValue::from_rows(vec![vec![text("")]]));
    }

    #[test]
    fn test_xmatch_exact() {
        let f = FnXmatch;
        let arr = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(f.call(&[num(20.0), arr]), num(2.0));
    }

    // -----------------------------------------------------------------------
    // Tier 3 tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_lookup_vector_form() {
        let f = FnLookup;
        let lookup_vec = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        let result_vec = CellValue::from_rows(vec![vec![text("a"), text("b"), text("c")]]);
        assert_eq!(
            f.call(&[num(2.0), lookup_vec.clone(), result_vec.clone()]),
            text("b")
        );
        // Approximate: 2.5 matches 2 (largest <= 2.5)
        assert_eq!(f.call(&[num(2.5), lookup_vec, result_vec]), text("b"));
    }

    #[test]
    fn test_lookup_array_form() {
        let f = FnLookup;
        // More rows than cols: search first col, return last col
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), text("x")],
            vec![num(2.0), text("y")],
            vec![num(3.0), text("z")],
        ]);
        assert_eq!(f.call(&[num(2.0), arr]), text("y"));
    }

    // -----------------------------------------------------------------------
    // LOOKUP error-skipping tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_lookup_error_skipping_last_match() {
        // LOOKUP(2, {1, #DIV/0!, 1, #DIV/0!, 1}, {10, 20, 30, 40, 50}) → 50
        // The LOOKUP(2, 1/condition, result) idiom: errors are skipped,
        // all non-error values are 1, 2 > 1, so last non-error position wins.
        let f = FnLookup;
        let lookup_vec = CellValue::from_rows(vec![vec![
            num(1.0),
            err(CellError::Div0),
            num(1.0),
            err(CellError::Div0),
            num(1.0),
        ]]);
        let result_vec = CellValue::from_rows(vec![vec![
            num(10.0),
            num(20.0),
            num(30.0),
            num(40.0),
            num(50.0),
        ]]);
        assert_eq!(f.call(&[num(2.0), lookup_vec, result_vec]), num(50.0));
    }

    #[test]
    fn test_lookup_all_errors() {
        // LOOKUP(2, {#DIV/0!, #DIV/0!, #DIV/0!}, {10, 20, 30}) → #N/A
        let f = FnLookup;
        let lookup_vec = CellValue::from_rows(vec![vec![
            err(CellError::Div0),
            err(CellError::Div0),
            err(CellError::Div0),
        ]]);
        let result_vec = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(
            f.call(&[num(2.0), lookup_vec, result_vec]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_lookup_no_errors_unchanged() {
        // LOOKUP(2, {1, 2, 3}, {10, 20, 30}) → 20 (no errors, unchanged behavior)
        let f = FnLookup;
        let lookup_vec = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        let result_vec = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(f.call(&[num(2.0), lookup_vec, result_vec]), num(20.0));
    }

    #[test]
    fn test_lookup_error_skipping_boundary() {
        // LOOKUP(2, {1, #DIV/0!, 3}, {10, 20, 30}) → 10
        // After filtering: non-error values are [1, 3]. 1 <= 2, 3 > 2.
        // Last match is value 1 at original index 0 → result_vec[0] = 10.
        let f = FnLookup;
        let lookup_vec = CellValue::from_rows(vec![vec![num(1.0), err(CellError::Div0), num(3.0)]]);
        let result_vec = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(f.call(&[num(2.0), lookup_vec, result_vec]), num(10.0));
    }

    #[test]
    fn test_lookup_error_skipping_no_match() {
        // LOOKUP(0.5, {1, #DIV/0!, 1}, {10, 20, 30}) → #N/A (0.5 < 1)
        let f = FnLookup;
        let lookup_vec = CellValue::from_rows(vec![vec![num(1.0), err(CellError::Div0), num(1.0)]]);
        let result_vec = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(
            f.call(&[num(0.5), lookup_vec, result_vec]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_lookup_array_form_error_skipping() {
        // 2-arg array form with errors in search row
        let f = FnLookup;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), err(CellError::Div0), num(1.0)],
            vec![text("a"), text("b"), text("c")],
        ]);
        // cols >= rows, search first row. Non-error values are [1, 1].
        // LOOKUP(2, ...) → 2 > 1, last match at original index 2 → last row[2] = "c"
        assert_eq!(f.call(&[num(2.0), arr]), text("c"));
    }

    // -----------------------------------------------------------------------
    // XLOOKUP error-skipping tests (binary search mode)
    // -----------------------------------------------------------------------

    #[test]
    fn test_xlookup_binary_error_skipping_next_smaller() {
        // XLOOKUP(2, {1,#DIV/0!,3}, {10,20,30}, "N/A", -1, 2)
        // match_mode=-1 (next smaller), search_mode=2 (binary asc)
        // After filtering errors: [1, 3] at indices [0, 2]. Largest <= 2 is 1 at index 0 → 10
        let f = FnXlookup;
        let lookup = CellValue::from_rows(vec![vec![num(1.0), err(CellError::Div0), num(3.0)]]);
        let returns = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(
            f.call(&[num(2.0), lookup, returns, text("N/A"), num(-1.0), num(2.0)]),
            num(10.0)
        );
    }

    #[test]
    fn test_xlookup_binary_error_skipping_next_larger() {
        // XLOOKUP(2, {1,#DIV/0!,3}, {10,20,30}, "N/A", 1, 2)
        // match_mode=1 (next larger), search_mode=2 (binary asc)
        // After filtering: [1, 3]. Smallest >= 2 is 3 at index 2 → 30
        let f = FnXlookup;
        let lookup = CellValue::from_rows(vec![vec![num(1.0), err(CellError::Div0), num(3.0)]]);
        let returns = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(
            f.call(&[num(2.0), lookup, returns, text("N/A"), num(1.0), num(2.0)]),
            num(30.0)
        );
    }

    #[test]
    fn test_xlookup_binary_all_errors() {
        // All errors → if_not_found
        let f = FnXlookup;
        let lookup = CellValue::from_rows(vec![vec![err(CellError::Div0), err(CellError::Div0)]]);
        let returns = CellValue::from_rows(vec![vec![num(10.0), num(20.0)]]);
        assert_eq!(
            f.call(&[num(2.0), lookup, returns, text("N/A"), num(-1.0), num(2.0)]),
            text("N/A")
        );
    }

    // -----------------------------------------------------------------------
    // XMATCH error-skipping tests (binary search mode)
    // -----------------------------------------------------------------------

    #[test]
    fn test_xmatch_binary_error_skipping_next_smaller() {
        // XMATCH(2, {1,#DIV/0!,3}, -1, 2) → 1
        // match_mode=-1 (next smaller), search_mode=2 (binary asc)
        // After filtering: [1, 3]. Largest <= 2 is 1 at original index 0 → position 1
        let f = FnXmatch;
        let arr = CellValue::from_rows(vec![vec![num(1.0), err(CellError::Div0), num(3.0)]]);
        assert_eq!(f.call(&[num(2.0), arr, num(-1.0), num(2.0)]), num(1.0));
    }

    #[test]
    fn test_xmatch_binary_error_skipping_next_larger() {
        // XMATCH(2, {1,#DIV/0!,3}, 1, 2) → 3
        // match_mode=1 (next larger), search_mode=2 (binary asc)
        // After filtering: [1, 3]. Smallest >= 2 is 3 at original index 2 → position 3
        let f = FnXmatch;
        let arr = CellValue::from_rows(vec![vec![num(1.0), err(CellError::Div0), num(3.0)]]);
        assert_eq!(f.call(&[num(2.0), arr, num(1.0), num(2.0)]), num(3.0));
    }

    #[test]
    fn test_areas() {
        let f = FnAreas;
        assert_eq!(f.call(&[test_array()]), num(1.0));
    }

    #[test]
    fn test_sortby() {
        let f = FnSortBy;
        let arr = CellValue::from_rows(vec![
            vec![text("c"), num(3.0)],
            vec![text("a"), num(1.0)],
            vec![text("b"), num(2.0)],
        ]);
        let by_arr = CellValue::from_rows(vec![vec![num(3.0)], vec![num(1.0)], vec![num(2.0)]]);
        let result = f.call(&[arr, by_arr, num(1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(*arr.get(0, 0).unwrap(), text("a"));
                assert_eq!(*arr.get(1, 0).unwrap(), text("b"));
                assert_eq!(*arr.get(2, 0).unwrap(), text("c"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_choosecols() {
        let f = FnChooseCols;
        let arr = test_array();
        let result = f.call(&[arr, num(1.0), num(3.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.row(0), vec![num(1.0), num(100.0)]);
                assert_eq!(arr.row(1), vec![num(2.0), num(200.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_choosecols_negative() {
        let f = FnChooseCols;
        let arr = test_array();
        // -1 = last column
        let result = f.call(&[arr, num(-1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.row(0), vec![num(100.0)]);
                assert_eq!(arr.row(1), vec![num(200.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_chooserows() {
        let f = FnChooseRows;
        let arr = test_array();
        let result = f.call(&[arr, num(1.0), num(3.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(*arr.get(0, 0).unwrap(), num(1.0));
                assert_eq!(*arr.get(1, 0).unwrap(), num(3.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_drop_rows() {
        let f = FnDrop;
        let arr = test_array();
        // Drop first row
        let result = f.call(&[arr.clone(), num(1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(*arr.get(0, 0).unwrap(), num(2.0));
            }
            _ => panic!("Expected array"),
        }
        // Drop last row (negative)
        let result = f.call(&[arr, num(-1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(*arr.get(1, 0).unwrap(), num(2.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_expand() {
        let f = FnExpand;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        let result = f.call(&[arr, num(2.0), num(3.0), num(0.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0), num(0.0)]);
                assert_eq!(arr.row(1), vec![num(0.0), num(0.0), num(0.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_take_positive() {
        let f = FnTake;
        let arr = test_array();
        let result = f.call(&[arr, num(2.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(*arr.get(0, 0).unwrap(), num(1.0));
                assert_eq!(*arr.get(1, 0).unwrap(), num(2.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_take_negative() {
        let f = FnTake;
        let arr = test_array();
        let result = f.call(&[arr, num(-1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(*arr.get(0, 0).unwrap(), num(3.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_transpose() {
        let f = FnTranspose;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), num(2.0), num(3.0)],
            vec![num(4.0), num(5.0), num(6.0)],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3); // 3 cols become 3 rows
                assert_eq!(arr.cols(), 2); // 2 rows become 2 cols
                assert_eq!(arr.row(0), vec![num(1.0), num(4.0)]);
                assert_eq!(arr.row(1), vec![num(2.0), num(5.0)]);
                assert_eq!(arr.row(2), vec![num(3.0), num(6.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_hstack() {
        let f = FnHstack;
        let a = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)]]);
        let b = CellValue::from_rows(vec![vec![num(3.0)], vec![num(4.0)]]);
        let result = f.call(&[a, b]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), num(3.0)]);
                assert_eq!(arr.row(1), vec![num(2.0), num(4.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_vstack() {
        let f = FnVstack;
        let a = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        let b = CellValue::from_rows(vec![vec![num(3.0), num(4.0)]]);
        let result = f.call(&[a, b]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0)]);
                assert_eq!(arr.row(1), vec![num(3.0), num(4.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_tocol() {
        let f = FnToCol;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 4);
                assert_eq!(arr.row(0), vec![num(1.0)]);
                assert_eq!(arr.row(1), vec![num(2.0)]);
                assert_eq!(arr.row(2), vec![num(3.0)]);
                assert_eq!(arr.row(3), vec![num(4.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_tocol_by_column() {
        let f = FnToCol;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let result = f.call(&[arr, num(0.0), bool_val(true)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 4);
                // Column scan: 1,3,2,4
                assert_eq!(arr.row(0), vec![num(1.0)]);
                assert_eq!(arr.row(1), vec![num(3.0)]);
                assert_eq!(arr.row(2), vec![num(2.0)]);
                assert_eq!(arr.row(3), vec![num(4.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_torow() {
        let f = FnToRow;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0), num(3.0), num(4.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_wrapcols() {
        let f = FnWrapCols;
        let vec =
            CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]]);
        let result = f.call(&[vec, num(2.0), num(0.0)]);
        match result {
            CellValue::Array(arr) => {
                // wrap_count=2 rows, vector of 5 => 3 cols, last padded
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), num(3.0), num(5.0)]);
                assert_eq!(arr.row(1), vec![num(2.0), num(4.0), num(0.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_wraprows() {
        let f = FnWrapRows;
        let vec =
            CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]]);
        let result = f.call(&[vec, num(3.0), num(0.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0), num(3.0)]);
                assert_eq!(arr.row(1), vec![num(4.0), num(5.0), num(0.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_formulatext_is_not_registered_as_stub() {
        let reg = FunctionRegistry::new();
        assert!(reg.get_by_name("FORMULATEXT").is_none());
        assert_eq!(reg.call("FORMULATEXT", &[text("A1")]), err(CellError::Name));
    }

    #[test]
    fn test_hyperlink() {
        let f = FnHyperlink;
        // With friendly name
        assert_eq!(
            f.call(&[text("https://example.com"), text("Click here")]),
            text("Click here")
        );
        // Without friendly name
        assert_eq!(
            f.call(&[text("https://example.com")]),
            text("https://example.com")
        );
    }

    #[test]
    fn test_new_array_functions_return_array() {
        assert!(FnSortBy.returns_array());
        assert!(FnChooseCols.returns_array());
        assert!(FnChooseRows.returns_array());
        assert!(FnDrop.returns_array());
        assert!(FnExpand.returns_array());
        assert!(FnTake.returns_array());
        assert!(FnTranspose.returns_array());
        assert!(FnHstack.returns_array());
        assert!(FnVstack.returns_array());
        assert!(FnToCol.returns_array());
        assert!(FnToRow.returns_array());
        assert!(FnWrapCols.returns_array());
        assert!(FnWrapRows.returns_array());
    }

    // -----------------------------------------------------------------------
    // search_mode tests for XLOOKUP
    // -----------------------------------------------------------------------

    #[test]
    fn test_xlookup_search_mode_reverse() {
        // XLOOKUP with search_mode=-1: when there are duplicate values,
        // it should find the LAST match (searching from the end).
        let f = FnXlookup;
        // lookup_array has duplicate 2s at positions 0 and 2
        let lookup_arr = CellValue::from_rows(vec![vec![num(2.0), num(1.0), num(2.0)]]);
        let return_arr = CellValue::from_rows(vec![vec![text("first"), text("mid"), text("last")]]);
        // search_mode=1 (default): finds first match at index 0
        assert_eq!(
            f.call(&[
                num(2.0),
                lookup_arr.clone(),
                return_arr.clone(),
                CellValue::Null,
                num(0.0),
                num(1.0)
            ]),
            text("first")
        );
        // search_mode=-1: finds last match at index 2
        assert_eq!(
            f.call(&[
                num(2.0),
                lookup_arr,
                return_arr,
                CellValue::Null,
                num(0.0),
                num(-1.0)
            ]),
            text("last")
        );
    }

    #[test]
    fn test_xlookup_search_mode_binary_ascending() {
        // XLOOKUP with search_mode=2: binary search on ascending-sorted data
        let f = FnXlookup;
        let lookup_arr = CellValue::from_rows(vec![vec![
            num(10.0),
            num(20.0),
            num(30.0),
            num(40.0),
            num(50.0),
        ]]);
        let return_arr = CellValue::from_rows(vec![vec![
            text("a"),
            text("b"),
            text("c"),
            text("d"),
            text("e"),
        ]]);
        // Exact match with binary search
        assert_eq!(
            f.call(&[
                num(30.0),
                lookup_arr.clone(),
                return_arr.clone(),
                CellValue::Null,
                num(0.0),
                num(2.0)
            ]),
            text("c")
        );
        // Not found
        assert_eq!(
            f.call(&[
                num(25.0),
                lookup_arr,
                return_arr,
                text("N/A"),
                num(0.0),
                num(2.0)
            ]),
            text("N/A")
        );
    }

    #[test]
    fn test_xlookup_search_mode_binary_descending() {
        // XLOOKUP with search_mode=-2: binary search on descending-sorted data
        let f = FnXlookup;
        let lookup_arr = CellValue::from_rows(vec![vec![
            num(50.0),
            num(40.0),
            num(30.0),
            num(20.0),
            num(10.0),
        ]]);
        let return_arr = CellValue::from_rows(vec![vec![
            text("e"),
            text("d"),
            text("c"),
            text("b"),
            text("a"),
        ]]);
        assert_eq!(
            f.call(&[
                num(30.0),
                lookup_arr.clone(),
                return_arr.clone(),
                CellValue::Null,
                num(0.0),
                num(-2.0)
            ]),
            text("c")
        );
        // Not found
        assert_eq!(
            f.call(&[
                num(25.0),
                lookup_arr,
                return_arr,
                text("N/A"),
                num(0.0),
                num(-2.0)
            ]),
            text("N/A")
        );
    }

    // -----------------------------------------------------------------------
    // search_mode tests for XMATCH
    // -----------------------------------------------------------------------

    #[test]
    fn test_xmatch_search_mode_reverse() {
        // XMATCH with search_mode=-1: find last match
        let f = FnXmatch;
        // Array with duplicate 2s at positions 0 and 2
        let arr = CellValue::from_rows(vec![vec![num(2.0), num(1.0), num(2.0)]]);
        // search_mode=1 (default): finds first match at position 1
        assert_eq!(
            f.call(&[num(2.0), arr.clone(), num(0.0), num(1.0)]),
            num(1.0)
        );
        // search_mode=-1: finds last match at position 3
        assert_eq!(f.call(&[num(2.0), arr, num(0.0), num(-1.0)]), num(3.0));
    }

    #[test]
    fn test_xmatch_search_mode_binary() {
        // XMATCH with search_mode=2: binary search ascending
        let f = FnXmatch;
        let arr = CellValue::from_rows(vec![vec![
            num(10.0),
            num(20.0),
            num(30.0),
            num(40.0),
            num(50.0),
        ]]);
        assert_eq!(
            f.call(&[num(30.0), arr.clone(), num(0.0), num(2.0)]),
            num(3.0)
        );
        // Not found
        assert_eq!(
            f.call(&[num(25.0), arr, num(0.0), num(2.0)]),
            err(CellError::Na)
        );
    }

    // -----------------------------------------------------------------------
    // Wildcard tests for MATCH
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // XLOOKUP multi-column return
    // -----------------------------------------------------------------------

    #[test]
    fn test_xlookup_multi_column_return() {
        // When return array has multiple columns, XLOOKUP should return the entire row
        let f = FnXlookup;
        let lookup_arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)], vec![num(3.0)]]);
        let return_arr = CellValue::from_rows(vec![
            vec![text("a"), num(100.0)],
            vec![text("b"), num(200.0)],
            vec![text("c"), num(300.0)],
        ]);
        let result = f.call(&[num(2.0), lookup_arr, return_arr]);
        // Should return an array with the entire row [["b", 200]]
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 2);
                assert_eq!(*arr.get(0, 0).unwrap(), text("b"));
                assert_eq!(*arr.get(0, 1).unwrap(), num(200.0));
            }
            _ => panic!("Expected array result for multi-column return"),
        }
    }

    #[test]
    fn test_xlookup_single_column_return() {
        // When return array has a single column, should return scalar
        let f = FnXlookup;
        let lookup_arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)], vec![num(3.0)]]);
        let return_arr =
            CellValue::from_rows(vec![vec![text("a")], vec![text("b")], vec![text("c")]]);
        let result = f.call(&[num(2.0), lookup_arr, return_arr]);
        assert_eq!(result, text("b"));
    }

    // -----------------------------------------------------------------------
    // HLOOKUP wildcard test
    // -----------------------------------------------------------------------

    // =======================================================================
    // SEQUENCE tests
    // =======================================================================

    #[test]
    fn test_sequence_basic() {
        let f = FnSequence;
        let result = f.call(&[num(3.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.row(0), vec![num(1.0)]);
                assert_eq!(arr.row(1), vec![num(2.0)]);
                assert_eq!(arr.row(2), vec![num(3.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sequence_rows_and_cols() {
        let f = FnSequence;
        let result = f.call(&[num(3.0), num(2.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0)]);
                assert_eq!(arr.row(1), vec![num(3.0), num(4.0)]);
                assert_eq!(arr.row(2), vec![num(5.0), num(6.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sequence_custom_start_step() {
        let f = FnSequence;
        let result = f.call(&[num(3.0), num(2.0), num(10.0), num(5.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.row(0), vec![num(10.0), num(15.0)]);
                assert_eq!(arr.row(1), vec![num(20.0), num(25.0)]);
                assert_eq!(arr.row(2), vec![num(30.0), num(35.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sequence_negative_step() {
        let f = FnSequence;
        let result = f.call(&[num(4.0), num(1.0), num(10.0), num(-2.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 4);
                assert_eq!(arr.row(0), vec![num(10.0)]);
                assert_eq!(arr.row(1), vec![num(8.0)]);
                assert_eq!(arr.row(2), vec![num(6.0)]);
                assert_eq!(arr.row(3), vec![num(4.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sequence_zero_step() {
        let f = FnSequence;
        let result = f.call(&[num(3.0), num(1.0), num(5.0), num(0.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.row(0), vec![num(5.0)]);
                assert_eq!(arr.row(1), vec![num(5.0)]);
                assert_eq!(arr.row(2), vec![num(5.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sequence_single_cell() {
        let f = FnSequence;
        let result = f.call(&[num(1.0), num(1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.row(0), vec![num(1.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sequence_errors() {
        let f = FnSequence;
        // rows <= 0 → #CALC!
        assert_eq!(f.call(&[num(0.0)]), err(CellError::Calc));
        assert_eq!(f.call(&[num(-1.0)]), err(CellError::Calc));
        // cols <= 0 → #CALC!
        assert_eq!(f.call(&[num(3.0), num(0.0)]), err(CellError::Calc));
        // text arg → #VALUE!
        assert_eq!(f.call(&[text("abc")]), err(CellError::Value));
    }

    // =======================================================================
    // FILTER tests
    // =======================================================================

    #[test]
    fn test_filter_basic_row_filter() {
        let f = FnFilter;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), text("a")],
            vec![num(2.0), text("b")],
            vec![num(3.0), text("c")],
        ]);
        let include = CellValue::from_rows(vec![
            vec![bool_val(true)],
            vec![bool_val(false)],
            vec![bool_val(true)],
        ]);
        let result = f.call(&[arr, include]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), text("a")]);
                assert_eq!(arr.row(1), vec![num(3.0), text("c")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_filter_numeric_include() {
        // Nonzero numbers are truthy
        let f = FnFilter;
        let arr = CellValue::from_rows(vec![vec![num(10.0)], vec![num(20.0)], vec![num(30.0)]]);
        let include = CellValue::from_rows(vec![vec![num(1.0)], vec![num(0.0)], vec![num(1.0)]]);
        let result = f.call(&[arr, include]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(10.0)]);
                assert_eq!(arr.row(1), vec![num(30.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_filter_column_filter() {
        // Single-row include → filter columns
        let f = FnFilter;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), num(2.0), num(3.0)],
            vec![num(4.0), num(5.0), num(6.0)],
        ]);
        let include =
            CellValue::from_rows(vec![vec![bool_val(true), bool_val(false), bool_val(true)]]);
        let result = f.call(&[arr, include]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), num(3.0)]);
                assert_eq!(arr.row(1), vec![num(4.0), num(6.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_filter_no_matches_default_error() {
        let f = FnFilter;
        let arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)]]);
        let include = CellValue::from_rows(vec![vec![bool_val(false)], vec![bool_val(false)]]);
        assert_eq!(f.call(&[arr, include]), err(CellError::Calc));
    }

    #[test]
    fn test_filter_no_matches_with_if_empty() {
        let f = FnFilter;
        let arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)]]);
        let include = CellValue::from_rows(vec![vec![bool_val(false)], vec![bool_val(false)]]);
        assert_eq!(f.call(&[arr, include, text("No data")]), text("No data"));
    }

    #[test]
    fn test_filter_dimension_mismatch() {
        let f = FnFilter;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        // include has wrong number of rows
        let include = CellValue::from_rows(vec![vec![bool_val(true)]]);
        // 1 row include, but 2 cols in include doesn't match 2 cols in array
        // Actually 1x1 include doesn't match 2x2 array's rows (2) or cols (2)
        assert_eq!(f.call(&[arr, include]), err(CellError::Value));
    }

    #[test]
    fn test_filter_single_value_array() {
        // Single-value array and include
        let f = FnFilter;
        let result = f.call(&[num(42.0), bool_val(true)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.row(0), vec![num(42.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    // =======================================================================
    // SORT tests
    // =======================================================================

    #[test]
    fn test_sort_basic_ascending() {
        let f = FnSort;
        let arr = CellValue::from_rows(vec![
            vec![num(3.0), text("c")],
            vec![num(1.0), text("a")],
            vec![num(2.0), text("b")],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), num(1.0));
                assert_eq!(*arr.get(1, 0).unwrap(), num(2.0));
                assert_eq!(*arr.get(2, 0).unwrap(), num(3.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sort_descending() {
        let f = FnSort;
        let arr = CellValue::from_rows(vec![vec![num(3.0)], vec![num(1.0)], vec![num(2.0)]]);
        let result = f.call(&[arr, num(1.0), num(-1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), num(3.0));
                assert_eq!(*arr.get(1, 0).unwrap(), num(2.0));
                assert_eq!(*arr.get(2, 0).unwrap(), num(1.0));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sort_by_second_column() {
        let f = FnSort;
        let arr = CellValue::from_rows(vec![
            vec![text("x"), num(30.0)],
            vec![text("y"), num(10.0)],
            vec![text("z"), num(20.0)],
        ]);
        let result = f.call(&[arr, num(2.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), text("y"));
                assert_eq!(*arr.get(1, 0).unwrap(), text("z"));
                assert_eq!(*arr.get(2, 0).unwrap(), text("x"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sort_by_col() {
        let f = FnSort;
        let arr = CellValue::from_rows(vec![
            vec![num(3.0), num(1.0), num(2.0)],
            vec![text("c"), text("a"), text("b")],
        ]);
        // Sort columns by first row, ascending
        let result = f.call(&[arr, num(1.0), num(1.0), bool_val(true)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0), num(3.0)]);
                assert_eq!(arr.row(1), vec![text("a"), text("b"), text("c")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sort_text_case_insensitive() {
        let f = FnSort;
        let arr = CellValue::from_rows(vec![
            vec![text("Banana")],
            vec![text("apple")],
            vec![text("Cherry")],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), text("apple"));
                assert_eq!(*arr.get(1, 0).unwrap(), text("Banana"));
                assert_eq!(*arr.get(2, 0).unwrap(), text("Cherry"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sort_mixed_types() {
        // Numbers < Text < Booleans
        let f = FnSort;
        let arr = CellValue::from_rows(vec![
            vec![bool_val(true)],
            vec![num(1.0)],
            vec![text("hello")],
            vec![num(2.0)],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 4);
                assert_eq!(*arr.get(0, 0).unwrap(), num(1.0));
                assert_eq!(*arr.get(1, 0).unwrap(), num(2.0));
                assert_eq!(*arr.get(2, 0).unwrap(), text("hello"));
                assert_eq!(*arr.get(3, 0).unwrap(), bool_val(true));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sort_invalid_sort_index() {
        let f = FnSort;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        // sort_index 5 is out of bounds (only 2 columns)
        assert_eq!(f.call(&[arr, num(5.0)]), err(CellError::Value));
    }

    // =======================================================================
    // UNIQUE tests
    // =======================================================================

    #[test]
    fn test_unique_basic_rows() {
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0)],
            vec![num(2.0)],
            vec![num(1.0)],
            vec![num(3.0)],
            vec![num(2.0)],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.row(0), vec![num(1.0)]);
                assert_eq!(arr.row(1), vec![num(2.0)]);
                assert_eq!(arr.row(2), vec![num(3.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_unique_multi_column_rows() {
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), text("a")],
            vec![num(2.0), text("b")],
            vec![num(1.0), text("a")],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(1.0), text("a")]);
                assert_eq!(arr.row(1), vec![num(2.0), text("b")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_unique_exactly_once() {
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0)],
            vec![num(2.0)],
            vec![num(1.0)],
            vec![num(3.0)],
        ]);
        // exactly_once=TRUE: only values that appear exactly once
        let result = f.call(&[arr, bool_val(false), bool_val(true)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), vec![num(2.0)]);
                assert_eq!(arr.row(1), vec![num(3.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_unique_by_col() {
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), num(2.0), num(1.0), num(3.0)],
            vec![text("a"), text("b"), text("a"), text("c")],
        ]);
        // by_col=TRUE: compare columns
        let result = f.call(&[arr, bool_val(true)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                // Should have 3 unique columns: (1,a), (2,b), (3,c)
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.row(0), vec![num(1.0), num(2.0), num(3.0)]);
                assert_eq!(arr.row(1), vec![text("a"), text("b"), text("c")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_unique_case_insensitive() {
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![
            vec![text("Hello")],
            vec![text("hello")],
            vec![text("HELLO")],
            vec![text("World")],
        ]);
        let result = f.call(&[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                // First occurrence of "Hello" and "World"
                assert_eq!(arr.row(0), vec![text("Hello")]);
                assert_eq!(arr.row(1), vec![text("World")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_unique_exactly_once_all_duplicates() {
        // All values are duplicated → #CALC! (empty result)
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![
            vec![num(1.0)],
            vec![num(1.0)],
            vec![num(2.0)],
            vec![num(2.0)],
        ]);
        let result = f.call(&[arr, bool_val(false), bool_val(true)]);
        assert_eq!(result, err(CellError::Calc));
    }

    #[test]
    fn test_unique_by_col_exactly_once() {
        let f = FnUnique;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(1.0)]]);
        // by_col=TRUE, exactly_once=TRUE
        let result = f.call(&[arr, bool_val(true), bool_val(true)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                // Only column with value 2 appears exactly once
                assert_eq!(arr.row(0), vec![num(2.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_unique_single_value() {
        let f = FnUnique;
        // Single value treated as 1x1 array
        let result = f.call(&[num(42.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.row(0), vec![num(42.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    // =======================================================================
    // SORTBY multi-key tests
    // =======================================================================

    #[test]
    fn test_sortby_multi_key() {
        let f = FnSortBy;
        let arr = CellValue::from_rows(vec![
            vec![text("A"), num(2.0)],
            vec![text("B"), num(1.0)],
            vec![text("A"), num(1.0)],
            vec![text("B"), num(2.0)],
        ]);
        let key1 = CellValue::from_rows(vec![
            vec![text("A")],
            vec![text("B")],
            vec![text("A")],
            vec![text("B")],
        ]);
        let key2 = CellValue::from_rows(vec![
            vec![num(2.0)],
            vec![num(1.0)],
            vec![num(1.0)],
            vec![num(2.0)],
        ]);
        // Sort by key1 asc, then key2 asc
        let result = f.call(&[arr, key1, num(1.0), key2, num(1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 4);
                assert_eq!(arr.row(0), vec![text("A"), num(1.0)]);
                assert_eq!(arr.row(1), vec![text("A"), num(2.0)]);
                assert_eq!(arr.row(2), vec![text("B"), num(1.0)]);
                assert_eq!(arr.row(3), vec![text("B"), num(2.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sortby_descending() {
        let f = FnSortBy;
        let arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)], vec![num(3.0)]]);
        let by = CellValue::from_rows(vec![vec![num(10.0)], vec![num(30.0)], vec![num(20.0)]]);
        let result = f.call(&[arr, by, num(-1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), num(2.0)); // by=30
                assert_eq!(*arr.get(1, 0).unwrap(), num(3.0)); // by=20
                assert_eq!(*arr.get(2, 0).unwrap(), num(1.0)); // by=10
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sortby_mismatched_lengths() {
        let f = FnSortBy;
        let arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)]]);
        let by = CellValue::from_rows(vec![vec![num(10.0)]]);
        // by_array has 1 element, array has 2 rows → #VALUE!
        assert_eq!(f.call(&[arr, by]), err(CellError::Value));
    }

    #[test]
    fn test_sortby_horizontal() {
        let f = FnSortBy;
        // Single row: =SORTBY({30,10,20}, {3,1,2}, 1) → {10,20,30}
        let arr = CellValue::from_rows(vec![vec![num(30.0), num(10.0), num(20.0)]]);
        let by = CellValue::from_rows(vec![vec![num(3.0), num(1.0), num(2.0)]]);
        let result = f.call(&[arr, by, num(1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.row(0), vec![num(10.0), num(20.0), num(30.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sortby_horizontal_descending() {
        let f = FnSortBy;
        // Single row descending: =SORTBY({30,10,20}, {3,1,2}, -1) → {30,20,10}
        let arr = CellValue::from_rows(vec![vec![num(30.0), num(10.0), num(20.0)]]);
        let by = CellValue::from_rows(vec![vec![num(3.0), num(1.0), num(2.0)]]);
        let result = f.call(&[arr, by, num(-1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.row(0), vec![num(30.0), num(20.0), num(10.0)]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_sortby_horizontal_with_text() {
        let f = FnSortBy;
        // Simulates =SORTBY($C$7:$G$7, $C$6:$G$6, 1) with text values
        let arr = CellValue::from_rows(vec![vec![
            text("e"),
            text("c"),
            text("a"),
            text("d"),
            text("b"),
        ]]);
        let by = CellValue::from_rows(vec![vec![num(5.0), num(3.0), num(1.0), num(4.0), num(2.0)]]);
        let result = f.call(&[arr, by, num(1.0)]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(
                    arr.row(0),
                    vec![text("a"), text("b"), text("c"), text("d"), text("e")]
                );
            }
            _ => panic!("Expected array"),
        }
    }
}

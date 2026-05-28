use super::super::modern::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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
fn test_xmatch_exact() {
    let f = FnXmatch;
    let arr = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
    assert_eq!(f.call(&[num(20.0), arr]), num(2.0));
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
    let return_arr = CellValue::from_rows(vec![vec![text("a")], vec![text("b")], vec![text("c")]]);
    let result = f.call(&[num(2.0), lookup_arr, return_arr]);
    assert_eq!(result, text("b"));
}

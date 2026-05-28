use super::super::classic::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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

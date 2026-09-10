use crate::PureFunction;
use value_types::CellError;
use value_types::CellValue;

use super::{FnXirr, err, num, ymd};

#[test]
fn xirr_error_all_positive() {
    let vals = CellValue::from_rows(vec![vec![num(1000.0), num(2000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
}

#[test]
fn xirr_error_all_negative() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(-2000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
}

#[test]
fn xirr_error_mismatched_lengths() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
}

#[test]
fn xirr_error_mismatched_lengths_after_filtering() {
    // The extra value must not be silently discarded just because the first
    // two entries would form a valid pair.
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(600.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
}

#[test]
fn xirr_invalid_numeric_date_is_value_error() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(-0.5), num(ymd(2024, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Value));
}

#[test]
fn xirr_preceding_date_is_allowed_by_office() {
    // MS-OI29500 records that Office accepts a date preceding the first date
    // even though the public support page describes the standard restriction.
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(100.0), num(50.0)]]);
    match FnXirr.call(&[vals, dates]) {
        CellValue::Number(n) => assert!(n.get().is_finite()),
        other => panic!("Expected finite XIRR, got {other:?}"),
    }
}

#[test]
fn xirr_error_single_value() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
}

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
fn xirr_error_single_value() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1))]]);
    assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
}

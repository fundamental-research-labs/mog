use super::super::super::dynamic_arrays::*;
use super::super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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
    let include = CellValue::from_rows(vec![vec![bool_val(true), bool_val(false), bool_val(true)]]);
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

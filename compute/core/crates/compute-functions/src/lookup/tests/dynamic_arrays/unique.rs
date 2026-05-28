use super::super::super::dynamic_arrays::*;
use super::super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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

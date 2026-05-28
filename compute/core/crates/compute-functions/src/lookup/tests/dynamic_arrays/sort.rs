use super::super::super::dynamic_arrays::*;
use super::super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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

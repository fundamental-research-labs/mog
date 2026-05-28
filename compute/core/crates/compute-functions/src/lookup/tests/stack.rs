use super::super::stack::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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
    let vec = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]]);
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
    let vec = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]]);
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

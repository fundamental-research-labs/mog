use super::super::manipulation::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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

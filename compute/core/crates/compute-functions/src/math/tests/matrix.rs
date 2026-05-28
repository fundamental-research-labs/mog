use super::super::matrix::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::CellValue;

#[test]
fn test_mdeterm() {
    let m = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
    // det = 1*4 - 2*3 = -2
    assert_eq!(FnMdeterm.call(&[m]), num(-2.0));
}

#[test]
fn test_munit() {
    if let CellValue::Array(arr) = FnMunit.call(&[num(2.0)]) {
        assert_eq!(arr.rows(), 2);
        assert_eq!(*arr.get(0, 0).unwrap(), num(1.0));
        assert_eq!(*arr.get(0, 1).unwrap(), num(0.0));
        assert_eq!(*arr.get(1, 0).unwrap(), num(0.0));
        assert_eq!(*arr.get(1, 1).unwrap(), num(1.0));
    } else {
        panic!("Expected array");
    }
}

// --- Edge case tests for bug fixes ---

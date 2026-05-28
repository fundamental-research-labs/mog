use super::super::super::test_helpers::{bool_val, err, null, num, text};
use super::super::text_format::FnText;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_text_array_numbers() {
    let reg = crate::FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![vec![num(1.5), num(2.7), num(3.1)]]);
    let result = reg.call("TEXT", &[arr, text("0.0")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.get(0, 0).unwrap(), &text("1.5"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("2.7"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("3.1"));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_text_array_dates() {
    let reg = crate::FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![vec![num(44562.0)], vec![num(44593.0)]]);
    let result = reg.call("TEXT", &[arr, text("mmm-yy")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.get(0, 0).unwrap(), &text("Jan-22"));
            assert_eq!(arr.get(1, 0).unwrap(), &text("Feb-22"));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_text_array_with_errors() {
    let reg = crate::FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![vec![
        num(1.0),
        CellValue::Error(CellError::Div0, None),
        num(3.0),
    ]]);
    let result = reg.call("TEXT", &[arr, text("0")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.get(0, 0).unwrap(), &text("1"));
            assert_eq!(arr.get(0, 1).unwrap(), &err(CellError::Div0));
            assert_eq!(arr.get(0, 2).unwrap(), &text("3"));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_text_array_preserves_2d_shape() {
    let reg = crate::FunctionRegistry::new();
    let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
    let result = reg.call("TEXT", &[arr, text("0")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(arr.get(0, 0).unwrap(), &text("1"));
            assert_eq!(arr.get(1, 1).unwrap(), &text("4"));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_text_scalar_unchanged() {
    let f = FnText;
    assert_eq!(f.call(&[num(0.5), text("0%")]), text("50%"));
}

#[test]
fn test_text_format_number() {
    assert_eq!(FnText.call(&[num(0.5), text("0%")]), text("50%"));
}

#[test]
fn test_text_at_sign_format() {
    assert_eq!(FnText.call(&[num(1234.5), text("@")]), text("1234.5"));
    assert_eq!(FnText.call(&[text("hello"), text("@")]), text("hello"));
    assert_eq!(FnText.call(&[bool_val(true), text("@")]), text("TRUE"));
    assert_eq!(FnText.call(&[null(), text("@")]), text(""));
}

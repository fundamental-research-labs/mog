use value_types::{CellControl, CellError, CellValue};

use crate::PureFunction;
use crate::information::conversion::{FnErrorType, FnN, FnType};

use super::helpers::{bool_val, err, null, num, text};

#[test]
fn test_n_number() {
    assert_eq!(FnN.call(&[num(42.0)]), num(42.0));
}

#[test]
fn test_n_boolean() {
    assert_eq!(FnN.call(&[bool_val(true)]), num(1.0));
    assert_eq!(FnN.call(&[bool_val(false)]), num(0.0));
}

#[test]
fn test_n_text() {
    assert_eq!(FnN.call(&[text("hello")]), num(0.0));
}

#[test]
fn test_n_error() {
    assert_eq!(FnN.call(&[err(CellError::Div0)]), err(CellError::Div0));
}

#[test]
fn test_n_null() {
    assert_eq!(FnN.call(&[null()]), num(0.0));
}

#[test]
fn test_type_number() {
    assert_eq!(FnType.call(&[num(1.0)]), num(1.0));
}

#[test]
fn test_type_text() {
    assert_eq!(FnType.call(&[text("hello")]), num(2.0));
}

#[test]
fn test_type_boolean() {
    assert_eq!(FnType.call(&[bool_val(true)]), num(4.0));
}

#[test]
fn test_type_error() {
    assert_eq!(FnType.call(&[err(CellError::Na)]), num(16.0));
}

#[test]
fn test_type_array() {
    let arr = CellValue::from_rows(vec![vec![num(1.0)]]);
    assert_eq!(FnType.call(&[arr]), num(64.0));
}

#[test]
fn test_type_null() {
    assert_eq!(FnType.call(&[null()]), num(1.0));
}

#[test]
fn test_type_control() {
    assert_eq!(
        FnType.call(&[CellValue::Control(CellControl::checkbox(true))]),
        num(4.0)
    );
}

#[test]
fn test_error_type_null() {
    assert_eq!(FnErrorType.call(&[err(CellError::Null)]), num(1.0));
}

#[test]
fn test_error_type_div0() {
    assert_eq!(FnErrorType.call(&[err(CellError::Div0)]), num(2.0));
}

#[test]
fn test_error_type_value() {
    assert_eq!(FnErrorType.call(&[err(CellError::Value)]), num(3.0));
}

#[test]
fn test_error_type_ref() {
    assert_eq!(FnErrorType.call(&[err(CellError::Ref)]), num(4.0));
}

#[test]
fn test_error_type_name() {
    assert_eq!(FnErrorType.call(&[err(CellError::Name)]), num(5.0));
}

#[test]
fn test_error_type_num() {
    assert_eq!(FnErrorType.call(&[err(CellError::Num)]), num(6.0));
}

#[test]
fn test_error_type_na() {
    assert_eq!(FnErrorType.call(&[err(CellError::Na)]), num(7.0));
}

#[test]
fn test_error_type_getting_data() {
    assert_eq!(FnErrorType.call(&[err(CellError::GettingData)]), num(8.0));
}

#[test]
fn test_error_type_not_error() {
    assert_eq!(FnErrorType.call(&[num(1.0)]), err(CellError::Na));
    assert_eq!(FnErrorType.call(&[text("hello")]), err(CellError::Na));
}

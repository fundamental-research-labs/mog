use super::super::super::test_helpers::{bool_val, err, null, num, text};
use super::super::array_text::{FnArrayToText, FnValueToText};
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_valuetotext() {
    let f = FnValueToText;
    assert_eq!(f.call(&[text("hello")]), text("hello"));
    assert_eq!(f.call(&[text("hello"), num(1.0)]), text("\"hello\""));
    assert_eq!(f.call(&[num(42.0)]), text("42"));
    assert_eq!(f.call(&[bool_val(true)]), text("TRUE"));
    assert_eq!(f.call(&[null()]), text(""));
}

#[test]
fn test_arraytotext_concise() {
    let f = FnArrayToText;
    let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
    assert_eq!(f.call(&[arr, num(0.0)]), text("1, 2, 3"));
}

#[test]
fn test_arraytotext_strict() {
    let f = FnArrayToText;
    let arr = CellValue::from_rows(vec![vec![num(1.0), text("hello"), num(3.0)]]);
    assert_eq!(f.call(&[arr, num(1.0)]), text("{{1,\"hello\",3}}"));
    let arr2 = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
    assert_eq!(f.call(&[arr2, num(1.0)]), text("{{1,2};{3,4}}"));
}

#[test]
fn test_arraytotext_single_value() {
    let f = FnArrayToText;
    assert_eq!(f.call(&[num(42.0)]), text("42"));
    assert_eq!(f.call(&[text("hi"), num(1.0)]), text("\"hi\""));
}

#[test]
fn test_valuetotext_number() {
    assert_eq!(FnValueToText.call(&[num(123.0)]), text("123"));
}

#[test]
fn test_valuetotext_boolean() {
    assert_eq!(FnValueToText.call(&[bool_val(true)]), text("TRUE"));
    assert_eq!(FnValueToText.call(&[bool_val(false)]), text("FALSE"));
}

#[test]
fn test_valuetotext_text_concise() {
    assert_eq!(FnValueToText.call(&[text("hello")]), text("hello"));
}

#[test]
fn test_valuetotext_text_strict() {
    assert_eq!(
        FnValueToText.call(&[text("hello"), num(1.0)]),
        text("\"hello\"")
    );
}

#[test]
fn test_valuetotext_null() {
    assert_eq!(FnValueToText.call(&[null()]), text(""));
}

#[test]
fn test_valuetotext_invalid_format() {
    assert_eq!(
        FnValueToText.call(&[text("x"), num(2.0)]),
        err(CellError::Value)
    );
}

#[test]
fn test_arraytotext_concise_multirow() {
    let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
    assert_eq!(FnArrayToText.call(&[arr, num(0.0)]), text("1, 2; 3, 4"));
}

#[test]
fn test_arraytotext_strict_with_text() {
    let arr = CellValue::from_rows(vec![vec![text("hi"), num(1.0)]]);
    assert_eq!(FnArrayToText.call(&[arr, num(1.0)]), text("{{\"hi\",1}}"));
}

#[test]
fn test_arraytotext_boolean_value() {
    let arr = CellValue::from_rows(vec![vec![bool_val(true), bool_val(false)]]);
    assert_eq!(FnArrayToText.call(&[arr, num(0.0)]), text("TRUE, FALSE"));
}

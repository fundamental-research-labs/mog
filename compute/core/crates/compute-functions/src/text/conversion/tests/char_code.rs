use super::super::super::test_helpers::{err, num, text};
use super::super::char_code::{FnChar, FnCode};
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_char_code() {
    assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
    assert_eq!(FnCode.call(&[text("A")]), num(65.0));
}

#[test]
fn test_char_uppercase_a() {
    assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
}

#[test]
fn test_char_lowercase_a() {
    assert_eq!(FnChar.call(&[num(97.0)]), text("a"));
}

#[test]
fn test_char_newline() {
    assert_eq!(FnChar.call(&[num(10.0)]), text("\n"));
}

#[test]
fn test_char_space() {
    assert_eq!(FnChar.call(&[num(32.0)]), text(" "));
}

#[test]
fn test_char_out_of_range_zero() {
    assert_eq!(FnChar.call(&[num(0.0)]), err(CellError::Value));
}

#[test]
fn test_char_out_of_range_256() {
    assert_eq!(FnChar.call(&[num(256.0)]), err(CellError::Value));
}

#[test]
fn test_char_boundary_255() {
    let result = FnChar.call(&[num(255.0)]);
    assert!(matches!(result, CellValue::Text(_)));
}

#[test]
fn test_char_boundary_1() {
    let result = FnChar.call(&[num(1.0)]);
    assert!(matches!(result, CellValue::Text(_)));
}

#[test]
fn test_code_uppercase_a() {
    assert_eq!(FnCode.call(&[text("A")]), num(65.0));
}

#[test]
fn test_code_lowercase_a() {
    assert_eq!(FnCode.call(&[text("a")]), num(97.0));
}

#[test]
fn test_code_takes_first_char() {
    assert_eq!(FnCode.call(&[text("ABC")]), num(65.0));
}

#[test]
fn test_code_empty_string_error() {
    assert_eq!(FnCode.call(&[text("")]), err(CellError::Value));
}

#[test]
fn test_code_unicode_char() {
    assert_eq!(FnCode.call(&[text("\u{20AC}")]), num(8364.0));
}

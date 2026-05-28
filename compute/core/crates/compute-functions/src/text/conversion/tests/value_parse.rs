use super::super::super::test_helpers::{bool_val, err, num, text};
use super::super::value_parse::FnValue;
use crate::PureFunction;
use value_types::CellError;

#[test]
fn test_value() {
    let f = FnValue;
    assert_eq!(f.call(&[text("42.5")]), num(42.5));
    assert_eq!(f.call(&[text("hello")]), err(CellError::Value));
    assert_eq!(f.call(&[text("$1,234.56")]), num(1234.56));
}

#[test]
fn test_value_parenthetical_negative() {
    let f = FnValue;
    assert_eq!(f.call(&[text("(100)")]), num(-100.0));
    assert_eq!(f.call(&[text("($1,234.56)")]), num(-1234.56));
}

#[test]
fn test_value_currency_symbols() {
    let f = FnValue;
    assert_eq!(f.call(&[text("$100")]), num(100.0));
    assert_eq!(f.call(&[text("\u{20AC}100")]), num(100.0));
    assert_eq!(f.call(&[text("\u{00A3}100")]), num(100.0));
    assert_eq!(f.call(&[text("\u{00A5}100")]), num(100.0));
}

#[test]
fn test_value_numeric_string() {
    assert_eq!(FnValue.call(&[text("42.5")]), num(42.5));
}

#[test]
fn test_value_non_numeric_error() {
    assert_eq!(FnValue.call(&[text("hello")]), err(CellError::Value));
}

#[test]
fn test_value_currency() {
    assert_eq!(FnValue.call(&[text("$1,234.56")]), num(1234.56));
}

#[test]
fn test_value_percentage() {
    assert_eq!(FnValue.call(&[text("50%")]), num(0.5));
}

#[test]
fn test_value_empty_string_error() {
    assert_eq!(FnValue.call(&[text("")]), err(CellError::Value));
}

#[test]
fn test_value_number_passthrough() {
    assert_eq!(FnValue.call(&[num(42.0)]), num(42.0));
}

#[test]
fn test_value_boolean_coercion() {
    assert_eq!(FnValue.call(&[bool_val(true)]), num(1.0));
    assert_eq!(FnValue.call(&[bool_val(false)]), num(0.0));
}

#[test]
fn test_value_parens_negative_number() {
    assert_eq!(FnValue.call(&[text("(100)")]), num(-100.0));
}

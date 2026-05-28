use super::super::super::test_helpers::{bool_val, err, num, text};
use super::super::number_format::{FnDollar, FnFixed, FnNumberValue};
use crate::PureFunction;
use value_types::CellError;

#[test]
fn test_dollar() {
    let f = FnDollar;
    assert_eq!(f.call(&[num(1234.567)]), text("$1,234.57"));
    assert_eq!(f.call(&[num(1234.567), num(1.0)]), text("$1,234.6"));
    assert_eq!(f.call(&[num(0.0)]), text("$0.00"));
}

#[test]
fn test_dollar_negative() {
    let f = FnDollar;
    assert_eq!(f.call(&[num(-1234.56)]), text("($1,234.56)"));
}

#[test]
fn test_fixed() {
    let f = FnFixed;
    assert_eq!(f.call(&[num(1234.567), num(2.0)]), text("1,234.57"));
    assert_eq!(
        f.call(&[num(1234.567), num(2.0), bool_val(true)]),
        text("1234.57")
    );
    assert_eq!(f.call(&[num(1234.0)]), text("1,234.00"));
}

#[test]
fn test_numbervalue() {
    let f = FnNumberValue;
    assert_eq!(f.call(&[text("1,234.56")]), num(1234.56));
    assert_eq!(
        f.call(&[text("1.234,56"), text(","), text(".")]),
        num(1234.56)
    );
    assert_eq!(f.call(&[text("50%")]), num(0.5));
    assert_eq!(f.call(&[text("")]), num(0.0));
}

#[test]
fn test_numbervalue_empty_returns_zero() {
    let f = FnNumberValue;
    assert_eq!(f.call(&[text("")]), num(0.0));
    assert_eq!(f.call(&[text("  ")]), num(0.0));
}

#[test]
fn test_dollar_default_2_decimals() {
    assert_eq!(FnDollar.call(&[num(1234.567)]), text("$1,234.57"));
}

#[test]
fn test_dollar_1_decimal() {
    assert_eq!(FnDollar.call(&[num(1234.567), num(1.0)]), text("$1,234.6"));
}

#[test]
fn test_dollar_0_decimals() {
    assert_eq!(FnDollar.call(&[num(1234.567), num(0.0)]), text("$1,235"));
}

#[test]
fn test_dollar_negative_value() {
    assert_eq!(FnDollar.call(&[num(-1234.56)]), text("($1,234.56)"));
}

#[test]
fn test_dollar_zero() {
    assert_eq!(FnDollar.call(&[num(0.0)]), text("$0.00"));
}

#[test]
fn test_dollar_error_propagation() {
    assert_eq!(FnDollar.call(&[err(CellError::Div0)]), err(CellError::Div0));
}

#[test]
fn test_fixed_default_2_decimals_with_commas() {
    assert_eq!(FnFixed.call(&[num(1234.567)]), text("1,234.57"));
}

#[test]
fn test_fixed_2_decimals_with_commas() {
    assert_eq!(FnFixed.call(&[num(1234.567), num(2.0)]), text("1,234.57"));
}

#[test]
fn test_fixed_2_decimals_no_commas() {
    assert_eq!(
        FnFixed.call(&[num(1234.567), num(2.0), bool_val(true)]),
        text("1234.57")
    );
}

#[test]
fn test_fixed_0_decimals() {
    assert_eq!(FnFixed.call(&[num(1234.567), num(0.0)]), text("1,235"));
}

#[test]
fn test_fixed_negative_value() {
    assert_eq!(FnFixed.call(&[num(-1234.56), num(2.0)]), text("-1,234.56"));
}

#[test]
fn test_fixed_error_propagation() {
    assert_eq!(FnFixed.call(&[err(CellError::Na)]), err(CellError::Na));
}

#[test]
fn test_numbervalue_standard() {
    assert_eq!(FnNumberValue.call(&[text("1,234.56")]), num(1234.56));
}

#[test]
fn test_numbervalue_european_format() {
    assert_eq!(
        FnNumberValue.call(&[text("1.234,56"), text(","), text(".")]),
        num(1234.56)
    );
}

#[test]
fn test_numbervalue_percentage() {
    assert_eq!(FnNumberValue.call(&[text("50%")]), num(0.5));
}

#[test]
fn test_numbervalue_empty_is_zero() {
    assert_eq!(FnNumberValue.call(&[text("")]), num(0.0));
}

#[test]
fn test_numbervalue_whitespace_is_zero() {
    assert_eq!(FnNumberValue.call(&[text("   ")]), num(0.0));
}

#[test]
fn test_numbervalue_invalid_text() {
    assert_eq!(FnNumberValue.call(&[text("abc")]), err(CellError::Value));
}

#[test]
fn test_numbervalue_currency_stripped() {
    assert_eq!(FnNumberValue.call(&[text("$100")]), num(100.0));
    assert_eq!(FnNumberValue.call(&[text("\u{20AC}100")]), num(100.0));
}

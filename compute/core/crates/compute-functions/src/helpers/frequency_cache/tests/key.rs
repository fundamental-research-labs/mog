use value_types::{CellError, CellValue};

use super::{num, text};
use crate::helpers::frequency_cache::NormalizedKey;

#[test]
fn test_normalized_key_case_insensitive_text() {
    let k1 = NormalizedKey::from_cell_value(&text("Hello"));
    let k2 = NormalizedKey::from_cell_value(&text("HELLO"));
    let k3 = NormalizedKey::from_cell_value(&text("hello"));
    assert_eq!(k1, k2);
    assert_eq!(k2, k3);
}

#[test]
fn test_normalized_key_numeric_tolerance() {
    let k1 = NormalizedKey::from_cell_value(&num(1.0));
    let k2 = NormalizedKey::from_cell_value(&num(1.0 + 1e-11));
    assert_eq!(k1, k2);

    let k3 = NormalizedKey::from_cell_value(&num(1.0 + 2e-10));
    assert_ne!(k1, k3);

    let k4 = NormalizedKey::from_cell_value(&num(-5.0));
    let k5 = NormalizedKey::from_cell_value(&num(-5.0 + 1e-11));
    assert_eq!(k4, k5);
}

#[test]
fn test_normalized_key_large_numbers_no_overflow() {
    let big1 = num(1e15);
    let big2 = num(1e15 + 1.0);
    let k1 = NormalizedKey::from_cell_value(&big1);
    let k2 = NormalizedKey::from_cell_value(&big2);
    assert_ne!(k1, k2);

    let k3 = NormalizedKey::from_cell_value(&num(1e15));
    assert_eq!(k1, k3);
}

#[test]
fn test_normalized_key_error_variants_distinct() {
    let na = NormalizedKey::from_cell_value(&CellValue::Error(CellError::Na, None));
    let val = NormalizedKey::from_cell_value(&CellValue::Error(CellError::Value, None));
    let ref_ = NormalizedKey::from_cell_value(&CellValue::Error(CellError::Ref, None));
    assert_ne!(na, val);
    assert_ne!(na, ref_);
    assert_ne!(val, ref_);
}

#[test]
fn test_normalized_key_text_as_number_cross_type() {
    let k_num = NormalizedKey::from_cell_value(&num(2019.0));
    let k_text = NormalizedKey::from_cell_value(&text("2019"));
    assert_eq!(k_num, k_text);

    let k_num2 = NormalizedKey::from_cell_value(&num(2.75));
    let k_text2 = NormalizedKey::from_cell_value(&text("2.75"));
    assert_eq!(k_num2, k_text2);

    let k_hello = NormalizedKey::from_cell_value(&text("hello"));
    assert!(matches!(k_hello, NormalizedKey::Text(_)));
    assert_ne!(k_hello, NormalizedKey::from_cell_value(&num(0.0)));
}

#[test]
fn test_normalized_key_text_with_whitespace_matches_number() {
    let k_num = NormalizedKey::from_cell_value(&num(1.0));
    let k_trailing = NormalizedKey::from_cell_value(&text("1 "));
    assert_eq!(
        k_num, k_trailing,
        "trailing space: \"1 \" should match Number(1)"
    );

    let k_leading = NormalizedKey::from_cell_value(&text(" 1"));
    assert_eq!(
        k_num, k_leading,
        "leading space: \" 1\" should match Number(1)"
    );

    let k_both = NormalizedKey::from_cell_value(&text(" 2.75 "));
    let k_num2 = NormalizedKey::from_cell_value(&num(2.75));
    assert_eq!(k_num2, k_both, "\" 2.75 \" should match Number(2.75)");

    let k_spaces = NormalizedKey::from_cell_value(&text("  "));
    assert!(matches!(k_spaces, NormalizedKey::Text(_)));
}

#[test]
fn test_normalized_key_null() {
    let k = NormalizedKey::from_cell_value(&CellValue::Null);
    assert_eq!(k, NormalizedKey::Null);
}

#[test]
fn test_normalized_key_boolean() {
    let t = NormalizedKey::from_cell_value(&CellValue::Boolean(true));
    let f = NormalizedKey::from_cell_value(&CellValue::Boolean(false));
    assert_ne!(t, f);
}

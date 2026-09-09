use super::super::super::test_helpers::{err, num, text};
use super::super::char_code::{FnChar, FnCode};
use crate::{CharCodePage, FunctionContext, PureFunction};
use value_types::{CellError, CellValue};

fn context(char_code_page: CharCodePage) -> FunctionContext {
    FunctionContext {
        char_code_page,
        ..FunctionContext::default()
    }
}

#[test]
fn test_supported_code_page_ids_are_explicit() {
    assert_eq!(CharCodePage::Windows1252.code_page_id(), 1252);
    assert_eq!(CharCodePage::Macintosh.code_page_id(), 10000);
    assert_eq!(
        CharCodePage::from_code_page_id(1252),
        Some(CharCodePage::Windows1252)
    );
    assert_eq!(
        CharCodePage::from_code_page_id(10000),
        Some(CharCodePage::Macintosh)
    );
    assert_eq!(CharCodePage::from_code_page_id(65001), None);
}

#[test]
fn test_char_code() {
    assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
    assert_eq!(FnCode.call(&[text("A")]), num(65.0));
}

#[test]
fn test_default_context_is_windows_1252() {
    assert_eq!(FnChar.call(&[num(240.0)]), text("\u{00f0}"));
    assert_eq!(FnCode.call(&[text("\u{f8ff}")]), num(63.0));
}

#[test]
fn test_windows_1252_maps_all_single_byte_values() {
    let context = context(CharCodePage::Windows1252);
    for code in 1..=255 {
        let value = FnChar.call_with_context(&[num(code as f64)], &context);
        let roundtrip = FnCode.call_with_context(&[value], &context);
        assert_eq!(roundtrip, num(code as f64), "Windows-1252 byte {code}");
    }
}

#[test]
fn test_macintosh_roman_maps_all_single_byte_values() {
    let context = context(CharCodePage::Macintosh);
    for code in 1..=255 {
        let value = FnChar.call_with_context(&[num(code as f64)], &context);
        let roundtrip = FnCode.call_with_context(&[value], &context);
        assert_eq!(roundtrip, num(code as f64), "Macintosh Roman byte {code}");
    }
}

#[test]
fn test_code_page_specific_sentinels() {
    let windows = context(CharCodePage::Windows1252);
    assert_eq!(
        FnChar.call_with_context(&[num(128.0)], &windows),
        text("\u{20ac}")
    );
    assert_eq!(
        FnChar.call_with_context(&[num(240.0)], &windows),
        text("\u{00f0}")
    );
    assert_eq!(
        FnCode.call_with_context(&[text("\u{f8ff}")], &windows),
        num(63.0)
    );

    let macintosh = context(CharCodePage::Macintosh);
    assert_eq!(
        FnChar.call_with_context(&[num(240.0)], &macintosh),
        text("\u{f8ff}")
    );
    assert_eq!(
        FnCode.call_with_context(&[text("\u{f8ff}")], &macintosh),
        num(240.0)
    );
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
fn test_char_truncates_fractional_number() {
    assert_eq!(FnChar.call(&[num(65.9)]), text("A"));
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
    assert_eq!(FnCode.call(&[text("\u{20AC}")]), num(128.0));
}

#[test]
fn test_code_unrepresentable_unicode_char_uses_question_mark() {
    assert_eq!(FnCode.call(&[text("\u{1F600}")]), num(63.0));
}

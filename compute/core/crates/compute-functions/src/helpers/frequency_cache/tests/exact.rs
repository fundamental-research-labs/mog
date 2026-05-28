use value_types::{CellError, CellValue};

use super::{num, text};
use crate::helpers::frequency_cache::exact::has_unescaped_wildcard;
use crate::helpers::frequency_cache::is_exact_match_criteria;

#[test]
fn test_exact_match_plain_text() {
    assert!(is_exact_match_criteria(&text("hello")));
    assert!(is_exact_match_criteria(&text("Alice")));
    assert!(is_exact_match_criteria(&text("")));
}

#[test]
fn test_exact_match_numbers() {
    assert!(is_exact_match_criteria(&num(5.0)));
    assert!(is_exact_match_criteria(&num(0.0)));
    assert!(is_exact_match_criteria(&num(-1.5)));
}

#[test]
fn test_exact_match_boolean_null_error() {
    assert!(is_exact_match_criteria(&CellValue::Boolean(true)));
    assert!(is_exact_match_criteria(&CellValue::Null));
    assert!(is_exact_match_criteria(&CellValue::Error(
        CellError::Na,
        None
    )));
}

#[test]
fn test_not_exact_match_operators() {
    assert!(!is_exact_match_criteria(&text(">5")));
    assert!(!is_exact_match_criteria(&text("<5")));
    assert!(!is_exact_match_criteria(&text(">=5")));
    assert!(!is_exact_match_criteria(&text("<=5")));
    assert!(!is_exact_match_criteria(&text("<>5")));
    assert!(!is_exact_match_criteria(&text("=5")));
}

#[test]
fn test_not_exact_match_wildcards() {
    assert!(!is_exact_match_criteria(&text("*")));
    assert!(!is_exact_match_criteria(&text("hello*")));
    assert!(!is_exact_match_criteria(&text("h?llo")));
    assert!(!is_exact_match_criteria(&text("*test*")));
}

#[test]
fn test_exact_match_escaped_wildcards() {
    assert!(is_exact_match_criteria(&text("hello~*")));
    assert!(is_exact_match_criteria(&text("hello~?")));
}

#[test]
fn test_exact_match_text_as_number() {
    assert!(is_exact_match_criteria(&text("5")));
    assert!(is_exact_match_criteria(&text("3.14")));
    assert!(is_exact_match_criteria(&text("-10")));
    assert!(is_exact_match_criteria(&text("0")));
}

#[test]
fn test_not_exact_match_boolean_text() {
    assert!(!is_exact_match_criteria(&text("TRUE")));
    assert!(!is_exact_match_criteria(&text("FALSE")));
    assert!(!is_exact_match_criteria(&text("true")));
    assert!(!is_exact_match_criteria(&text("false")));
    assert!(!is_exact_match_criteria(&text("True")));
    assert!(!is_exact_match_criteria(&text("False")));
    assert!(is_exact_match_criteria(&CellValue::Boolean(true)));
    assert!(is_exact_match_criteria(&CellValue::Boolean(false)));
}

#[test]
fn test_exact_match_array_criteria() {
    let arr_num = CellValue::from_rows(vec![vec![CellValue::number(42.0)]]);
    assert!(is_exact_match_criteria(&arr_num));

    let arr_text = CellValue::from_rows(vec![vec![CellValue::Text("ios".into())]]);
    assert!(is_exact_match_criteria(&arr_text));

    let arr_op = CellValue::from_rows(vec![vec![CellValue::Text(">5".into())]]);
    assert!(!is_exact_match_criteria(&arr_op));

    let arr_wild = CellValue::from_rows(vec![vec![CellValue::Text("hello*".into())]]);
    assert!(!is_exact_match_criteria(&arr_wild));

    let arr_empty = CellValue::from_rows(vec![]);
    assert!(is_exact_match_criteria(&arr_empty));
}

#[test]
fn test_unescaped_wildcards() {
    assert!(has_unescaped_wildcard("*"));
    assert!(has_unescaped_wildcard("hello*"));
    assert!(has_unescaped_wildcard("h?llo"));
    assert!(!has_unescaped_wildcard("hello"));
    assert!(!has_unescaped_wildcard("hello~*"));
    assert!(!has_unescaped_wildcard("hello~?"));
    assert!(!has_unescaped_wildcard("hello~~"));
}

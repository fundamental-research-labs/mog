use super::super::text::{
    contains_case_insensitive, ends_with_case_insensitive, starts_with_case_insensitive,
};
use super::*;

#[test]
fn test_contains_case_insensitive_fn() {
    assert!(contains_case_insensitive("Hello World", "WORLD"));
    assert!(contains_case_insensitive("Hello World", "hello"));
    assert!(!contains_case_insensitive("Hello World", "xyz"));
    assert!(contains_case_insensitive("Hello", ""));
    assert!(!contains_case_insensitive("", "a"));
}

#[test]
fn test_starts_with_case_insensitive_fn() {
    assert!(starts_with_case_insensitive("Hello", "HEL"));
    assert!(starts_with_case_insensitive("Hello", "hel"));
    assert!(!starts_with_case_insensitive("Hello", "llo"));
}

#[test]
fn test_ends_with_case_insensitive_fn() {
    assert!(ends_with_case_insensitive("Hello", "LLO"));
    assert!(ends_with_case_insensitive("Hello", "llo"));
    assert!(!ends_with_case_insensitive("Hello", "Hel"));
}

#[test]
fn test_unicode_case_insensitive() {
    assert!(contains_case_insensitive("Straße", "straße"));
    assert!(starts_with_case_insensitive("Straße", "stra"));
    assert!(ends_with_case_insensitive("Straße", "aße"));
}

#[test]
fn contains_empty_string_matches_everything() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Contains,
        value: CellValue::Text("".into()),
    };
    assert!(matches_condition(
        &CellValue::Text("anything".into()),
        &cond
    ));
    assert!(matches_condition(&CellValue::Text("".into()), &cond));
    assert!(matches_condition(
        &CellValue::Text("hello world".into()),
        &cond
    ));
}

#[test]
fn starts_with_empty_string_matches_everything() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::StartsWith,
        value: CellValue::Text("".into()),
    };
    assert!(matches_condition(
        &CellValue::Text("anything".into()),
        &cond
    ));
    assert!(matches_condition(&CellValue::Text("".into()), &cond));
}

#[test]
fn ends_with_empty_string_matches_everything() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::EndsWith,
        value: CellValue::Text("".into()),
    };
    assert!(matches_condition(
        &CellValue::Text("anything".into()),
        &cond
    ));
    assert!(matches_condition(&CellValue::Text("".into()), &cond));
}

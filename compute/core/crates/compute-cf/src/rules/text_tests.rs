use super::*;
use value_types::FiniteF64;

// -----------------------------------------------------------------------
// Contains
// -----------------------------------------------------------------------

#[test]
fn test_contains_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(evaluate_text(&value, &CFTextOperator::Contains, "world"));
}

#[test]
fn test_contains_no_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(!evaluate_text(&value, &CFTextOperator::Contains, "xyz"));
}

#[test]
fn test_contains_case_insensitive() {
    let value = CellValue::Text("Hello World".into());
    // search_text is expected to be pre-lowered at TryFrom boundary
    assert!(evaluate_text(&value, &CFTextOperator::Contains, "hello"));
}

#[test]
fn test_contains_empty_search() {
    let value = CellValue::Text("Hello".into());
    // Empty string is contained in every string
    assert!(evaluate_text(&value, &CFTextOperator::Contains, ""));
}

// -----------------------------------------------------------------------
// NotContains
// -----------------------------------------------------------------------

#[test]
fn test_not_contains_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(evaluate_text(&value, &CFTextOperator::NotContains, "xyz"));
}

#[test]
fn test_not_contains_no_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(!evaluate_text(
        &value,
        &CFTextOperator::NotContains,
        "world"
    ));
}

// -----------------------------------------------------------------------
// BeginsWith
// -----------------------------------------------------------------------

#[test]
fn test_begins_with_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(evaluate_text(&value, &CFTextOperator::BeginsWith, "hello"));
}

#[test]
fn test_begins_with_no_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(!evaluate_text(&value, &CFTextOperator::BeginsWith, "world"));
}

// -----------------------------------------------------------------------
// EndsWith
// -----------------------------------------------------------------------

#[test]
fn test_ends_with_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(evaluate_text(&value, &CFTextOperator::EndsWith, "world"));
}

#[test]
fn test_ends_with_no_match() {
    let value = CellValue::Text("Hello World".into());
    assert!(!evaluate_text(&value, &CFTextOperator::EndsWith, "hello"));
}

// -----------------------------------------------------------------------
// Non-text CellValue types (coerced to string via Display)
// -----------------------------------------------------------------------

#[test]
fn test_number_value_contains() {
    let value = CellValue::Number(FiniteF64::must(42.0));
    // Number(42.0) displays as "42"
    assert!(evaluate_text(&value, &CFTextOperator::Contains, "42"));
}

#[test]
fn test_boolean_value_contains() {
    let value = CellValue::Boolean(true);
    // Boolean(true) displays as "TRUE", lowered to "true" for comparison
    assert!(evaluate_text(&value, &CFTextOperator::Contains, "true"));
}

#[test]
fn test_null_value_contains_empty() {
    let value = CellValue::Null;
    // Null displays as "" — empty string contains ""
    assert!(evaluate_text(&value, &CFTextOperator::Contains, ""));
}

#[test]
fn test_null_value_not_contains_text() {
    let value = CellValue::Null;
    assert!(!evaluate_text(&value, &CFTextOperator::Contains, "hello"));
}

// -----------------------------------------------------------------------
// Error values are skipped (Excel behavior: errors never participate in text matching)
// -----------------------------------------------------------------------

#[test]
fn test_error_value_contains_display_string_returns_none() {
    use value_types::CellError;
    // In Excel, error cells are skipped — even if the search text matches the display string.
    let value = CellValue::Error(CellError::Div0, None);
    assert!(!evaluate_text(&value, &CFTextOperator::Contains, "#div/0!"));
}

#[test]
fn test_error_value_not_contains_returns_none() {
    use value_types::CellError;
    // In Excel, error cells are skipped entirely — NotContains also returns false (not a match).
    let value = CellValue::Error(CellError::Div0, None);
    assert!(!evaluate_text(
        &value,
        &CFTextOperator::NotContains,
        "#div/0!"
    ));
}

// -----------------------------------------------------------------------
// Empty search text with NotContains
// -----------------------------------------------------------------------

#[test]
fn test_not_contains_empty_search() {
    let value = CellValue::Text("Hello".into());
    // Empty string is contained in every string, so NotContains returns false
    assert!(!evaluate_text(&value, &CFTextOperator::NotContains, ""));
}

// -----------------------------------------------------------------------
// Null with Contains and NotContains
// -----------------------------------------------------------------------

#[test]
fn test_null_contains_nonempty_text() {
    let value = CellValue::Null;
    // Null displays as "", which does not contain "hello"
    assert!(!evaluate_text(&value, &CFTextOperator::Contains, "hello"));
}

#[test]
fn test_null_not_contains_nonempty_text() {
    let value = CellValue::Null;
    // Null displays as "", which does not contain "hello", so NotContains matches
    assert!(evaluate_text(&value, &CFTextOperator::NotContains, "hello"));
}

#[test]
fn test_null_not_contains_empty() {
    let value = CellValue::Null;
    // Null displays as "", empty string contains "", so NotContains returns false
    assert!(!evaluate_text(&value, &CFTextOperator::NotContains, ""));
}

// -----------------------------------------------------------------------
// Unicode and special character tests
// -----------------------------------------------------------------------

#[test]
fn test_contains_unicode_accented() {
    let value = CellValue::Text("caf\u{00e9}".into());
    // search_text is expected to be pre-lowered at TryFrom boundary
    assert!(evaluate_text(
        &value,
        &CFTextOperator::Contains,
        "caf\u{00e9}"
    ));
}

#[test]
fn test_contains_cjk_characters() {
    let value = CellValue::Text("\u{65E5}\u{672C}\u{8A9E}".into());
    assert!(evaluate_text(
        &value,
        &CFTextOperator::Contains,
        "\u{65E5}\u{672C}\u{8A9E}",
    ));
}

#[test]
fn test_contains_whitespace_only() {
    let value = CellValue::Text("   ".into());
    assert!(evaluate_text(&value, &CFTextOperator::Contains, " "));
}

#[test]
fn test_begins_with_empty_search() {
    let value = CellValue::Text("Hello".into());
    // Empty string is a prefix of every string
    assert!(evaluate_text(&value, &CFTextOperator::BeginsWith, ""));
}

#[test]
fn test_ends_with_empty_search() {
    let value = CellValue::Text("Hello".into());
    // Empty string is a suffix of every string
    assert!(evaluate_text(&value, &CFTextOperator::EndsWith, ""));
}

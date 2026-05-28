use value_types::{CellError, CellValue};

use crate::helpers::criteria::{parse_criteria, wildcard_match};

#[test]
fn test_wildcard_match() {
    assert!(wildcard_match("hello", "hello"));
    assert!(wildcard_match("hello", "HELLO"));
    assert!(wildcard_match("h*o", "hello"));
    assert!(wildcard_match("h?llo", "hello"));
    assert!(!wildcard_match("h?lo", "hello"));
    assert!(wildcard_match("*", "anything"));
    assert!(wildcard_match("*test*", "this is a test here"));
    assert!(!wildcard_match("abc", "abcd"));
}

// -----------------------------------------------------------------------
// FIX 1: Tilde escape in wildcard_match
// -----------------------------------------------------------------------

#[test]
fn test_wildcard_tilde_escape_star() {
    // ~* should match a literal '*'
    assert!(wildcard_match("hello~*", "hello*"));
    // Without tilde, * is a wildcard
    assert!(wildcard_match("hello*", "helloworld"));
    // Escaped * should NOT act as wildcard
    assert!(!wildcard_match("hello~*", "helloworld"));
}

#[test]
fn test_wildcard_tilde_escape_star_in_middle() {
    // ~* in the middle: "hello~*world" should match "hello*world" literally
    assert!(wildcard_match("hello~*world", "hello*world"));
    // Should NOT match "helloanythingworld" because ~* is literal
    assert!(!wildcard_match("hello~*world", "helloanythingworld"));
}

#[test]
fn test_wildcard_tilde_escape_question() {
    // ~? should match a literal '?'
    assert!(wildcard_match("hello~?", "hello?"));
    // Escaped ? should NOT act as wildcard
    assert!(!wildcard_match("hello~?", "hellox"));
}

#[test]
fn test_wildcard_tilde_escape_tilde() {
    // ~~ should match a literal '~'
    assert!(wildcard_match("hello~~", "hello~"));
    // Should not match "hello~~" (that would need hello~~~~)
    assert!(!wildcard_match("hello~~", "hello~~"));
}

#[test]
fn test_wildcard_tilde_at_end() {
    // A lone ~ at end of pattern matches literal ~
    assert!(wildcard_match("hello~", "hello~"));
    assert!(!wildcard_match("hello~", "hellox"));
}

#[test]
fn test_wildcard_tilde_combined_with_wildcards() {
    // Mix of escaped and unescaped wildcards
    // Pattern: *~** means: any chars, literal *, any chars
    assert!(wildcard_match("*~**", "abc*def"));
    assert!(wildcard_match("*~**", "*"));
    assert!(!wildcard_match("*~**", "abcdef")); // no literal * in text
}

// -----------------------------------------------------------------------
// Wildcard type guard — only match CellValue::Text
// -----------------------------------------------------------------------

#[test]
fn test_wildcard_does_not_match_numbers() {
    // "104*" should NOT match Number(104192) — Excel wildcards only match Text
    let crit = parse_criteria(&CellValue::Text("104*".into()));
    assert!(!crit(&CellValue::number(104192.0)));
    assert!(!crit(&CellValue::number(104.0)));
    assert!(!crit(&CellValue::number(10400.0)));
    // But SHOULD match Text that starts with "104"
    assert!(crit(&CellValue::Text("104abc".into())));
    assert!(crit(&CellValue::Text("104".into())));
}

#[test]
fn test_wildcard_does_not_match_booleans() {
    let crit = parse_criteria(&CellValue::Text("TRU*".into()));
    assert!(!crit(&CellValue::Boolean(true)));
    assert!(crit(&CellValue::Text("TRUE".into())));
    assert!(crit(&CellValue::Text("TRUTHY".into())));
}

#[test]
fn test_wildcard_does_not_match_errors() {
    let crit = parse_criteria(&CellValue::Text("#N*".into()));
    assert!(!crit(&CellValue::Error(CellError::Na, None)));
    assert!(crit(&CellValue::Text("#N/A".into())));
}

#[test]
fn test_wildcard_does_not_match_null() {
    let crit = parse_criteria(&CellValue::Text("*".into()));
    assert!(!crit(&CellValue::Null));
    // But matches any non-empty text
    assert!(crit(&CellValue::Text("anything".into())));
    // And matches empty text (Excel: "*" matches "" for Text cells)
    assert!(crit(&CellValue::Text("".into())));
}

#[test]
fn test_question_mark_does_not_match_numbers() {
    // "?" matches exactly one character of Text
    let crit = parse_criteria(&CellValue::Text("?".into()));
    assert!(!crit(&CellValue::number(5.0)));
    assert!(crit(&CellValue::Text("A".into())));
    assert!(!crit(&CellValue::Text("AB".into())));
}

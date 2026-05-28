use value_types::{CellError, CellValue};

use crate::helpers::criteria::parse_criteria;

// -----------------------------------------------------------------------
// FIX 2: parse_criteria <> with error values
// -----------------------------------------------------------------------

#[test]
fn test_parse_criteria_ne_text_does_not_count_errors() {
    // <>text should NOT match error values
    let crit = parse_criteria(&CellValue::Text("<>hello".into()));
    // Non-matching text should be true
    assert!(crit(&CellValue::Text("world".into())));
    // Matching text should be false
    assert!(!crit(&CellValue::Text("hello".into())));
    // Error values should return false (not counted)
    assert!(!crit(&CellValue::Error(CellError::Value, None)));
    assert!(!crit(&CellValue::Error(CellError::Na, None)));
    assert!(!crit(&CellValue::Error(CellError::Ref, None)));
    assert!(!crit(&CellValue::Error(CellError::Div0, None)));
}

#[test]
fn test_parse_criteria_ne_number_with_errors() {
    // <>5 — errors are non-participants (Excel does NOT count them)
    let crit = parse_criteria(&CellValue::Text("<>5".into()));
    assert!(crit(&CellValue::number(4.0)));
    assert!(!crit(&CellValue::number(5.0)));
    // Errors are non-participants in numeric criteria matching
    assert!(!crit(&CellValue::Error(CellError::Value, None)));
}

#[test]
fn test_parse_criteria_null_matches_only_null() {
    let crit = parse_criteria(&CellValue::Null);
    // Null criteria should match Null cells
    assert!(crit(&CellValue::Null));
    // Null criteria should NOT match Number(0.0) — Excel blank criteria matches blank only
    assert!(!crit(&CellValue::number(0.0)));
    // Null criteria should not match other values
    assert!(!crit(&CellValue::number(1.0)));
    assert!(!crit(&CellValue::Text("".into())));
    assert!(!crit(&CellValue::Text("hello".into())));
    assert!(!crit(&CellValue::Boolean(false)));
    assert!(!crit(&CellValue::Error(CellError::Value, None)));
}

// -----------------------------------------------------------------------
// FIX 7: Null & Boolean non-participation in numeric criteria
// -----------------------------------------------------------------------

#[test]
fn test_null_does_not_match_bare_numeric_criteria() {
    let crit = parse_criteria(&CellValue::number(0.0));
    assert!(!crit(&CellValue::Null)); // empty ≠ 0
    assert!(crit(&CellValue::number(0.0))); // actual zero matches
    assert!(crit(&CellValue::Text("0".into()))); // text "0" matches

    let crit = parse_criteria(&CellValue::number(5.0));
    assert!(!crit(&CellValue::Null)); // empty ≠ 5
}

#[test]
fn test_null_does_not_match_operator_numeric_criteria() {
    assert!(!parse_criteria(&CellValue::Text(">=0".into()))(
        &CellValue::Null
    ));
    assert!(!parse_criteria(&CellValue::Text("<=0".into()))(
        &CellValue::Null
    ));
    assert!(!parse_criteria(&CellValue::Text(">-1".into()))(
        &CellValue::Null
    ));
    assert!(!parse_criteria(&CellValue::Text("<1".into()))(
        &CellValue::Null
    ));
    assert!(!parse_criteria(&CellValue::Text("=0".into()))(
        &CellValue::Null
    ));
    assert!(!parse_criteria(&CellValue::Text("<>0".into()))(
        &CellValue::Null
    ));
    assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
        &CellValue::Null
    ));
}

#[test]
fn test_null_does_not_match_text_as_number_criteria() {
    let crit = parse_criteria(&CellValue::Text("0".into()));
    assert!(!crit(&CellValue::Null));
    assert!(crit(&CellValue::number(0.0)));
}

#[test]
fn test_boolean_does_not_match_numeric_criteria() {
    assert!(!parse_criteria(&CellValue::number(0.0))(
        &CellValue::Boolean(false)
    ));
    assert!(!parse_criteria(&CellValue::number(1.0))(
        &CellValue::Boolean(true)
    ));
    assert!(!parse_criteria(&CellValue::Text(">=0".into()))(
        &CellValue::Boolean(false)
    ));
    assert!(!parse_criteria(&CellValue::Text("<=1".into()))(
        &CellValue::Boolean(true)
    ));
    assert!(!parse_criteria(&CellValue::Text("<>0".into()))(
        &CellValue::Boolean(false)
    ));
    assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
        &CellValue::Boolean(true)
    ));
}

#[test]
fn test_ne_numeric_errors_are_non_participants() {
    assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
        &CellValue::Error(CellError::Na, None)
    ));
    assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
        &CellValue::Error(CellError::Value, None)
    ));
}

// -----------------------------------------------------------------------
// FIX 8: Error criteria should match same error type
// -----------------------------------------------------------------------

#[test]
fn test_parse_criteria_error_matches_same_error() {
    // #N/A criteria should match #N/A cells
    let crit = parse_criteria(&CellValue::Error(CellError::Na, None));
    assert!(crit(&CellValue::Error(CellError::Na, None)));
}

#[test]
fn test_parse_criteria_error_does_not_match_different_error() {
    // #N/A criteria should NOT match #REF! cells
    let crit = parse_criteria(&CellValue::Error(CellError::Na, None));
    assert!(!crit(&CellValue::Error(CellError::Ref, None)));
    assert!(!crit(&CellValue::Error(CellError::Value, None)));
    assert!(!crit(&CellValue::Error(CellError::Div0, None)));
}

#[test]
fn test_parse_criteria_error_does_not_match_non_errors() {
    // #N/A criteria should NOT match numbers, text, null, booleans
    let crit = parse_criteria(&CellValue::Error(CellError::Na, None));
    assert!(!crit(&CellValue::number(0.0)));
    assert!(!crit(&CellValue::Text("".into())));
    assert!(!crit(&CellValue::Text("#N/A".into())));
    assert!(!crit(&CellValue::Null));
    assert!(!crit(&CellValue::Boolean(false)));
}

#[test]
fn test_parse_criteria_ref_error_matches_ref() {
    // #REF! criteria should match #REF! cells
    let crit = parse_criteria(&CellValue::Error(CellError::Ref, None));
    assert!(crit(&CellValue::Error(CellError::Ref, None)));
    assert!(!crit(&CellValue::Error(CellError::Na, None)));
    assert!(!crit(&CellValue::number(0.0)));
}

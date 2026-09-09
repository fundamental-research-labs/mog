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
    // Numeric not-equal matches errors; the aggregate decides whether to propagate.
    let crit = parse_criteria(&CellValue::Text("<>5".into()));
    assert!(crit(&CellValue::number(4.0)));
    assert!(!crit(&CellValue::number(5.0)));
    assert!(crit(&CellValue::Error(CellError::Value, None)));
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
fn test_null_matches_only_numeric_not_equal_operator() {
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
    assert!(parse_criteria(&CellValue::Text("<>0".into()))(
        &CellValue::Null
    ));
    assert!(parse_criteria(&CellValue::Text("<>5".into()))(
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
fn test_boolean_matches_only_numeric_not_equal_criteria() {
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
    assert!(parse_criteria(&CellValue::Text("<>0".into()))(
        &CellValue::Boolean(false)
    ));
    assert!(parse_criteria(&CellValue::Text("<>5".into()))(
        &CellValue::Boolean(true)
    ));
}

#[test]
fn test_ne_numeric_matches_errors() {
    assert!(parse_criteria(&CellValue::Text("<>5".into()))(
        &CellValue::Error(CellError::Na, None)
    ));
    assert!(parse_criteria(&CellValue::Text("<>5".into()))(
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
fn test_parse_criteria_error_ignores_diagnostic_message() {
    // Spreadsheet error equality is determined by the error code.  A
    // diagnostic is contextual metadata and must not change COUNTIF matching.
    let crit = parse_criteria(&CellValue::Error(
        CellError::Na,
        Some("criterion context".into()),
    ));
    assert!(crit(&CellValue::Error(
        CellError::Na,
        Some("range context".into()),
    )));
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

#[test]
fn numeric_not_equal_criteria_cover_all_conditional_aggregate_families() {
    let registry = crate::FunctionRegistry::new();
    let criteria_range = CellValue::from_rows(vec![vec![
        CellValue::number(100.0),
        CellValue::Text("100".into()),
        CellValue::Text("other".into()),
        CellValue::Null,
        CellValue::Boolean(true),
        CellValue::Error(CellError::Na, None),
    ]]);
    let numeric_values = CellValue::from_rows(vec![vec![
        CellValue::number(1000.0),
        CellValue::number(2000.0),
        CellValue::number(2.0),
        CellValue::number(4.0),
        CellValue::number(6.0),
        CellValue::number(8.0),
    ]]);
    let criteria = CellValue::Text("<>100".into());
    assert_eq!(
        registry.call("COUNTIF", &[criteria_range.clone(), criteria.clone()]),
        CellValue::number(4.0)
    );
    assert_eq!(
        registry.call("COUNTIFS", &[criteria_range.clone(), criteria.clone()]),
        CellValue::number(4.0)
    );
    for (name, expected) in [("SUMIF", 20.0), ("AVERAGEIF", 5.0)] {
        assert_eq!(
            registry.call(
                name,
                &[
                    criteria_range.clone(),
                    criteria.clone(),
                    numeric_values.clone()
                ]
            ),
            CellValue::number(expected),
            "{name}"
        );
    }
    for (name, expected) in [
        ("SUMIFS", 20.0),
        ("AVERAGEIFS", 5.0),
        ("MINIFS", 2.0),
        ("MAXIFS", 8.0),
    ] {
        assert_eq!(
            registry.call(
                name,
                &[
                    numeric_values.clone(),
                    criteria_range.clone(),
                    criteria.clone()
                ]
            ),
            CellValue::number(expected),
            "{name}"
        );
    }

    // A matching error in the criteria range can be counted, but an error
    // in the corresponding aggregate value must propagate.
    for name in ["SUMIF", "AVERAGEIF"] {
        assert_eq!(
            registry.call(
                name,
                &[
                    criteria_range.clone(),
                    criteria.clone(),
                    criteria_range.clone()
                ]
            ),
            CellValue::Error(CellError::Na, None),
            "{name}"
        );
    }
    for name in ["SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS"] {
        assert_eq!(
            registry.call(
                name,
                &[
                    criteria_range.clone(),
                    criteria_range.clone(),
                    criteria.clone()
                ]
            ),
            CellValue::Error(CellError::Na, None),
            "{name}"
        );
    }
}

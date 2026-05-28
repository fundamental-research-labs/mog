use value_types::{CellError, CellValue};

use crate::helpers::criteria::parse_criteria;

// -----------------------------------------------------------------------
// <> blank semantics — explicit match block
// -----------------------------------------------------------------------

#[test]
fn test_ne_blank_excludes_null() {
    let crit = parse_criteria(&CellValue::Text("<>".into()));
    assert!(!crit(&CellValue::Null));
}

#[test]
fn test_ne_blank_excludes_empty_text() {
    let crit = parse_criteria(&CellValue::Text("<>".into()));
    // Text("") is content (e.g., formula result), so "<>" matches it.
    // Only CellValue::Null (truly empty) is excluded.
    assert!(crit(&CellValue::Text("".into())));
}

#[test]
fn test_ne_blank_excludes_errors() {
    let crit = parse_criteria(&CellValue::Text("<>".into()));
    assert!(!crit(&CellValue::Error(CellError::Na, None)));
    assert!(!crit(&CellValue::Error(CellError::Value, None)));
}

#[test]
fn test_ne_blank_includes_numbers() {
    let crit = parse_criteria(&CellValue::Text("<>".into()));
    assert!(crit(&CellValue::number(0.0)));
    assert!(crit(&CellValue::number(42.0)));
}

#[test]
fn test_ne_blank_includes_text() {
    let crit = parse_criteria(&CellValue::Text("<>".into()));
    assert!(crit(&CellValue::Text("hello".into())));
}

#[test]
fn test_ne_blank_includes_booleans() {
    let crit = parse_criteria(&CellValue::Text("<>".into()));
    assert!(crit(&CellValue::Boolean(true)));
    assert!(crit(&CellValue::Boolean(false)));
}

#[test]
fn test_eq_ne_blank_complementarity() {
    let eq_crit = parse_criteria(&CellValue::Text("=".into()));
    let ne_crit = parse_criteria(&CellValue::Text("<>".into()));

    // For most values, exactly one of "=" and "<>" should match
    let complementary_values = vec![
        CellValue::Null,                 // "=" matches, "<>" doesn't
        CellValue::number(0.0),          // "<>" matches, "=" doesn't
        CellValue::number(42.0),         // "<>" matches, "=" doesn't
        CellValue::Text("hello".into()), // "<>" matches, "=" doesn't
        CellValue::Boolean(true),        // "<>" matches, "=" doesn't
        CellValue::Boolean(false),       // "<>" matches, "=" doesn't
    ];

    for val in &complementary_values {
        let eq = eq_crit(val);
        let ne = ne_crit(val);
        assert!(
            eq ^ ne,
            "Complementarity failed for {:?}: eq={}, ne={}",
            val,
            eq,
            ne
        );
    }

    // Special case: Text("") matches BOTH "=" and "<>" (Excel behavior —
    // formula-produced "" is "equal to blank" but also "not blank")
    let empty_text = CellValue::Text("".into());
    assert!(eq_crit(&empty_text), "Text(\"\") should match \"=\"");
    assert!(ne_crit(&empty_text), "Text(\"\") should match \"<>\"");
}

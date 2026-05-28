use value_types::CellValue;

use crate::helpers::criteria::parse_criteria;

// -----------------------------------------------------------------------
// FIX 6: Array criteria should extract first scalar element
// -----------------------------------------------------------------------

#[test]
fn test_parse_criteria_array_extracts_first_element() {
    // Single-element array with text (e.g. from structured table ref)
    let crit = parse_criteria(&CellValue::from_rows(vec![vec![CellValue::Text(
        "Alice".into(),
    )]]));
    assert!(crit(&CellValue::Text("Alice".into())));
    assert!(crit(&CellValue::Text("alice".into()))); // case-insensitive
    assert!(!crit(&CellValue::Text("Bob".into())));

    // Single-element array with number
    let crit = parse_criteria(&CellValue::from_rows(vec![vec![CellValue::number(42.0)]]));
    assert!(crit(&CellValue::number(42.0)));
    assert!(!crit(&CellValue::number(43.0)));

    // Multi-element array — uses first element only
    let crit = parse_criteria(&CellValue::from_rows(vec![vec![
        CellValue::Text("hello".into()),
        CellValue::Text("world".into()),
    ]]));
    assert!(crit(&CellValue::Text("hello".into())));
    assert!(!crit(&CellValue::Text("world".into())));

    // Empty array → Null criteria
    let crit = parse_criteria(&CellValue::from_rows(vec![]));
    assert!(crit(&CellValue::Null));
    assert!(!crit(&CellValue::number(0.0)));
}

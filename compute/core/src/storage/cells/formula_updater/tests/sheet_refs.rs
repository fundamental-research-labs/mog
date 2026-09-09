use super::super::sheet_refs::{
    escape_sheet_name_for_formula, replace_sheet_name_in_a1_formula, sheet_name_needs_quoting,
};

#[test]
fn test_sheet_name_needs_quoting_simple() {
    assert!(!sheet_name_needs_quoting("Sheet1"));
    assert!(!sheet_name_needs_quoting("Data"));
    assert!(!sheet_name_needs_quoting("MySheet"));
    assert!(!sheet_name_needs_quoting("_private"));
    assert!(!sheet_name_needs_quoting("a"));
}

#[test]
fn test_sheet_name_needs_quoting_special() {
    assert!(sheet_name_needs_quoting("My Sheet"));
    assert!(sheet_name_needs_quoting("2024Data"));
    assert!(sheet_name_needs_quoting("Sheet's"));
    assert!(sheet_name_needs_quoting("Data-2024"));
    assert!(sheet_name_needs_quoting("Sheet.1"));
    assert!(sheet_name_needs_quoting(""));
}

#[test]
fn test_escape_sheet_name_plain() {
    assert_eq!(escape_sheet_name_for_formula("Sheet1"), "Sheet1");
    assert_eq!(escape_sheet_name_for_formula("Data"), "Data");
    assert_eq!(escape_sheet_name_for_formula("_test"), "_test");
}

#[test]
fn test_escape_sheet_name_with_spaces() {
    assert_eq!(escape_sheet_name_for_formula("My Sheet"), "'My Sheet'");
    assert_eq!(
        escape_sheet_name_for_formula("Revenue Data"),
        "'Revenue Data'"
    );
}

#[test]
fn test_escape_sheet_name_with_quotes() {
    assert_eq!(
        escape_sheet_name_for_formula("Sheet's Data"),
        "'Sheet''s Data'"
    );
    assert_eq!(escape_sheet_name_for_formula("It's"), "'It''s'");
}

#[test]
fn test_escape_sheet_name_empty() {
    assert_eq!(escape_sheet_name_for_formula(""), "''");
}

#[test]
fn test_replace_a1_formula_basic() {
    assert_eq!(
        replace_sheet_name_in_a1_formula("Sheet2!A1+Sheet2!B2", "Sheet2", "Revenue"),
        "Revenue!A1+Revenue!B2"
    );
}

#[test]
fn test_replace_a1_formula_empty() {
    assert_eq!(replace_sheet_name_in_a1_formula("", "Sheet1", "Data"), "");
    assert_eq!(
        replace_sheet_name_in_a1_formula("Sheet1!A1", "", "Data"),
        "Sheet1!A1"
    );
}

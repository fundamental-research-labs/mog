use super::super::sheet_refs::{
    escape_sheet_name_for_formula, invalidate_sheet_references_in_a1_formula,
    replace_sheet_name_in_a1_formula, sheet_name_needs_quoting,
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

#[test]
fn test_replace_a1_formula_rewrites_only_sheet_reference_tokens() {
    assert_eq!(
        replace_sheet_name_in_a1_formula(
            "=SUM('Old''s Data'!A1,\"Old's Data!A1\",OtherOld!A1)",
            "Old's Data",
            "New Data",
        ),
        "=SUM('New Data'!A1,\"Old's Data!A1\",OtherOld!A1)"
    );
}

#[test]
fn test_replace_a1_formula_preserves_escaped_double_quotes() {
    assert_eq!(
        replace_sheet_name_in_a1_formula(
            "=IF(A1=\"quoted \"\"Old!A1\"\"\",Old!A1,0)",
            "Old",
            "New Sheet",
        ),
        "=IF(A1=\"quoted \"\"Old!A1\"\"\",'New Sheet'!A1,0)"
    );
}

#[test]
fn test_replace_a1_formula_rewrites_all_local_sheet_reference_forms() {
    assert_eq!(
        replace_sheet_name_in_a1_formula(
            "=SUM(old!$A:$C,OLD!$1:$2,Old!LocalValue)",
            "Old",
            "New Sheet",
        ),
        "=SUM('New Sheet'!$A:$C,'New Sheet'!$1:$2,'New Sheet'!LocalValue)"
    );
}

#[test]
fn test_replace_a1_formula_rewrites_sheet_qualified_range_endpoints() {
    assert_eq!(
        replace_sheet_name_in_a1_formula("=SUM(Old!A1:Old!A2,A1:Old!A2)", "Old", "New"),
        "=SUM(New!A1:New!A2,A1:New!A2)"
    );
}

#[test]
fn test_replace_a1_formula_preserves_external_and_three_d_references() {
    let formula = "=SUM([Other.xlsx]Old!A1,'[Other.xlsx]Old'!$A:$A,Start:Old!A1,Old:End!A1)";
    assert_eq!(
        replace_sheet_name_in_a1_formula(formula, "Old", "New Sheet"),
        formula
    );
}

#[test]
fn test_invalidate_sheet_references_rewrites_only_reference_tokens() {
    assert_eq!(
        invalidate_sheet_references_in_a1_formula("=SUM(Old!A1,\"Old!A1\",OtherOld!A1)", "Old",),
        "=SUM(#REF!,\"Old!A1\",OtherOld!A1)"
    );
}

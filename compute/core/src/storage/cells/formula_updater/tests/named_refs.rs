use super::super::named_refs::{formula_contains_name_ref, replace_name_in_formula};

#[test]
fn test_formula_contains_name_ref_simple() {
    assert!(formula_contains_name_ref("MyName+1", "MyName"));
    assert!(formula_contains_name_ref("=MyName", "MyName"));
    assert!(formula_contains_name_ref("SUM(MyName)", "MyName"));
    assert!(formula_contains_name_ref("MyName*2+SalesData", "MyName"));
}

#[test]
fn test_formula_contains_name_ref_word_boundary() {
    assert!(!formula_contains_name_ref("SalesData+1", "Data"));
    assert!(!formula_contains_name_ref("MyData_2+1", "Data"));
    assert!(!formula_contains_name_ref("DataPoint", "Data"));
    assert!(formula_contains_name_ref("Data+1", "Data"));
    assert!(formula_contains_name_ref("=Data", "Data"));
}

#[test]
fn test_formula_contains_name_ref_case_insensitive() {
    assert!(formula_contains_name_ref("MYNAME+1", "MyName"));
    assert!(formula_contains_name_ref("myname+1", "MyName"));
}

#[test]
fn test_replace_name_in_formula_basic() {
    assert_eq!(
        replace_name_in_formula("=MyName+1", "MyName", "NewName"),
        "=NewName+1"
    );
    assert_eq!(
        replace_name_in_formula("SUM(MyName)", "MyName", "Revenue"),
        "SUM(Revenue)"
    );
}

#[test]
fn test_replace_name_in_formula_word_boundary() {
    assert_eq!(
        replace_name_in_formula("=SalesData+Data", "Data", "Info"),
        "=SalesData+Info"
    );
    assert_eq!(
        replace_name_in_formula("=MyData_2+Data", "Data", "X"),
        "=MyData_2+X"
    );
}

#[test]
fn test_replace_name_in_formula_multiple_occurrences() {
    assert_eq!(
        replace_name_in_formula("=Foo+Foo+Foo", "Foo", "Bar"),
        "=Bar+Bar+Bar"
    );
}

#[test]
fn test_replace_name_in_formula_no_change_on_substring() {
    assert_eq!(
        replace_name_in_formula("=SalesData+1", "Data", "X"),
        "=SalesData+1"
    );
}

#[test]
fn test_replace_name_in_formula_case_insensitive() {
    assert_eq!(
        replace_name_in_formula("=myname+1", "MyName", "NewName"),
        "=NewName+1"
    );
}

#[test]
fn t2_replace_name_skips_string_literal() {
    assert_eq!(
        replace_name_in_formula("=IF(A1=\"Region\", 1, Region)", "Region", "Sales"),
        "=IF(A1=\"Region\", 1, Sales)"
    );
}

#[test]
fn t2_replace_name_skips_sheet_prefix() {
    assert_eq!(
        replace_name_in_formula("=Region!A1+Region", "Region", "Sales"),
        "=Region!A1+Sales"
    );
}

#[test]
fn t2_replace_name_skips_quoted_sheet_prefix() {
    assert_eq!(
        replace_name_in_formula("='Region'!A1+Region", "Region", "Sales"),
        "='Region'!A1+Sales"
    );
}

#[test]
fn t2_replace_name_skips_function_call() {
    assert_eq!(
        replace_name_in_formula("=SUM(Region)", "SUM", "Total"),
        "=SUM(Region)"
    );
    assert_eq!(
        replace_name_in_formula("=SUM(Region)", "Region", "Sales"),
        "=SUM(Sales)"
    );
}

#[test]
fn t2_replace_name_skips_table_ref() {
    assert_eq!(
        replace_name_in_formula("=Region+Table1[Col]", "Table1", "X"),
        "=Region+Table1[Col]"
    );
    assert_eq!(
        replace_name_in_formula("=Region+Table1[Col]", "Region", "Sales"),
        "=Sales+Table1[Col]"
    );
}

#[test]
fn t2_replace_name_handles_combined_corruption_cases() {
    let src = "=IF(Region!A1=\"Region\", Region, 0)";
    let out = replace_name_in_formula(src, "Region", "Sales");
    assert_eq!(out, "=IF(Region!A1=\"Region\", Sales, 0)");
}

#[test]
fn t2_contains_name_ref_skips_string_literal() {
    assert!(!formula_contains_name_ref(
        "=IF(A1=\"Region\", 1, 2)",
        "Region"
    ));
}

#[test]
fn t2_contains_name_ref_skips_sheet_prefix() {
    assert!(!formula_contains_name_ref("=Region!A1", "Region"));
}

#[test]
fn t2_replace_name_no_change_when_only_in_disqualified_positions() {
    assert_eq!(
        replace_name_in_formula("=\"Region\"+Sheet1!A1", "Region", "Sales"),
        "=\"Region\"+Sheet1!A1"
    );
    assert_eq!(
        replace_name_in_formula("=Region!A1+Region!B2", "Region", "Sales"),
        "=Region!A1+Region!B2"
    );
}

#[test]
fn t2_replace_name_inside_string_with_doubled_quote() {
    assert_eq!(
        replace_name_in_formula("=\"a\"\"Region\"\"b\"+Region", "Region", "Sales"),
        "=\"a\"\"Region\"\"b\"+Sales"
    );
}

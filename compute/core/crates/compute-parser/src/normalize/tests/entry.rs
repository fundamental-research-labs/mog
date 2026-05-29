use super::super::entry::{
    auto_close_parentheses, auto_quote_sheet_names, strip_unnecessary_sheet_quotes,
    uppercase_cell_references,
};
use super::super::normalize_formula_input;

// ─── auto_quote_sheet_names tests ───────────────────────────────────────

#[test]
fn test_auto_quote_ampersand() {
    let names = &["D&A_BUILD"];
    assert_eq!(
        auto_quote_sheet_names("=D&A_BUILD!E1", &names[..]),
        "='D&A_BUILD'!E1"
    );
}

#[test]
fn test_auto_quote_space() {
    let names = &["Revenue Summary"];
    assert_eq!(
        auto_quote_sheet_names("=Revenue Summary!A1", &names[..]),
        "='Revenue Summary'!A1"
    );
}

#[test]
fn test_auto_quote_dash() {
    let names = &["Q1-2026"];
    assert_eq!(
        auto_quote_sheet_names("=Q1-2026!B2", &names[..]),
        "='Q1-2026'!B2"
    );
}

#[test]
fn test_auto_quote_already_quoted() {
    let names = &["D&A_BUILD"];
    assert_eq!(
        auto_quote_sheet_names("='D&A_BUILD'!E1", &names[..]),
        "='D&A_BUILD'!E1"
    );
}

#[test]
fn test_auto_quote_no_special_chars() {
    let names = &["Sheet1"];
    // Sheet1 doesn't need quoting — should be unchanged
    assert_eq!(
        auto_quote_sheet_names("=Sheet1!A1", &names[..]),
        "=Sheet1!A1"
    );
}

#[test]
fn test_auto_quote_multiple_refs() {
    let names = &["D&A_BUILD"];
    assert_eq!(
        auto_quote_sheet_names("=D&A_BUILD!E1+D&A_BUILD!F1", &names[..]),
        "='D&A_BUILD'!E1+'D&A_BUILD'!F1"
    );
}

#[test]
fn test_auto_quote_mixed() {
    let names = &["D&A_BUILD", "Sheet1"];
    assert_eq!(
        auto_quote_sheet_names("=D&A_BUILD!E1+Sheet1!A1", &names[..]),
        "='D&A_BUILD'!E1+Sheet1!A1"
    );
}

#[test]
fn test_auto_quote_inside_string() {
    let names = &["D&A_BUILD"];
    // Name inside double-quoted string should NOT be quoted
    assert_eq!(
        auto_quote_sheet_names(r#"=IF(A1,"D&A_BUILD!E1",0)"#, &names[..]),
        r#"=IF(A1,"D&A_BUILD!E1",0)"#
    );
}

#[test]
fn test_auto_quote_longest_first() {
    let names = &["D&A", "D&A_BUILD"];
    // D&A_BUILD should match, not D&A
    assert_eq!(
        auto_quote_sheet_names("=D&A_BUILD!E1", &names[..]),
        "='D&A_BUILD'!E1"
    );
}

#[test]
fn test_auto_quote_single_quote_in_name() {
    let names = &["Dept's"];
    assert_eq!(
        auto_quote_sheet_names("=Dept's!A1", &names[..]),
        "='Dept''s'!A1"
    );
}

#[test]
fn test_auto_quote_not_formula() {
    let names = &["D&A_BUILD"];
    assert_eq!(auto_quote_sheet_names("hello", &names[..]), "hello");
}

#[test]
fn test_auto_quote_dot_in_name() {
    let names = &["v2.0"];
    assert_eq!(auto_quote_sheet_names("=v2.0!A1", &names[..]), "='v2.0'!A1");
}

#[test]
fn test_auto_quote_case_insensitive() {
    // Matches case-insensitively but preserves the user's original casing
    let names = &["D&A_BUILD"];
    assert_eq!(
        auto_quote_sheet_names("=d&a_build!E1", &names[..]),
        "='d&a_build'!E1"
    );
}

// ─── auto_close_parentheses tests ───────────────────────────────────────

#[test]
fn test_close_one_missing() {
    assert_eq!(auto_close_parentheses("=SUM(A1:A10"), "=SUM(A1:A10)");
}

#[test]
fn test_close_two_missing() {
    assert_eq!(
        auto_close_parentheses("=IF(A1>0,SUM(A1"),
        "=IF(A1>0,SUM(A1))"
    );
}

#[test]
fn test_close_none_missing() {
    assert_eq!(auto_close_parentheses("=SUM(A1)"), "=SUM(A1)");
}

#[test]
fn test_close_extra_closing() {
    // Depth goes negative — no fix
    assert_eq!(auto_close_parentheses("=SUM(A1))"), "=SUM(A1))");
}

#[test]
fn test_close_parens_in_string() {
    assert_eq!(
        auto_close_parentheses(r#"=IF(A1,"(",B1)"#),
        r#"=IF(A1,"(",B1)"#
    );
}

#[test]
fn test_close_parens_in_sheet_name() {
    assert_eq!(auto_close_parentheses("='Sheet (1)'!A1"), "='Sheet (1)'!A1");
}

#[test]
fn test_close_not_formula() {
    assert_eq!(auto_close_parentheses("hello("), "hello(");
}

#[test]
fn test_close_balanced_complex() {
    assert_eq!(
        auto_close_parentheses("=IF(SUM(A1:A10)>0,1,0)"),
        "=IF(SUM(A1:A10)>0,1,0)"
    );
}

// ─── strip_unnecessary_sheet_quotes tests ───────────────────────────────

#[test]
fn test_strip_simple_name() {
    assert_eq!(strip_unnecessary_sheet_quotes("='Sheet1'!A1"), "=Sheet1!A1");
}

#[test]
fn test_strip_keeps_required() {
    assert_eq!(strip_unnecessary_sheet_quotes("='D&A'!A1"), "='D&A'!A1");
}

#[test]
fn test_strip_keeps_reference_like_sheet_names() {
    assert_eq!(strip_unnecessary_sheet_quotes("='RC'!S7"), "='RC'!S7");
    assert_eq!(strip_unnecessary_sheet_quotes("='A1'!B2"), "='A1'!B2");
    assert_eq!(strip_unnecessary_sheet_quotes("='R1C1'!A1"), "='R1C1'!A1");
}

#[test]
fn test_strip_mixed() {
    assert_eq!(
        strip_unnecessary_sheet_quotes("='Sheet1'!A1+'D&A'!B1"),
        "=Sheet1!A1+'D&A'!B1"
    );
}

#[test]
fn test_strip_already_unquoted() {
    assert_eq!(strip_unnecessary_sheet_quotes("=Sheet1!A1"), "=Sheet1!A1");
}

#[test]
fn test_strip_name_with_underscore() {
    assert_eq!(
        strip_unnecessary_sheet_quotes("='Data_2024'!A1"),
        "=Data_2024!A1"
    );
}

#[test]
fn test_strip_name_starting_digit() {
    // Digit-starting names need quoting
    assert_eq!(
        strip_unnecessary_sheet_quotes("='2024Data'!A1"),
        "='2024Data'!A1"
    );
}

// ─── uppercase_cell_references tests ────────────────────────────────────

#[test]
fn test_upper_simple() {
    assert_eq!(uppercase_cell_references("=a1+b2"), "=A1+B2");
}

#[test]
fn test_upper_range() {
    assert_eq!(uppercase_cell_references("=sum(a1:b10)"), "=sum(A1:B10)");
}

#[test]
fn test_upper_in_string() {
    assert_eq!(uppercase_cell_references(r#"="a1""#), r#"="a1""#);
}

#[test]
fn test_upper_already_upper() {
    assert_eq!(uppercase_cell_references("=A1"), "=A1");
}

#[test]
fn test_upper_mixed() {
    assert_eq!(uppercase_cell_references("=a1+B2+c3"), "=A1+B2+C3");
}

#[test]
fn test_upper_sheet_qualified() {
    assert_eq!(uppercase_cell_references("=Sheet1!a1"), "=Sheet1!A1");
}

#[test]
fn test_upper_absolute() {
    assert_eq!(uppercase_cell_references("=$a$1"), "=$A$1");
}

// ─── normalize_formula_input pipeline tests ─────────────────────────────

#[test]
fn test_pipeline_combined() {
    let names = &["D&A_BUILD"];
    assert_eq!(
        normalize_formula_input("=D&A_BUILD!a1+SUM(b1:b10", &names[..]),
        "='D&A_BUILD'!A1+SUM(B1:B10)"
    );
}

#[test]
fn test_pipeline_no_op() {
    let names = &["Sheet1"];
    assert_eq!(
        normalize_formula_input("=SUM(A1:A10)", &names[..]),
        "=SUM(A1:A10)"
    );
}

#[test]
fn test_pipeline_not_formula() {
    let names = &["Sheet1"];
    assert_eq!(normalize_formula_input("hello", &names[..]), "hello");
}

#[test]
fn test_pipeline_empty_names() {
    let names: &[&str] = &[];
    assert_eq!(
        normalize_formula_input("=SUM(a1:a10", names),
        "=SUM(A1:A10)"
    );
}

#[test]
fn test_pipeline_strip_then_uppercase() {
    // Unnecessary quotes stripped, then cell ref uppercased
    let names: &[&str] = &[];
    assert_eq!(normalize_formula_input("='Sheet1'!a1", names), "=Sheet1!A1");
}

#[test]
fn test_upper_absolute_range() {
    assert_eq!(uppercase_cell_references("=$a$1:$b$2"), "=$A$1:$B$2");
}

use super::test_fixtures::make_test_table;
use super::*;

// ---- Table Name Validation ----

#[test]
fn validate_table_name_valid() {
    assert!(validate_table_name("MyTable").is_ok());
    assert!(validate_table_name("_private").is_ok());
    assert!(validate_table_name("Table1").is_ok());
    assert!(validate_table_name("a").is_ok());
}

#[test]
fn validate_table_name_empty() {
    assert!(validate_table_name("").is_err());
    assert!(validate_table_name("   ").is_err());
}

#[test]
fn validate_table_name_starts_with_digit() {
    assert!(validate_table_name("1Table").is_err());
}

#[test]
fn validate_table_name_contains_space() {
    assert!(validate_table_name("My Table").is_err());
}

#[test]
fn validate_table_name_special_chars() {
    assert!(validate_table_name("My-Table").is_err());
    assert!(validate_table_name("My.Table").is_err());
}

#[test]
fn validate_table_name_cell_reference() {
    assert!(validate_table_name("A1").is_err());
    assert!(validate_table_name("XFD1048576").is_err());
    assert!(validate_table_name("BB99").is_err());
    assert!(validate_table_name("a1").is_err());
}

#[test]
fn validate_table_name_not_cell_reference() {
    // Column beyond XFD (16384) should be valid
    assert!(validate_table_name("XFE1").is_ok());
    // Row beyond 1048576 should be valid
    assert!(validate_table_name("A1048577").is_ok());
    // Too many letters to be a column
    assert!(validate_table_name("ABCD1").is_ok());
}

// ---- generate_table_name ----

#[test]
fn generate_table_name_empty() {
    let name = generate_table_name(&[]);
    assert_eq!(name, "Table1");
}

#[test]
fn generate_table_name_skips_existing() {
    let name = generate_table_name(&["Table1", "Table2"]);
    assert_eq!(name, "Table3");
}

#[test]
fn generate_table_name_case_insensitive() {
    let name = generate_table_name(&["table1", "TABLE2"]);
    assert_eq!(name, "Table3");
}

#[test]
fn generate_table_name_fills_gap() {
    let name = generate_table_name(&["Table1", "Table3"]);
    assert_eq!(name, "Table2");
}

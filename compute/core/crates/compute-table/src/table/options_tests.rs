use super::super::types::TableBoolOption;
use super::test_fixtures::make_test_table;
use super::*;

// ---- Table Options ----

#[test]
fn set_table_option_banded_rows() {
    let t = make_test_table();
    assert!(t.banded_rows);
    let t2 = set_table_option(&t, TableBoolOption::BandedRows, false);
    assert!(!t2.banded_rows);
}

#[test]
fn set_table_option_emphasize_first_column() {
    let t = make_test_table();
    assert!(!t.emphasize_first_column);
    let t2 = set_table_option(&t, TableBoolOption::EmphasizeFirstColumn, true);
    assert!(t2.emphasize_first_column);
}

#[test]
fn set_table_style_changes_style() {
    let t = make_test_table();
    let t2 = set_table_style(&t, "TableStyleLight1");
    assert_eq!(t2.style, "TableStyleLight1");
}

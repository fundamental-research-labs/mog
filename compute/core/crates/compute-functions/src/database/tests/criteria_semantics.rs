use value_types::CellValue;

use crate::PureFunction;

use super::super::functions::FnDsum;
use super::helpers::{num, sample_db, text};

#[test]
fn test_or_criteria() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(25.0)], vec![num(35.0)]]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(110000.0));
}

#[test]
fn test_and_criteria() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![
        vec![text("Age"), text("Name")],
        vec![num(30.0), text("Alice")],
    ]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(50000.0));
}

#[test]
fn test_dsum_wildcard_star() {
    let f = FnDsum;
    let db = CellValue::from_rows(vec![
        vec![text("Name"), text("Score")],
        vec![text("Alice"), num(10.0)],
        vec![text("Anna"), num(20.0)],
        vec![text("Bob"), num(30.0)],
    ]);
    let crit = CellValue::from_rows(vec![vec![text("Name")], vec![text("A*")]]);
    let result = f.call(&[db, text("Score"), crit]);
    assert_eq!(result, num(30.0));
}

#[test]
fn test_blank_null_criteria_matches_all_rows_for_column() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![CellValue::Null]]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(220000.0));
}

#[test]
fn test_blank_empty_text_criteria_matches_all_rows_for_column() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![text("")]]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(220000.0));
}

#[test]
fn test_whitespace_only_criteria_matches_all_rows_for_column() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![text("   ")]]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(220000.0));
}

#[test]
fn test_missing_criteria_field_is_skipped() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![
        vec![text("Unknown"), text("Age")],
        vec![text("reject"), num(30.0)],
    ]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(110000.0));
}

#[test]
fn test_row_with_only_unknown_criteria_fields_matches_all_rows() {
    let f = FnDsum;
    let crit = CellValue::from_rows(vec![vec![text("Unknown")], vec![text("reject")]]);
    let result = f.call(&[sample_db(), text("Salary"), crit]);
    assert_eq!(result, num(220000.0));
}

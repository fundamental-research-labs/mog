use value_types::CellValue;

use crate::PureFunction;

use super::super::functions::{FnDcount, FnDcounta};
use super::helpers::{criteria_age_30, num, sample_db, text};

#[test]
fn test_dcount() {
    let f = FnDcount;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(2.0));
}

#[test]
fn test_dcounta() {
    let f = FnDcounta;
    let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
    assert_eq!(result, num(2.0));
}

#[test]
fn test_dcount_counts_numbers_and_dcounta_counts_non_null_values() {
    let db = CellValue::from_rows(vec![
        vec![text("Name"), text("Value")],
        vec![text("Number"), num(10.0)],
        vec![text("Text"), text("ten")],
        vec![text("Blank"), CellValue::Null],
    ]);
    let criteria = CellValue::from_rows(vec![vec![text("Name")]]);

    assert_eq!(
        FnDcount.call(&[db.clone(), text("Value"), criteria.clone()]),
        num(1.0)
    );
    assert_eq!(FnDcounta.call(&[db, text("Value"), criteria]), num(2.0));
}

#[test]
fn test_dcount_wildcard_question_mark() {
    let f = FnDcount;
    let db = CellValue::from_rows(vec![
        vec![text("Name"), text("Score")],
        vec![text("Bob"), num(10.0)],
        vec![text("Rob"), num(20.0)],
        vec![text("Alice"), num(30.0)],
    ]);
    let crit = CellValue::from_rows(vec![vec![text("Name")], vec![text("?ob")]]);
    let result = f.call(&[db, text("Score"), crit]);
    assert_eq!(result, num(2.0));
}

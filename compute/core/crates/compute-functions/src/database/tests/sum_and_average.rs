use value_types::{CellError, CellValue};

use crate::PureFunction;

use super::super::functions::{FnDaverage, FnDsum};
use super::helpers::{
    criteria_age_30, criteria_age_gt_25, criteria_all, err, num, sample_db, text,
};

#[test]
fn test_dsum_basic() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(110000.0));
}

#[test]
fn test_dsum_field_by_number() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), num(3.0), criteria_age_30()]);
    assert_eq!(result, num(110000.0));
}

#[test]
fn test_dsum_field_by_non_integer_number_truncates() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), num(3.9), criteria_age_30()]);
    assert_eq!(result, num(110000.0));
}

#[test]
fn test_dsum_gt_criteria() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_gt_25()]);
    assert_eq!(result, num(180000.0));
}

#[test]
fn test_daverage() {
    let f = FnDaverage;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(55000.0));
}

#[test]
fn test_daverage_requires_numeric_matching_values() {
    let db = CellValue::from_rows(vec![
        vec![text("Name"), text("Group")],
        vec![text("Alice"), text("A")],
    ]);
    let crit = CellValue::from_rows(vec![vec![text("Group")], vec![text("A")]]);
    let result = FnDaverage.call(&[db, text("Name"), crit]);
    assert_eq!(result, err(CellError::Div0));
}

#[test]
fn test_dsum_all_rows() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), text("Salary"), criteria_all()]);
    assert_eq!(result, num(220000.0));
}

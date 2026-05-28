use value_types::{CellError, CellValue};

use super::super::collect::{extract_matching_numbers, get_matching_values};
use super::super::functions::FnDsum;
use super::super::model::{Criteria, Database};
use super::helpers::{criteria_age_30, err, num, sample_db, text};
use crate::PureFunction;

#[test]
fn test_invalid_field() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), text("Nonexistent"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_error_propagation() {
    let f = FnDsum;
    let result = f.call(&[err(CellError::Ref), text("Salary"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Ref));
}

#[test]
fn test_header_only_database() {
    let f = FnDsum;
    let db = CellValue::from_rows(vec![vec![text("Name"), text("Score")]]);
    let crit = CellValue::from_rows(vec![vec![text("Name")], vec![text("Alice")]]);
    let result = f.call(&[db, text("Score"), crit]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_empty_database_range_is_invalid() {
    let f = FnDsum;
    let db = CellValue::from_rows(Vec::<Vec<CellValue>>::new());
    let result = f.call(&[db, text("Score"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_all_empty_header_database_range_is_invalid() {
    let f = FnDsum;
    let db = CellValue::from_rows(vec![
        vec![CellValue::Null, text("")],
        vec![num(1.0), num(2.0)],
    ]);
    let result = f.call(&[db, text("Score"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_invalid_criteria_range_is_invalid() {
    let f = FnDsum;
    let result = f.call(&[sample_db(), text("Salary"), text("not a range")]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_empty_criteria_range_is_invalid() {
    let f = FnDsum;
    let criteria = CellValue::from_rows(Vec::<Vec<CellValue>>::new());
    let result = f.call(&[sample_db(), text("Salary"), criteria]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_header_only_criteria_matches_all_rows() {
    let f = FnDsum;
    let criteria = CellValue::from_rows(vec![vec![text("Name")]]);
    let result = f.call(&[sample_db(), text("Salary"), criteria]);
    assert_eq!(result, num(220000.0));
}

#[test]
fn test_short_matching_row_contributes_null() {
    let db = Database {
        headers: vec!["name".into(), "age".into(), "score".into()],
        data: vec![
            vec![text("Alice"), num(30.0), num(10.0)],
            vec![text("Bob"), num(30.0)],
        ],
    };
    let criteria = Criteria {
        fields: vec!["age".into()],
        conditions: vec![vec![num(30.0)]],
    };

    let values = get_matching_values(&db, 2, &criteria);
    let counta = values
        .iter()
        .filter(|v| !matches!(v, CellValue::Null))
        .count();
    assert_eq!(values, vec![num(10.0), CellValue::Null]);
    assert_eq!(extract_matching_numbers(&values), vec![10.0]);
    assert_eq!(counta, 1);
}

#[test]
fn test_short_matching_row_can_be_returned_as_null_by_dget() {
    let db = Database {
        headers: vec!["name".into(), "age".into(), "score".into()],
        data: vec![vec![text("Bob"), num(30.0)]],
    };
    let criteria = Criteria {
        fields: vec!["age".into()],
        conditions: vec![vec![num(30.0)]],
    };

    assert_eq!(
        get_matching_values(&db, 2, &criteria),
        vec![CellValue::Null]
    );
}

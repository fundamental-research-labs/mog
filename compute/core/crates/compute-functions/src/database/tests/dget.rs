use value_types::{CellError, CellValue};

use crate::PureFunction;

use super::super::functions::FnDget;
use super::helpers::{criteria_age_30, err, num, sample_db, text};

#[test]
fn test_dget_single_match() {
    let f = FnDget;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(25.0)]]);
    let result = f.call(&[sample_db(), text("Name"), crit]);
    assert_eq!(result, text("Bob"));
}

#[test]
fn test_dget_multiple_matches() {
    let f = FnDget;
    let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_dget_no_match() {
    let f = FnDget;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(99.0)]]);
    let result = f.call(&[sample_db(), text("Name"), crit]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_dget_multiple_matches_returns_num_error() {
    let f = FnDget;
    let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_dget_zero_matches_returns_value_error() {
    let f = FnDget;
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(999.0)]]);
    let result = f.call(&[sample_db(), text("Name"), crit]);
    assert_eq!(result, err(CellError::Value));
}

#[test]
fn test_dget_two_plus_matches_returns_num_error() {
    let f = FnDget;
    let result = f.call(&[sample_db(), text("Name"), criteria_age_30()]);
    assert_eq!(result, err(CellError::Num));
}

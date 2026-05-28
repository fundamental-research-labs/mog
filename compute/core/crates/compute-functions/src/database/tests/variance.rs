use value_types::{CellError, CellValue};

use crate::PureFunction;

use super::super::functions::{FnDstdev, FnDstdevp, FnDvar, FnDvarp};
use super::helpers::{criteria_age_30, criteria_age_gt_25, err, num, sample_db, text};

#[test]
fn test_dstdev() {
    let f = FnDstdev;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_gt_25()]);
    assert_eq!(result, num(10000.0));
}

#[test]
fn test_dstdevp() {
    let f = FnDstdevp;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(5000.0));
}

#[test]
fn test_dvar() {
    let f = FnDvar;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_gt_25()]);
    assert_eq!(result, num(100000000.0));
}

#[test]
fn test_dvarp() {
    let f = FnDvarp;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(25000000.0));
}

#[test]
fn test_sample_variance_functions_require_two_numeric_values() {
    let crit = CellValue::from_rows(vec![vec![text("Age")], vec![num(25.0)]]);
    assert_eq!(
        FnDstdev.call(&[sample_db(), text("Salary"), crit.clone()]),
        err(CellError::Div0)
    );
    assert_eq!(
        FnDvar.call(&[sample_db(), text("Salary"), crit]),
        err(CellError::Div0)
    );
}

#[test]
fn test_population_variance_functions_require_one_numeric_value() {
    let db = CellValue::from_rows(vec![
        vec![text("Name"), text("Group")],
        vec![text("Alice"), text("A")],
    ]);
    let crit = CellValue::from_rows(vec![vec![text("Group")], vec![text("A")]]);

    assert_eq!(
        FnDstdevp.call(&[db.clone(), text("Name"), crit.clone()]),
        err(CellError::Div0)
    );
    assert_eq!(
        FnDvarp.call(&[db, text("Name"), crit]),
        err(CellError::Div0)
    );
}

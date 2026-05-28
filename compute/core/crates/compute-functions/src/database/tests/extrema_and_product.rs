use value_types::CellValue;

use crate::PureFunction;

use super::super::functions::{FnDmax, FnDmin, FnDproduct};
use super::helpers::{criteria_age_30, num, sample_db, text};

#[test]
fn test_dmax() {
    let f = FnDmax;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(60000.0));
}

#[test]
fn test_dmin() {
    let f = FnDmin;
    let result = f.call(&[sample_db(), text("Salary"), criteria_age_30()]);
    assert_eq!(result, num(50000.0));
}

#[test]
fn test_dproduct() {
    let f = FnDproduct;
    let result = f.call(&[sample_db(), text("Age"), criteria_age_30()]);
    assert_eq!(result, num(900.0));
}

#[test]
fn test_extrema_and_product_return_zero_with_no_numeric_values() {
    let db = CellValue::from_rows(vec![
        vec![text("Name"), text("Group")],
        vec![text("Alice"), text("A")],
        vec![text("Bob"), text("A")],
    ]);
    let crit = CellValue::from_rows(vec![vec![text("Group")], vec![text("A")]]);

    assert_eq!(
        FnDmax.call(&[db.clone(), text("Name"), crit.clone()]),
        num(0.0)
    );
    assert_eq!(
        FnDmin.call(&[db.clone(), text("Name"), crit.clone()]),
        num(0.0)
    );
    assert_eq!(FnDproduct.call(&[db, text("Name"), crit]), num(0.0));
}

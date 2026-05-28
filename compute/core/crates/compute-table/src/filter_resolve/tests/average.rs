use super::helpers::{as_condition, cv_null, cv_num, cv_text};
use crate::filter_resolve::{resolve_dynamic_filter, test_resolve_average_filter};
use crate::types::{DynamicFilter, DynamicFilterRule, FilterOperator};
use chrono::{NaiveDate, Weekday};
use value_types::CellValue;

#[test]
fn test_above_average_bug_fix_includes_equal() {
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let result = test_resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
    assert_eq!(result.conditions.len(), 1);
    assert_eq!(
        result.conditions[0].operator,
        FilterOperator::GreaterThanOrEqual
    );
    if let CellValue::Number(v) = &result.conditions[0].value {
        assert!((v.get() - 20.0).abs() < 1e-10);
    } else {
        panic!("Expected Number");
    }
}

#[test]
fn test_below_average_bug_fix_includes_equal() {
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let result = test_resolve_average_filter(&data, FilterOperator::LessThanOrEqual);
    assert_eq!(result.conditions.len(), 1);
    assert_eq!(
        result.conditions[0].operator,
        FilterOperator::LessThanOrEqual
    );
    if let CellValue::Number(v) = &result.conditions[0].value {
        assert!((v.get() - 20.0).abs() < 1e-10);
    } else {
        panic!("Expected Number");
    }
}

#[test]
fn test_above_average_bug_fix_via_resolve() {
    let filter = DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let resolved = resolve_dynamic_filter(
        &filter,
        &data,
        Some(NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()),
        Weekday::Sun,
    );
    let cf = as_condition(&resolved);
    assert_eq!(
        cf.conditions[0].operator,
        FilterOperator::GreaterThanOrEqual
    );
    if let CellValue::Number(v) = &cf.conditions[0].value {
        assert!((v.get() - 20.0).abs() < 1e-10);
    }
}

#[test]
fn test_below_average_bug_fix_via_resolve() {
    let filter = DynamicFilter {
        rule: DynamicFilterRule::BelowAverage,
    };
    let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
    let resolved = resolve_dynamic_filter(
        &filter,
        &data,
        Some(NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()),
        Weekday::Sun,
    );
    let cf = as_condition(&resolved);
    assert_eq!(cf.conditions[0].operator, FilterOperator::LessThanOrEqual);
    if let CellValue::Number(v) = &cf.conditions[0].value {
        assert!((v.get() - 20.0).abs() < 1e-10);
    }
}

#[test]
fn test_above_average_mixed_types() {
    let data = vec![cv_num(10.0), cv_text("text"), cv_num(30.0), cv_null()];
    let result = test_resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
    if let CellValue::Number(v) = &result.conditions[0].value {
        assert!((v.get() - 20.0).abs() < 1e-10);
    }
}

#[test]
fn test_above_average_no_numeric_data() {
    let data = vec![cv_text("a"), cv_null(), cv_text("b")];
    let result = test_resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
    assert_eq!(
        result.conditions[0].operator,
        FilterOperator::GreaterThanOrEqual
    );
    assert!(matches!(
        &result.conditions[0].value,
        CellValue::Error(value_types::CellError::Num, None)
    ));
}

#[test]
fn test_below_average_no_numeric_data() {
    let data = vec![cv_text("a"), cv_null(), cv_text("b")];
    let result = test_resolve_average_filter(&data, FilterOperator::LessThanOrEqual);
    assert_eq!(
        result.conditions[0].operator,
        FilterOperator::LessThanOrEqual
    );
    assert!(matches!(
        &result.conditions[0].value,
        CellValue::Error(value_types::CellError::Num, None)
    ));
}

#[test]
fn test_above_average_ignores_infinity() {
    let data = vec![
        cv_num(10.0),
        CellValue::number(f64::INFINITY),
        cv_num(20.0),
        CellValue::number(f64::NEG_INFINITY),
        cv_num(30.0),
    ];
    let result = test_resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
    if let CellValue::Number(v) = &result.conditions[0].value {
        assert!((v.get() - 20.0).abs() < 1e-10);
    }
}

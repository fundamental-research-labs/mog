use value_types::{CellError, CellValue};

use super::fixtures::{assert_null, assert_num};
use crate::aggregate::{aggregate, get_aggregate_functions};
use crate::types::AggregateFunction;
use crate::values::cell_value_is_numeric;

#[test]
fn test_cell_value_is_numeric_via_canonical() {
    assert!(cell_value_is_numeric(&CellValue::number(123.0)));
    assert!(cell_value_is_numeric(&CellValue::number(0.0)));
    assert!(cell_value_is_numeric(&CellValue::number(-5.5)));
    assert!(!cell_value_is_numeric(&CellValue::number(f64::NAN)));
    assert!(!cell_value_is_numeric(&CellValue::Text("123".into())));
    assert!(!cell_value_is_numeric(&CellValue::Null));
}

#[test]
fn test_is_visually_blank_via_canonical() {
    assert!(!CellValue::number(123.0).is_visually_blank());
    assert!(!CellValue::Text("text".into()).is_visually_blank());
    assert!(!CellValue::Boolean(false).is_visually_blank());
    assert!(!CellValue::Error(CellError::Div0, None).is_visually_blank());
    assert!(CellValue::Null.is_visually_blank());
    assert!(CellValue::Text("".into()).is_visually_blank());
    assert!(CellValue::Text("   ".into()).is_visually_blank());
}

#[test]
fn test_all_aggregates_on_empty() {
    for func in get_aggregate_functions() {
        assert_null(aggregate(*func, &[]));
    }
}

#[test]
fn test_all_aggregates_on_all_blanks() {
    let vals = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::Text("   ".into()),
    ];
    for func in get_aggregate_functions() {
        assert_null(aggregate(*func, &vals));
    }
}

#[test]
fn test_all_aggregates_on_single_value() {
    let vals = vec![CellValue::number(7.0)];
    assert_num(aggregate(AggregateFunction::Sum, &vals), 7.0);
    assert_num(aggregate(AggregateFunction::Count, &vals), 1.0);
    assert_num(aggregate(AggregateFunction::CountA, &vals), 1.0);
    assert_num(aggregate(AggregateFunction::CountUnique, &vals), 1.0);
    assert_num(aggregate(AggregateFunction::Average, &vals), 7.0);
    assert_num(aggregate(AggregateFunction::Min, &vals), 7.0);
    assert_num(aggregate(AggregateFunction::Max, &vals), 7.0);
    assert_num(aggregate(AggregateFunction::Product, &vals), 7.0);
    assert_null(aggregate(AggregateFunction::StdDev, &vals));
    assert_num(aggregate(AggregateFunction::StdDevP, &vals), 0.0);
    assert_null(aggregate(AggregateFunction::Var, &vals));
    assert_num(aggregate(AggregateFunction::VarP, &vals), 0.0);
}

#[test]
fn test_all_aggregates_on_mixed_types() {
    let vals = vec![
        CellValue::number(10.0),
        CellValue::Text("hello".into()),
        CellValue::Boolean(true),
        CellValue::Error(CellError::Na, None),
        CellValue::Null,
        CellValue::number(20.0),
    ];
    assert_num(aggregate(AggregateFunction::Sum, &vals), 30.0);
    assert_num(aggregate(AggregateFunction::Count, &vals), 2.0);
    assert_num(aggregate(AggregateFunction::Average, &vals), 15.0);
    assert_num(aggregate(AggregateFunction::Min, &vals), 10.0);
    assert_num(aggregate(AggregateFunction::Max, &vals), 20.0);
    assert_num(aggregate(AggregateFunction::Product, &vals), 200.0);
    assert_num(aggregate(AggregateFunction::CountA, &vals), 5.0);
    assert_num(aggregate(AggregateFunction::CountUnique, &vals), 5.0);
}

use value_types::CellValue;

use super::fixtures::{assert_close, assert_num, numbers};
use crate::aggregate::{aggregate, get_aggregate_functions};
use crate::types::AggregateFunction;

#[test]
fn test_aggregate_dispatches_correctly() {
    let nums = numbers();

    assert_num(aggregate(AggregateFunction::Sum, &nums), 15.0);
    assert_num(aggregate(AggregateFunction::Count, &nums), 5.0);
    assert_num(aggregate(AggregateFunction::Average, &nums), 3.0);
    assert_num(aggregate(AggregateFunction::Min, &nums), 1.0);
    assert_num(aggregate(AggregateFunction::Max, &nums), 5.0);
    assert_num(aggregate(AggregateFunction::Product, &nums), 120.0);
    assert_num(aggregate(AggregateFunction::CountA, &nums), 5.0);
    assert_num(aggregate(AggregateFunction::CountUnique, &nums), 5.0);
    assert_close(aggregate(AggregateFunction::Var, &nums), 2.5, 1e-10);
    assert_close(aggregate(AggregateFunction::VarP, &nums), 2.0, 1e-10);
    assert_close(
        aggregate(AggregateFunction::StdDev, &nums),
        (2.5_f64).sqrt(),
        1e-10,
    );
    assert_close(
        aggregate(AggregateFunction::StdDevP, &nums),
        (2.0_f64).sqrt(),
        1e-10,
    );
}

#[test]
fn test_get_aggregate_functions_returns_all_12() {
    let fns = get_aggregate_functions();
    assert_eq!(
        fns,
        &[
            AggregateFunction::Sum,
            AggregateFunction::Count,
            AggregateFunction::CountA,
            AggregateFunction::CountUnique,
            AggregateFunction::Average,
            AggregateFunction::Min,
            AggregateFunction::Max,
            AggregateFunction::Product,
            AggregateFunction::StdDev,
            AggregateFunction::StdDevP,
            AggregateFunction::Var,
            AggregateFunction::VarP,
        ]
    );
}

#[test]
fn test_all_aggregates_empty_via_dispatch() {
    for func in get_aggregate_functions() {
        let result = aggregate(*func, &[]);
        assert!(
            matches!(result, CellValue::Null),
            "{:?} on empty input should return Null, got {:?}",
            func,
            result
        );
    }
}

#[test]
fn test_all_aggregates_all_blank_via_dispatch() {
    let blanks = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::Text("  ".into()),
    ];
    for func in get_aggregate_functions() {
        let result = aggregate(*func, &blanks);
        assert!(
            matches!(result, CellValue::Null),
            "{:?} on all-blank input should return Null, got {:?}",
            func,
            result
        );
    }
}

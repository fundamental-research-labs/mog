use super::fixtures::*;
use super::*;

#[test]
fn test_empty_column_data() {
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let bitmap = eval(&criteria, &[]);
    assert!(bitmap.is_empty());
}

#[test]
fn test_all_same_value() {
    let criteria = make_value_filter(vec![cv_num(42.0)], false);
    let data = vec![cv_num(42.0), cv_num(42.0), cv_num(42.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_single_row_match() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(10.0)];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_single_row_no_match() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(50.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(10.0)];
    assert_eq!(eval(&criteria, &data), vec![0]);
}

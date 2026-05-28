use super::super::fixtures::*;
use super::super::*;

#[test]
fn test_not_between_string_vs_number() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![cv_text("hello")];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_not_between_bool_vs_number() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![cv_bool(true)];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_not_between_blanks_return_true() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![cv_null(), cv_num(7.0), cv_num(3.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1]);
}

use super::super::fixtures::*;
use super::super::*;

#[test]
fn test_nan_not_match_greater_than() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![0]);
}

#[test]
fn test_nan_not_match_greater_than_or_equal() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThanOrEqual, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![0]);
}

#[test]
fn test_nan_equals_nan_as_error() {
    // cv_nan() → Error(Num). Errors of same type are equal in filter context.
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Equals, cv_nan())],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_nan_matches_not_equals() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotEquals, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_nan_matches_is_not_blank() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::IsNotBlank, cv_null())],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_error_not_contains_matching() {
    // cv_nan() → Error(Num). "#NUM!" does not contain "Na".
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotContains, cv_text("Na"))],
        FilterLogic::And,
    );
    let data = vec![cv_nan(), cv_text("hello"), cv_num(42.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_nan_not_contains_non_matching() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotContains, cv_text("hello"))],
        FilterLogic::And,
    );
    let data = vec![cv_nan(), cv_text("hello world"), cv_num(42.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1]);
}

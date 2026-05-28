use super::super::fixtures::*;
use super::super::*;

#[test]
fn test_condition_equals() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Equals, cv_num(42.0))],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(42.0),
        cv_num(43.0),
        cv_num(42.0),
        cv_null(),
        cv_num(0.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 0]);
}

#[test]
fn test_condition_not_equals() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotEquals, cv_num(42.0))],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(42.0),
        cv_num(43.0),
        cv_num(42.0),
        cv_null(),
        cv_num(0.0),
    ];
    // blanks return true for notEquals
    assert_eq!(eval(&criteria, &data), vec![0, 1, 0, 1, 1]);
}

#[test]
fn test_condition_greater_than() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(10.0),
        cv_null(),
        cv_num(100.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 1, 0, 1]);
}

#[test]
fn test_condition_greater_than_or_equal() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThanOrEqual, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(1.0), cv_num(5.0), cv_num(10.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 1, 0]);
}

#[test]
fn test_condition_less_than() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::LessThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(1.0), cv_num(5.0), cv_num(10.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0]);
}

#[test]
fn test_condition_less_than_or_equal() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::LessThanOrEqual, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(1.0), cv_num(5.0), cv_num(10.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0]);
}

#[test]
fn test_condition_begins_with() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::BeginsWith, cv_text("he"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("Hello"),
        cv_text("help"),
        cv_text("world"),
        cv_null(),
        cv_text("HE"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0, 1]);
}

#[test]
fn test_condition_ends_with() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::EndsWith, cv_text("LD"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("world"),
        cv_text("BOLD"),
        cv_text("hello"),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0]);
}

#[test]
fn test_condition_contains() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Contains, cv_text("or"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("world"),
        cv_text("more"),
        cv_text("hello"),
        cv_null(),
        cv_text("WORD"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0, 1]);
}

#[test]
fn test_condition_not_contains() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotContains, cv_text("or"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("world"),
        cv_text("more"),
        cv_text("hello"),
        cv_null(),
    ];
    // blanks return true for notContains
    assert_eq!(eval(&criteria, &data), vec![0, 0, 1, 1]);
}

#[test]
fn test_is_blank() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::IsBlank, cv_null())],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_null(),
        cv_text("text"),
        cv_null(),
        cv_bool(true),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 0, 1, 0]);
}

#[test]
fn test_is_not_blank() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::IsNotBlank, cv_null())],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_null(),
        cv_text("text"),
        cv_null(),
        cv_bool(true),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 1]);
}

#[test]
fn test_begins_with_on_numbers() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::BeginsWith, cv_text("1"))],
        FilterLogic::And,
    );
    let data = vec![cv_num(100.0), cv_num(200.0), cv_num(15.0), cv_num(1.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 1]);
}

#[test]
fn test_contains_on_numbers() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Contains, cv_text("2"))],
        FilterLogic::And,
    );
    let data = vec![cv_num(12.0), cv_num(23.0), cv_num(45.0), cv_num(200.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1]);
}

// Condition equals with string (case-insensitive via compare_values)

#[test]
fn test_condition_equals_string_case_insensitive() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Equals, cv_text("Hello"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("hello"),
        cv_text("HELLO"),
        cv_text("Hello"),
        cv_text("world"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 0]);
}

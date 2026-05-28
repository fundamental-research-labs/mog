use super::super::fixtures::*;
use super::super::*;

#[test]
fn test_condition_and_logic() {
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::GreaterThan, cv_num(5.0)),
            make_cond(FilterOperator::LessThan, cv_num(15.0)),
        ],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(10.0),
        cv_num(15.0),
        cv_num(20.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 1, 0, 0]);
}

#[test]
fn test_condition_or_logic() {
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::Equals, cv_num(1.0)),
            make_cond(FilterOperator::Equals, cv_num(5.0)),
        ],
        FilterLogic::Or,
    );
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(5.0), cv_num(10.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0]);
}

#[test]
fn test_condition_empty_conditions() {
    let criteria = make_condition_filter(vec![], FilterLogic::And);
    let data = vec![cv_num(1.0), cv_null(), cv_text("text")];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_is_blank_combined_or() {
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::IsBlank, cv_null()),
            make_cond(FilterOperator::Equals, cv_num(42.0)),
        ],
        FilterLogic::Or,
    );
    let data = vec![
        cv_num(42.0),
        cv_null(),
        cv_num(10.0),
        cv_null(),
        cv_num(42.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1, 1]);
}

#[test]
fn test_condition_or_mixed_types() {
    // OR mode with (greaterThan 5) OR (contains "text") on a mixed column.
    // greaterThan 5 only matches numbers > 5. contains "text" matches strings.
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::GreaterThan, cv_num(5.0)),
            make_cond(FilterOperator::Contains, cv_text("text")),
        ],
        FilterLogic::Or,
    );
    let data = vec![
        cv_num(10.0),         // > 5 -> true
        cv_num(3.0),          // not > 5, not a string -> false
        cv_text("some text"), // contains "text" -> true
        cv_text("hello"),     // does not contain "text" -> false
        cv_null(),            // blank: greaterThan -> false, contains -> false => false
        cv_num(6.0),          // > 5 -> true
        cv_text("TEXTBOOK"),  // contains "text" (case-insensitive) -> true
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 0, 1, 1]);
}

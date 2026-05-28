use super::fixtures::*;
use super::*;

#[test]
fn test_value_filter_include_specific() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(3.0), cv_num(5.0)], false);
    let data = vec![
        cv_num(1.0),
        cv_num(2.0),
        cv_num(3.0),
        cv_num(4.0),
        cv_num(5.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 1]);
}

#[test]
fn test_value_filter_exclude_blanks() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(2.0)], false);
    let data = vec![cv_num(1.0), cv_null(), cv_num(2.0), cv_null(), cv_num(3.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 0]);
}

#[test]
fn test_value_filter_include_blanks() {
    let criteria = make_value_filter(vec![cv_num(1.0)], true);
    let data = vec![cv_num(1.0), cv_null(), cv_num(2.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1]);
}

#[test]
fn test_value_filter_case_insensitive_strings() {
    let criteria = make_value_filter(vec![cv_text("apple"), cv_text("BANANA")], false);
    let data = vec![
        cv_text("Apple"),
        cv_text("banana"),
        cv_text("Cherry"),
        cv_text("APPLE"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1]);
}

#[test]
fn test_value_filter_booleans() {
    let criteria = make_value_filter(vec![cv_bool(true)], false);
    let data = vec![cv_bool(true), cv_bool(false), cv_bool(true), cv_bool(false)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0]);
}

#[test]
fn test_value_filter_errors() {
    let criteria = make_value_filter(vec![cv_err(CellError::Div0)], false);
    let data = vec![
        cv_err(CellError::Div0),
        cv_err(CellError::Na),
        cv_num(42.0),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0]);
}

#[test]
fn test_value_filter_empty_included_with_blanks() {
    let criteria = make_value_filter(vec![], true);
    let data = vec![cv_num(1.0), cv_null(), cv_text("text"), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 0, 1]);
}

#[test]
fn test_value_filter_empty_included_no_blanks() {
    let criteria = make_value_filter(vec![], false);
    let data = vec![cv_num(1.0), cv_null(), cv_text("text")];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0]);
}

#[test]
fn test_value_filter_nan() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_nan(), cv_text("hello")], false);
    let data = vec![
        cv_num(1.0),
        cv_nan(),
        cv_text("hello"),
        cv_num(2.0),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 0, 0]);
}

#[test]
fn test_value_filter_nan_not_in_list() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)], false);
    let data = vec![cv_num(1.0), cv_nan(), cv_num(3.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1]);
}

#[test]
fn test_all_blanks_exclude() {
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let data = vec![cv_null(), cv_null(), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0]);
}

#[test]
fn test_all_blanks_include() {
    let criteria = make_value_filter(vec![], true);
    let data = vec![cv_null(), cv_null(), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_mixed_types_value_filter() {
    let criteria = make_value_filter(vec![cv_num(42.0), cv_text("hello"), cv_bool(true)], false);
    let data = vec![
        cv_num(42.0),
        cv_text("HELLO"),
        cv_bool(true),
        cv_bool(false),
        cv_text("world"),
        cv_null(),
        cv_num(43.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 0, 0, 0, 0]);
}

use super::super::fixtures::*;
use super::super::*;

#[test]
fn test_condition_between() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 1, 1, 0, 0]);
}

#[test]
fn test_condition_not_between() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
        cv_null(),
    ];
    // Blanks return true for notBetween
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0, 1, 1]);
}

#[test]
fn test_between_null_value2() {
    let criteria = make_condition_filter(
        vec![make_cond2(FilterOperator::Between, cv_num(5.0), cv_null())],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0, 0, 0]);
}

#[test]
fn test_not_between_null_value2() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_null(),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 1, 1]);
}

#[test]
fn test_between_reversed_bounds() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_num(10.0),
            cv_num(5.0),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0, 0, 0]);
}

#[test]
fn test_between_with_strings() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_text("b"),
            cv_text("d"),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("a"),
        cv_text("b"),
        cv_text("c"),
        cv_text("d"),
        cv_text("e"),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 1, 1, 0]);
}

#[test]
fn test_not_between_with_strings() {
    // NotBetween operator with string values: strings outside [b, d] pass.
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_text("b"),
            cv_text("d"),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("a"), // < "b" -> outside -> true
        cv_text("b"), // == lower bound -> inside -> false
        cv_text("c"), // inside -> false
        cv_text("d"), // == upper bound -> inside -> false
        cv_text("e"), // > "d" -> outside -> true
        cv_null(),    // blank -> true (negative operator)
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0, 1, 1]);
}

#[test]
fn test_between_type_mismatch_value2() {
    // Between where value and value1 are numbers but value2 is text.
    // The value-vs-value2 type check should fail since Number(7) and Text("z")
    // have different type ranks, so the between check returns false.
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_num(5.0),
            cv_text("z"),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(7.0),  // types_compatible(7, 5) OK, but types_compatible(7, "z") -> false
        cv_num(3.0),  // < 5, but also type mismatch on value2 -> false
        cv_num(10.0), // type mismatch on value2 -> false
        cv_text("m"), // types_compatible("m", 5) -> false -> false
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0, 0]);
}

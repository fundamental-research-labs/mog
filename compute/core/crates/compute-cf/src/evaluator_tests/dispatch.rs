use super::helpers::*;

#[test]
fn cell_value_match_returns_style() {
    let rule = style_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "10"),
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(15.0), &rule, &default_stats(), None, test_now());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn cell_value_no_match_returns_none() {
    let rule = style_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "10"),
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

#[test]
fn formula_truthy_returns_style() {
    let rule = style_rule(
        CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
        1,
        false,
    );
    let formula_val = CellValue::Boolean(true);

    let result = evaluate_rule(
        &n(5.0),
        &rule,
        &default_stats(),
        Some(&formula_val),
        test_now(),
    );
    assert!(result.unwrap().style.is_some());
}

#[test]
fn formula_falsy_returns_none() {
    let rule = style_rule(
        CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
        1,
        false,
    );
    let formula_val = CellValue::Boolean(false);

    let result = evaluate_rule(
        &n(5.0),
        &rule,
        &default_stats(),
        Some(&formula_val),
        test_now(),
    );
    assert!(result.is_none());
}

#[test]
fn formula_without_result_returns_none() {
    let rule = style_rule(
        CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

#[test]
fn top10_match_returns_style() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = style_rule(
        CFRuleKind::Top10 {
            rank: 1,
            percent: false,
            bottom: false,
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &stats, None, test_now());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn top10_no_match_returns_none() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = style_rule(
        CFRuleKind::Top10 {
            rank: 1,
            percent: false,
            bottom: false,
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(1.0), &rule, &stats, None, test_now());
    assert!(result.is_none());
}

#[test]
fn above_average_match_returns_style() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = style_rule(
        CFRuleKind::AboveAverage {
            above: true,
            equal_average: false,
            std_dev: 0,
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(4.0), &rule, &stats, None, test_now());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn above_average_no_match_returns_none() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = style_rule(
        CFRuleKind::AboveAverage {
            above: true,
            equal_average: false,
            std_dev: 0,
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(2.0), &rule, &stats, None, test_now());
    assert!(result.is_none());
}

#[test]
fn duplicate_match_returns_style() {
    let stats = stats_from_values(&[10.0, 10.0, 20.0]);
    let rule = style_rule(CFRuleKind::DuplicateValues { unique: false }, 1, false);

    let result = evaluate_rule(&n(10.0), &rule, &stats, None, test_now());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn duplicate_no_match_returns_none() {
    let stats = stats_from_values(&[10.0, 10.0, 20.0]);
    let rule = style_rule(CFRuleKind::DuplicateValues { unique: false }, 1, false);

    let result = evaluate_rule(&n(20.0), &rule, &stats, None, test_now());
    assert!(result.is_none());
}

#[test]
fn contains_text_match_returns_style() {
    let rule = style_rule(
        CFRuleKind::ContainsText {
            operator: CFTextOperator::Contains,
            text: "hello".to_string(),
        },
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("say hello world".into()),
        &rule,
        &default_stats(),
        None,
        test_now(),
    );
    assert!(result.unwrap().style.is_some());
}

#[test]
fn contains_text_no_match_returns_none() {
    let rule = style_rule(
        CFRuleKind::ContainsText {
            operator: CFTextOperator::Contains,
            text: "hello".to_string(),
        },
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("goodbye world".into()),
        &rule,
        &default_stats(),
        None,
        test_now(),
    );
    assert!(result.is_none());
}

#[test]
fn blanks_match_returns_style() {
    let rule = style_rule(CFRuleKind::ContainsBlanks { blanks: true }, 1, false);

    let result = evaluate_rule(&CellValue::Null, &rule, &default_stats(), None, test_now());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn blanks_no_match_returns_none() {
    let rule = style_rule(CFRuleKind::ContainsBlanks { blanks: true }, 1, false);

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

#[test]
fn errors_match_returns_style() {
    use value_types::CellError;

    let rule = style_rule(CFRuleKind::ContainsErrors { errors: true }, 1, false);

    let result = evaluate_rule(
        &CellValue::Error(CellError::Div0, None),
        &rule,
        &default_stats(),
        None,
        test_now(),
    );
    assert!(result.unwrap().style.is_some());
}

#[test]
fn errors_no_match_returns_none() {
    let rule = style_rule(CFRuleKind::ContainsErrors { errors: true }, 1, false);

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

#[test]
fn time_period_non_numeric_returns_none() {
    let rule = style_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("not a date".into()),
        &rule,
        &default_stats(),
        None,
        test_now(),
    );
    assert!(result.is_none());
}

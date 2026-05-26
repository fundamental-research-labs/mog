use super::*;
use crate::stats::RangeStatistics;
use crate::test_helpers::{stats_from_values, test_style};
use crate::types::*;
use chrono::NaiveDate;
use value_types::{CellValue, Color, FiniteF64};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn make_rule(
    kind: CFRuleKind,
    style: Option<CfRenderStyle>,
    priority: i32,
    stop_if_true: bool,
) -> CFRule {
    CFRule {
        priority,
        stop_if_true,
        ranges: vec![],
        style,
        kind,
    }
}

fn default_stats() -> RangeStatistics {
    RangeStatistics::default()
}

fn test_now() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 1, 15).unwrap()
}

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

/// Helper to create a CellValueComparison::Single from operator, text, and optional number.
fn single_comparison(op: CellValueSingleOp, text: &str) -> CellValueComparison {
    CellValueComparison::Single {
        operator: op,
        threshold: CellValueThreshold {
            text: text.to_string(),
            number: text.parse::<f64>().ok(),
        },
    }
}

// -----------------------------------------------------------------------
// evaluate_rule: CellValue
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_cell_value_match() {
    let rule = make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "10"),
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(15.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_some());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn test_evaluate_rule_cell_value_no_match() {
    let rule = make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "10"),
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: Formula
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_formula_truthy() {
    let rule = make_rule(
        CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
        Some(test_style()),
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
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_formula_falsy() {
    let rule = make_rule(
        CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
        Some(test_style()),
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
fn test_evaluate_rule_formula_no_result() {
    let rule = make_rule(
        CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: Top10
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_top10_match() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = make_rule(
        CFRuleKind::Top10 {
            rank: 1,
            percent: false,
            bottom: false,
        },
        Some(test_style()),
        1,
        false,
    );

    // 5.0 is the top 1 value
    let result = evaluate_rule(&n(5.0), &rule, &stats, None, test_now());
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_top10_no_match() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = make_rule(
        CFRuleKind::Top10 {
            rank: 1,
            percent: false,
            bottom: false,
        },
        Some(test_style()),
        1,
        false,
    );

    // 1.0 is not the top 1 value
    let result = evaluate_rule(&n(1.0), &rule, &stats, None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: AboveAverage
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_above_average_match() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]); // mean=3.0
    let rule = make_rule(
        CFRuleKind::AboveAverage {
            above: true,
            equal_average: false,
            std_dev: 0,
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(4.0), &rule, &stats, None, test_now());
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_above_average_no_match() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rule = make_rule(
        CFRuleKind::AboveAverage {
            above: true,
            equal_average: false,
            std_dev: 0,
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(2.0), &rule, &stats, None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: DuplicateValues
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_duplicate_match() {
    let stats = stats_from_values(&[10.0, 10.0, 20.0]);
    let rule = make_rule(
        CFRuleKind::DuplicateValues { unique: false },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(10.0), &rule, &stats, None, test_now());
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_duplicate_no_match() {
    let stats = stats_from_values(&[10.0, 10.0, 20.0]);
    let rule = make_rule(
        CFRuleKind::DuplicateValues { unique: false },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(20.0), &rule, &stats, None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: ContainsText
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_contains_text_match() {
    let rule = make_rule(
        CFRuleKind::ContainsText {
            operator: CFTextOperator::Contains,
            text: "hello".to_string(),
        },
        Some(test_style()),
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
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_contains_text_no_match() {
    let rule = make_rule(
        CFRuleKind::ContainsText {
            operator: CFTextOperator::Contains,
            text: "hello".to_string(),
        },
        Some(test_style()),
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

// -----------------------------------------------------------------------
// evaluate_rule: ContainsBlanks
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_blanks_match() {
    let rule = make_rule(
        CFRuleKind::ContainsBlanks { blanks: true },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&CellValue::Null, &rule, &default_stats(), None, test_now());
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_blanks_no_match() {
    let rule = make_rule(
        CFRuleKind::ContainsBlanks { blanks: true },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: ContainsErrors
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_errors_match() {
    use value_types::CellError;

    let rule = make_rule(
        CFRuleKind::ContainsErrors { errors: true },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Error(CellError::Div0, None),
        &rule,
        &default_stats(),
        None,
        test_now(),
    );
    assert!(result.is_some());
}

#[test]
fn test_evaluate_rule_errors_no_match() {
    let rule = make_rule(
        CFRuleKind::ContainsErrors { errors: true },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(5.0), &rule, &default_stats(), None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: TimePeriod (uses system clock, so just verify dispatch)
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_time_period_non_numeric() {
    let rule = make_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        Some(test_style()),
        1,
        false,
    );

    // Non-numeric values should not match time period rules
    let result = evaluate_rule(
        &CellValue::Text("not a date".into()),
        &rule,
        &default_stats(),
        None,
        test_now(),
    );
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: ColorScale
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_color_scale() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::ColorScale(CFColorScale {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::from_hex("#FF0000").unwrap(),
            },
            mid_point: None,
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::from_hex("#00FF00").unwrap(),
            },
        }),
        None,
        1,
        false,
    );

    // At min: should produce red
    let result = evaluate_rule(&n(0.0), &rule, &stats, None, test_now());
    assert!(result.is_some());
    let cs = result.unwrap().color_scale.unwrap();
    assert_eq!(cs.color, Color::rgb(255, 0, 0));
}

#[test]
fn test_evaluate_rule_color_scale_non_numeric() {
    let stats = stats_from_values(&[0.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::ColorScale(CFColorScale {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::from_hex("#FF0000").unwrap(),
            },
            mid_point: None,
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::from_hex("#00FF00").unwrap(),
            },
        }),
        None,
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("hello".into()),
        &rule,
        &stats,
        None,
        test_now(),
    );
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: DataBar
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_data_bar() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::DataBar(CFDataBar {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::BLACK,
            },
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::BLACK,
            },
            positive_color: Color::from_hex("#638EC6").unwrap(),
            negative_color: None,
            border_color: None,
            negative_border_color: None,
            show_border: false,
            gradient: false,
            direction: CFDataBarDirection::LeftToRight,
            axis_position: CFDataBarAxisPosition::Automatic,
            axis_color: None,
            show_value: true,
            min_length: 10,
            max_length: 90,
            match_positive_fill_color: false,
            match_positive_border_color: false,
        }),
        None,
        1,
        false,
    );

    let result = evaluate_rule(&n(50.0), &rule, &stats, None, test_now());
    assert!(result.is_some());
    let db = result.unwrap().data_bar.unwrap();
    assert!((db.fill_percent - 50.0).abs() < 1e-10);
}

#[test]
fn test_evaluate_rule_data_bar_non_numeric() {
    let stats = stats_from_values(&[0.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::DataBar(CFDataBar {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::BLACK,
            },
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::BLACK,
            },
            positive_color: Color::from_hex("#638EC6").unwrap(),
            negative_color: None,
            border_color: None,
            negative_border_color: None,
            show_border: false,
            gradient: false,
            direction: CFDataBarDirection::LeftToRight,
            axis_position: CFDataBarAxisPosition::Automatic,
            axis_color: None,
            show_value: true,
            min_length: 10,
            max_length: 90,
            match_positive_fill_color: false,
            match_positive_border_color: false,
        }),
        None,
        1,
        false,
    );

    let result = evaluate_rule(&CellValue::Null, &rule, &stats, None, test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: IconSet
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_icon_set() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::IconSet(CFIconSet {
            icon_set_name: CFIconSetName::ThreeArrows,
            thresholds: vec![
                CFIconThreshold {
                    value_type: CFValueType::Percent,
                    value: Some(33.0),
                    operator: CFIconThresholdOperator::GreaterThanOrEqual,
                    custom_icon: None,
                },
                CFIconThreshold {
                    value_type: CFValueType::Percent,
                    value: Some(67.0),
                    operator: CFIconThresholdOperator::GreaterThanOrEqual,
                    custom_icon: None,
                },
            ],
            reverse_order: false,
            show_icon_only: false,
        }),
        None,
        1,
        false,
    );

    let result = evaluate_rule(&n(100.0), &rule, &stats, None, test_now());
    assert!(result.is_some());
    let icon = result.unwrap().icon.unwrap();
    assert_eq!(icon.set_name, CFIconSetName::ThreeArrows);
}

#[test]
fn test_evaluate_rule_icon_set_non_numeric() {
    let stats = stats_from_values(&[0.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::IconSet(CFIconSet {
            icon_set_name: CFIconSetName::ThreeArrows,
            thresholds: vec![],
            reverse_order: false,
            show_icon_only: false,
        }),
        None,
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("text".into()),
        &rule,
        &stats,
        None,
        test_now(),
    );
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rule: Boolean coercion for visual rules (TRUE=1, FALSE=0)
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_color_scale_boolean_true() {
    let stats = stats_from_values(&[0.0, 1.0]);
    let rule = make_rule(
        CFRuleKind::ColorScale(CFColorScale {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::from_hex("#FF0000").unwrap(),
            },
            mid_point: None,
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::from_hex("#00FF00").unwrap(),
            },
        }),
        None,
        1,
        false,
    );

    // Boolean(true) -> 1.0 -> max color (green)
    let result = evaluate_rule(&CellValue::Boolean(true), &rule, &stats, None, test_now());
    assert!(result.is_some());
    let cs = result.unwrap().color_scale.unwrap();
    assert_eq!(cs.color, Color::rgb(0, 255, 0));
}

#[test]
fn test_evaluate_rule_data_bar_boolean_false() {
    let stats = stats_from_values(&[0.0, 1.0]);
    let rule = make_rule(
        CFRuleKind::DataBar(CFDataBar {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::BLACK,
            },
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::BLACK,
            },
            positive_color: Color::from_hex("#638EC6").unwrap(),
            negative_color: None,
            border_color: None,
            negative_border_color: None,
            show_border: false,
            gradient: false,
            direction: CFDataBarDirection::LeftToRight,
            axis_position: CFDataBarAxisPosition::Automatic,
            axis_color: None,
            show_value: true,
            min_length: 10,
            max_length: 90,
            match_positive_fill_color: false,
            match_positive_border_color: false,
        }),
        None,
        1,
        false,
    );

    // Boolean(false) -> 0.0 -> min -> clamped to min_length (10%)
    // After Bug H1 fix, minimum numeric values get min_length fill (matching Excel behavior)
    let result = evaluate_rule(&CellValue::Boolean(false), &rule, &stats, None, test_now());
    assert!(result.is_some());
    let db = result.unwrap().data_bar.unwrap();
    assert!((db.fill_percent - 10.0).abs() < 1e-10);
}

#[test]
fn test_evaluate_rule_icon_set_boolean_true() {
    let stats = stats_from_values(&[0.0, 1.0]);
    let rule = make_rule(
        CFRuleKind::IconSet(CFIconSet {
            icon_set_name: CFIconSetName::ThreeArrows,
            thresholds: vec![
                CFIconThreshold {
                    value_type: CFValueType::Percent,
                    value: Some(33.0),
                    operator: CFIconThresholdOperator::GreaterThanOrEqual,
                    custom_icon: None,
                },
                CFIconThreshold {
                    value_type: CFValueType::Percent,
                    value: Some(67.0),
                    operator: CFIconThresholdOperator::GreaterThanOrEqual,
                    custom_icon: None,
                },
            ],
            reverse_order: false,
            show_icon_only: false,
        }),
        None,
        1,
        false,
    );

    // Boolean(true) -> 1.0 -> percentile 100 -> best icon (0)
    let result = evaluate_rule(&CellValue::Boolean(true), &rule, &stats, None, test_now());
    assert!(result.is_some());
    let icon = result.unwrap().icon.unwrap();
    assert_eq!(icon.icon_index, 0);
}

// -----------------------------------------------------------------------
// evaluate_rules: no rules
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_empty() {
    let result = evaluate_rules(&n(5.0), &[], &default_stats(), &[], test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rules: single matching rule
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_single_match() {
    let rules = vec![make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "10"),
        },
        Some(test_style()),
        1,
        false,
    )];

    let result = evaluate_rules(&n(15.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
}

// -----------------------------------------------------------------------
// evaluate_rules: single non-matching rule
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_single_no_match() {
    let rules = vec![make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "10"),
        },
        Some(test_style()),
        1,
        false,
    )];

    let result = evaluate_rules(&n(5.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rules: multiple rules, priority ordering
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_priority_ordering() {
    // Rule 1 (higher priority): sets background to red
    // Rule 2 (lower priority): sets background to blue, font to green
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#0000FF").unwrap()),
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // Higher priority (rule 1) wins for background_color
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Lower priority (rule 2) fills in font_color
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
}

// -----------------------------------------------------------------------
// evaluate_rules: stop_if_true
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_stop_if_true() {
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true, // stop_if_true!
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // First rule matched and stopped
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Second rule was NOT evaluated
    assert_eq!(style.font_color, None);
}

// -----------------------------------------------------------------------
// evaluate_rules: stop_if_true only stops on match
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_stop_if_true_only_on_match() {
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "100"), // won't match 10
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true, // stop_if_true, but won't match
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"), // will match 10
            },
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // First rule didn't match, so stop_if_true didn't trigger
    assert_eq!(style.background_color, None);
    // Second rule matched
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
}

// -----------------------------------------------------------------------
// evaluate_rules: no matches returns None
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_no_matches() {
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "100"),
            },
            Some(test_style()),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::LessThan, "0"),
            },
            Some(test_style()),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_none());
}

// -----------------------------------------------------------------------
// evaluate_rules: mixed rule types
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_mixed_types() {
    // A cell value rule and a blanks rule
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::ContainsBlanks {
                blanks: false, // match non-blanks
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // Both rules matched
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, Some(true));
}

// -----------------------------------------------------------------------
// evaluate_rules: style + visual rule combination
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_style_and_color_scale() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "25"),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    // Style from cell value rule
    assert!(r.style.is_some());
    assert_eq!(r.style.unwrap().bold, Some(true));
    // Color scale from visual rule
    assert!(r.color_scale.is_some());
}

// -----------------------------------------------------------------------
// evaluate_rules: three rules, middle one is stop_if_true
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_middle_stop_if_true() {
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::ContainsBlanks { blanks: false },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            true, // stop here
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // Rule 1 matched
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Rule 2 matched and stopped
    assert_eq!(style.bold, Some(true));
    // Rule 3 was NOT evaluated
    assert_eq!(style.italic, None);
}

// -----------------------------------------------------------------------
// Visual rule exclusivity: two ColorScale rules
// -----------------------------------------------------------------------

#[test]
fn test_two_color_scale_rules_higher_priority_wins() {
    // Two ColorScale rules — the higher priority (lower number) should win
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        // Higher priority (priority=1): red-to-blue color scale
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#0000FF").unwrap(),
                },
            }),
            None,
            1,
            false,
        ),
        // Lower priority (priority=2): green-to-yellow color scale
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#FFFF00").unwrap(),
                },
            }),
            None,
            2,
            false,
        ),
    ];

    // Evaluate at min value (0.0) — should get red [255,0,0] from rule 1,
    // not green [0,255,0] from rule 2
    let result = evaluate_rules(&n(0.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    let cs = r
        .color_scale
        .expect("should have color_scale from higher priority rule");
    assert_eq!(
        cs.color,
        Color::rgb(255, 0, 0),
        "higher priority color scale (red) should win"
    );

    // Evaluate at max value (100.0) — should get blue [0,0,255] from rule 1,
    // not yellow [255,255,0] from rule 2
    let result = evaluate_rules(&n(100.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    let cs = r
        .color_scale
        .expect("should have color_scale from higher priority rule");
    assert_eq!(
        cs.color,
        Color::rgb(0, 0, 255),
        "higher priority color scale (blue) should win"
    );
}

// -----------------------------------------------------------------------
// evaluate_rules: formula rule in multi-rule evaluation
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_formula_rule_matches_with_true_result() {
    // Rule 1 (priority 1): CellValue > 5, sets background red
    // Rule 2 (priority 2): Formula rule, sets bold
    // Rule 3 (priority 3): CellValue > 0, sets italic
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::Formula {
                formula: "=A1>0".to_string(),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
    ];

    // formula_results: rule 0 = no formula, rule 1 = formula true, rule 2 = no formula
    let result = evaluate_rules(
        &n(10.0),
        &rules,
        &default_stats(),
        &[None, Some(CellValue::Boolean(true)), None],
        test_now(),
    );
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // Rule 1 matched: background red
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Rule 2 (formula) matched: bold
    assert_eq!(style.bold, Some(true));
    // Rule 3 matched: italic
    assert_eq!(style.italic, Some(true));
}

#[test]
fn test_evaluate_rules_formula_rule_skipped_with_false_result() {
    // Same setup but formula_result = false — formula rule should NOT match
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::Formula {
                formula: "=A1>0".to_string(),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
    ];

    // formula_results: rule 0 = no formula, rule 1 = formula false, rule 2 = no formula
    let result = evaluate_rules(
        &n(10.0),
        &rules,
        &default_stats(),
        &[None, Some(CellValue::Boolean(false)), None],
        test_now(),
    );
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // Rule 1 matched: background red
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Rule 2 (formula) did NOT match: bold should be absent
    assert_eq!(style.bold, None);
    // Rule 3 matched: italic
    assert_eq!(style.italic, Some(true));
}

// -----------------------------------------------------------------------
// evaluate_rules: stop_if_true with visual rules
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_stop_if_true_visual_rule_does_not_block_style() {
    // Rule 1 (priority 1): ColorScale with stop_if_true = true
    // Rule 2 (priority 2): CellValue style rule that would match
    // Per-category stop: visual stop_if_true should NOT prevent style rules.
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            1,
            true, // stop_if_true (visual category)
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                font_color: Some(Color::from_hex("#0000FF").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    // ColorScale matched and produced a result
    assert!(r.color_scale.is_some());
    // Per-category: visual stop does NOT block style rules — style IS present
    assert!(r.style.is_some());
    let style = r.style.unwrap();
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.font_color, Some(Color::from_hex("#0000FF").unwrap()));
}

#[test]
fn test_evaluate_rules_visual_rule_returns_none_for_text_lower_priority_still_applies() {
    // Rule 1 (priority 1): ColorScale with stop_if_true = true
    // Rule 2 (priority 2): ContainsText style rule
    // For a text cell, the ColorScale returns None (non-numeric),
    // so stop_if_true doesn't trigger, and Rule 2 should be evaluated.
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            1,
            true, // stop_if_true, but won't match text
        ),
        make_rule(
            CFRuleKind::ContainsText {
                operator: CFTextOperator::Contains,
                text: "hello".to_string(),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                font_color: Some(Color::from_hex("#0000FF").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(
        &CellValue::Text("hello world".into()),
        &rules,
        &stats,
        &[],
        test_now(),
    );
    assert!(result.is_some());
    let r = result.unwrap();
    // ColorScale didn't match (text value), so no color_scale
    assert!(r.color_scale.is_none());
    // Rule 2 matched because stop_if_true didn't trigger
    assert!(r.style.is_some());
    let style = r.style.unwrap();
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.font_color, Some(Color::from_hex("#0000FF").unwrap()));
}

// -----------------------------------------------------------------------
// evaluate_rules: 3+ rules all matching, full merge cascade
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_three_rules_all_match_full_merge() {
    // Rule 1 (priority 1): sets background_color and bold
    // Rule 2 (priority 2): sets font_color and italic
    // Rule 3 (priority 3): sets strikethrough and underline_type
    // All three match — verify every property is present in the merged result.
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                bold: Some(true),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                italic: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                strikethrough: Some(true),
                underline_type: Some(CFUnderlineType::Single),
                ..Default::default()
            }),
            3,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // From Rule 1 (highest priority)
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, Some(true));
    // From Rule 2
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
    assert_eq!(style.italic, Some(true));
    // From Rule 3 (lowest priority)
    assert_eq!(style.strikethrough, Some(true));
    assert_eq!(style.underline_type, Some(CFUnderlineType::Single));
}

// -----------------------------------------------------------------------
// evaluate_rules: per-category stop_if_true semantics
// -----------------------------------------------------------------------

#[test]
fn test_stop_if_true_style_does_not_block_visual() {
    // Rule 1 (priority 1): CellValue with stop_if_true = true (style category)
    // Rule 2 (priority 2): ColorScale (visual category)
    // Style stop should NOT prevent the visual rule from running.
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true, // stop_if_true (style category)
        ),
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    // Style rule matched
    assert!(r.style.is_some());
    assert_eq!(
        r.style.unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Visual rule also ran despite style stop_if_true
    assert!(
        r.color_scale.is_some(),
        "style stop_if_true should not block visual rules"
    );
}

#[test]
fn test_stop_if_true_visual_does_not_block_style() {
    // Rule 1 (priority 1): ColorScale with stop_if_true = true (visual category)
    // Rule 2 (priority 2): CellValue (style category)
    // Visual stop should NOT prevent the style rule from running.
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            1,
            true, // stop_if_true (visual category)
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                font_color: Some(Color::from_hex("#0000FF").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    // Visual rule matched
    assert!(r.color_scale.is_some());
    // Style rule also ran despite visual stop_if_true
    assert!(
        r.style.is_some(),
        "visual stop_if_true should not block style rules"
    );
    let style = r.style.unwrap();
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.font_color, Some(Color::from_hex("#0000FF").unwrap()));
}

#[test]
fn test_stop_if_true_style_blocks_style() {
    // Rule 1 (priority 1): CellValue with stop_if_true = true (matches)
    // Rule 2 (priority 2): Another CellValue (should be blocked by same-category stop)
    // Style stop DOES block lower-priority style rules.
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true, // stop_if_true (style category)
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                italic: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    let style = r.style.unwrap();
    // Rule 1 matched
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // Rule 2 was blocked by same-category stop_if_true
    assert_eq!(
        style.font_color, None,
        "style stop_if_true should block lower-priority style rules"
    );
    assert_eq!(style.italic, None);
}

#[test]
fn test_stop_if_true_visual_blocks_visual() {
    // Rule 1 (priority 1): ColorScale with stop_if_true = true
    // Rule 2 (priority 2): DataBar (should be blocked by same-category stop)
    // Visual stop DOES block lower-priority visual rules.
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            1,
            true, // stop_if_true (visual category)
        ),
        make_rule(
            CFRuleKind::DataBar(CFDataBar {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::BLACK,
                },
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::BLACK,
                },
                positive_color: Color::from_hex("#638EC6").unwrap(),
                negative_color: None,
                border_color: None,
                negative_border_color: None,
                show_border: false,
                gradient: false,
                direction: CFDataBarDirection::LeftToRight,
                axis_position: CFDataBarAxisPosition::Automatic,
                axis_color: None,
                show_value: true,
                min_length: 10,
                max_length: 90,
                match_positive_fill_color: false,
                match_positive_border_color: false,
            }),
            None,
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();
    // ColorScale matched (higher priority visual)
    assert!(
        r.color_scale.is_some(),
        "higher priority color_scale should be present"
    );
    // DataBar was blocked by same-category stop_if_true
    assert!(
        r.data_bar.is_none(),
        "visual stop_if_true should block lower-priority visual rules (data_bar)"
    );
}

// -----------------------------------------------------------------------
// evaluate_rules: DataBar + IconSet + ColorScale all present simultaneously
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_three_visual_rules_simultaneously() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);

    let rules = vec![
        // Priority 1: DataBar
        make_rule(
            CFRuleKind::DataBar(CFDataBar {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::BLACK,
                },
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::BLACK,
                },
                positive_color: Color::from_hex("#638EC6").unwrap(),
                negative_color: None,
                border_color: None,
                negative_border_color: None,
                show_border: false,
                gradient: false,
                direction: CFDataBarDirection::LeftToRight,
                axis_position: CFDataBarAxisPosition::Automatic,
                axis_color: None,
                show_value: true,
                min_length: 10,
                max_length: 90,
                match_positive_fill_color: false,
                match_positive_border_color: false,
            }),
            None,
            1,
            false,
        ),
        // Priority 2: IconSet
        make_rule(
            CFRuleKind::IconSet(CFIconSet {
                icon_set_name: CFIconSetName::ThreeArrows,
                thresholds: vec![
                    CFIconThreshold {
                        value_type: CFValueType::Percent,
                        value: Some(33.0),
                        operator: CFIconThresholdOperator::GreaterThanOrEqual,
                        custom_icon: None,
                    },
                    CFIconThreshold {
                        value_type: CFValueType::Percent,
                        value: Some(67.0),
                        operator: CFIconThresholdOperator::GreaterThanOrEqual,
                        custom_icon: None,
                    },
                ],
                reverse_order: false,
                show_icon_only: false,
            }),
            None,
            2,
            false,
        ),
        // Priority 3: ColorScale
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            3,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now());
    assert!(result.is_some());
    let r = result.unwrap();

    // All three visual results should be present
    assert!(r.data_bar.is_some(), "data_bar should be present");
    assert!(r.icon.is_some(), "icon should be present");
    assert!(r.color_scale.is_some(), "color_scale should be present");

    // Verify data bar value
    let db = r.data_bar.unwrap();
    assert!((db.fill_percent - 50.0).abs() < 1e-10);
}

// -----------------------------------------------------------------------
// evaluate_rules: all rules have stop_if_true
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_all_stop_if_true() {
    // When all style rules have stop_if_true, only the first matching style
    // rule should contribute (its stop_if_true prevents later style rules).
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true, // stop_if_true
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            2,
            true, // stop_if_true
        ),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            true, // stop_if_true
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_some());
    let style = result.unwrap().style.unwrap();
    // First rule matched and stopped all subsequent style rules
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.font_color, None);
    assert_eq!(style.italic, None);
}

// -----------------------------------------------------------------------
// evaluate_rules: Error cell value through full evaluator pipeline
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rules_error_cell_through_pipeline() {
    use value_types::CellError;

    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // Multiple rule types that should all reject error values
    let rules = vec![
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
            },
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::Top10 {
                rank: 3,
                percent: false,
                bottom: false,
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        make_rule(
            CFRuleKind::AboveAverage {
                above: true,
                equal_average: false,
                std_dev: 0,
            },
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
            None,
            4,
            false,
        ),
    ];

    // Error value should not match any of these rules
    let result = evaluate_rules(
        &CellValue::Error(CellError::Value, None),
        &rules,
        &stats,
        &[],
        test_now(),
    );
    // CellValue comparison returns None for errors (non-numeric),
    // Top10 returns None for non-numeric, AboveAverage returns None for non-numeric,
    // ColorScale returns None for non-numeric. So overall result should be None.
    assert!(
        result.is_none(),
        "Error cell value should not match any numeric-based rules"
    );
}

// -----------------------------------------------------------------------
// CascadeEvaluator
// -----------------------------------------------------------------------

#[test]
fn test_cascade_empty() {
    let cascade = CascadeEvaluator::new();
    assert!(cascade.finish().is_none());
}

#[test]
fn test_cascade_single_match() {
    let mut cascade = CascadeEvaluator::new();
    let rule = make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
        },
        Some(test_style()),
        1,
        false,
    );
    cascade.apply(&n(10.0), &rule, &default_stats(), None, test_now());
    let result = cascade.finish();
    assert!(result.is_some());
    assert!(result.unwrap().style.is_some());
}

#[test]
fn test_cascade_is_stopped() {
    let mut cascade = CascadeEvaluator::new();
    let rule1 = make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "5"),
        },
        Some(test_style()),
        1,
        true, // stop_if_true
    );
    cascade.apply(&n(10.0), &rule1, &default_stats(), None, test_now());

    // Same category (style) should be stopped
    let rule2 = make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
        },
        Some(CfRenderStyle {
            bold: Some(true),
            ..Default::default()
        }),
        2,
        false,
    );
    assert!(cascade.is_stopped(&rule2));
}

#[test]
fn test_cascade_cross_category_not_stopped() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let mut cascade = CascadeEvaluator::new();
    // Style rule with stop_if_true
    let rule1 = make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, "0"),
        },
        Some(test_style()),
        1,
        true,
    );
    cascade.apply(&n(50.0), &rule1, &stats, None, test_now());

    // Visual rule should NOT be stopped
    let rule2 = make_rule(
        CFRuleKind::ColorScale(CFColorScale {
            min_point: CFColorPoint {
                value_type: CFValueType::Min,
                value: None,
                color: Color::from_hex("#FF0000").unwrap(),
            },
            mid_point: None,
            max_point: CFColorPoint {
                value_type: CFValueType::Max,
                value: None,
                color: Color::from_hex("#00FF00").unwrap(),
            },
        }),
        None,
        2,
        false,
    );
    assert!(!cascade.is_stopped(&rule2));
}

// -----------------------------------------------------------------------
// evaluate_rule: TimePeriod — "Today" rule matches today's serial date
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_rule_time_period_today_matches() {
    // Create a TimePeriod::Today rule and evaluate with a serial date
    // corresponding to test_now() (2026-01-15).
    let now = test_now(); // 2026-01-15
    let serial = value_types::date_serial::date_to_serial(&now);

    let rule = make_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(serial), &rule, &default_stats(), None, now);
    assert!(
        result.is_some(),
        "TimePeriod::Today should match today's serial date"
    );
    let result = result.unwrap();
    assert!(
        result.style.is_some(),
        "TimePeriod match should return the rule's style"
    );
    assert_eq!(
        result.style.unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap()),
        "TimePeriod match should return the configured style"
    );
}

#[test]
fn test_evaluate_rule_time_period_today_no_match() {
    // Yesterday's serial date should NOT match Today.
    let now = test_now(); // 2026-01-15
    let yesterday = NaiveDate::from_ymd_opt(2026, 1, 14).unwrap();
    let serial = value_types::date_serial::date_to_serial(&yesterday);

    let rule = make_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(&n(serial), &rule, &default_stats(), None, now);
    assert!(
        result.is_none(),
        "TimePeriod::Today should not match yesterday's date"
    );
}

#[test]
fn test_evaluate_rule_time_period_text_value_no_match() {
    // Text values should not match TimePeriod rules (only numbers are dates).
    let now = test_now();
    let rule = make_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        Some(test_style()),
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("2026-01-15".into()),
        &rule,
        &default_stats(),
        None,
        now,
    );
    assert!(
        result.is_none(),
        "Text values should not match TimePeriod rules"
    );
}

pub(super) use super::super::{CascadeEvaluator, evaluate_rule, evaluate_rules};
use crate::stats::RangeStatistics;
pub(super) use crate::test_helpers::{stats_from_values, test_style};
pub(super) use crate::types::*;
pub(super) use chrono::NaiveDate;
pub(super) use value_types::{CellValue, Color, FiniteF64};

pub(super) fn make_rule(
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

pub(super) fn default_stats() -> RangeStatistics {
    RangeStatistics::default()
}

pub(super) fn test_now() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 1, 15).unwrap()
}

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
pub(super) fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

/// Helper to create a CellValueComparison::Single from operator, text, and optional number.
pub(super) fn single_comparison(op: CellValueSingleOp, text: &str) -> CellValueComparison {
    CellValueComparison::Single {
        operator: op,
        threshold: CellValueThreshold {
            text: text.to_string(),
            number: text.parse::<f64>().ok(),
        },
    }
}

pub(super) fn style_rule(kind: CFRuleKind, priority: i32, stop_if_true: bool) -> CFRule {
    make_rule(kind, Some(test_style()), priority, stop_if_true)
}

pub(super) fn color_scale_rule(priority: i32, stop_if_true: bool) -> CFRule {
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
        priority,
        stop_if_true,
    )
}

pub(super) fn data_bar_rule(priority: i32, stop_if_true: bool) -> CFRule {
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
        priority,
        stop_if_true,
    )
}

pub(super) fn icon_set_rule(priority: i32, stop_if_true: bool) -> CFRule {
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
        priority,
        stop_if_true,
    )
}

pub(super) fn greater_than_rule(
    threshold: &str,
    style: Option<CfRenderStyle>,
    priority: i32,
    stop_if_true: bool,
) -> CFRule {
    make_rule(
        CFRuleKind::CellValue {
            comparison: single_comparison(CellValueSingleOp::GreaterThan, threshold),
        },
        style,
        priority,
        stop_if_true,
    )
}

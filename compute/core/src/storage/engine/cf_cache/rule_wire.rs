use super::data_bar::convert_data_bar_to_wire;
use super::icon_set::convert_icon_set_to_wire;
use super::operators::{parse_cf_operator, parse_date_period, parse_text_operator};
use super::style::convert_style;
use super::value_refs::convert_color_scale_to_wire;
use crate::cf::types::{CFRuleType, CFRuleWire, CFTextOperator, CfValue};
use cell_types::RangePos;
use domain_types::domain::conditional_format as cf;

/// Convert a single domain CF rule to the flat wire format.
/// The `ranges` are attached from the parent ConditionalFormat.
pub(super) fn domain_rule_to_wire(rule: &cf::CFRule, ranges: Vec<RangePos>) -> CFRuleWire {
    match rule {
        cf::CFRule::CellValue {
            priority,
            stop_if_true,
            operator,
            value1,
            value2,
            style,
            ..
        } => {
            let op = parse_cf_operator(*operator);
            let mut values = vec![CfValue::from_json_value(value1)];
            if let Some(v2) = value2 {
                values.push(CfValue::from_json_value(v2));
            }
            CFRuleWire {
                rule_type: CFRuleType::CellValue,
                priority: *priority,
                stop_if_true: stop_if_true.unwrap_or(false),
                style: Some(convert_style(style)),
                operator: op,
                values,
                formula: None,
                color_scale: None,
                data_bar: None,
                icon_set: None,
                text: None,
                text_operator: None,
                date_period: None,
                rank: None,
                percent: None,
                bottom: None,
                above: None,
                equal_average: None,
                std_dev: None,
                unique: None,
                blanks: None,
                errors: None,
                ranges,
            }
        }

        cf::CFRule::Formula {
            priority,
            stop_if_true,
            formula,
            style,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::Formula,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: Some(convert_style(style)),
            operator: None,
            values: vec![],
            formula: Some(formula.clone()),
            color_scale: None,
            data_bar: None,
            icon_set: None,
            text: None,
            text_operator: None,
            date_period: None,
            rank: None,
            percent: None,
            bottom: None,
            above: None,
            equal_average: None,
            std_dev: None,
            unique: None,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::ColorScale {
            priority,
            stop_if_true,
            color_scale,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::ColorScale,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: None,
            operator: None,
            values: vec![],
            formula: None,
            color_scale: Some(convert_color_scale_to_wire(color_scale)),
            data_bar: None,
            icon_set: None,
            text: None,
            text_operator: None,
            date_period: None,
            rank: None,
            percent: None,
            bottom: None,
            above: None,
            equal_average: None,
            std_dev: None,
            unique: None,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::DataBar {
            priority,
            stop_if_true,
            data_bar,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::DataBar,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: None,
            operator: None,
            values: vec![],
            formula: None,
            color_scale: None,
            data_bar: Some(convert_data_bar_to_wire(data_bar)),
            icon_set: None,
            text: None,
            text_operator: None,
            date_period: None,
            rank: None,
            percent: None,
            bottom: None,
            above: None,
            equal_average: None,
            std_dev: None,
            unique: None,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::IconSet {
            priority,
            stop_if_true,
            icon_set,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::IconSet,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: None,
            operator: None,
            values: vec![],
            formula: None,
            color_scale: None,
            data_bar: None,
            icon_set: Some(convert_icon_set_to_wire(icon_set)),
            text: None,
            text_operator: None,
            date_period: None,
            rank: None,
            percent: None,
            bottom: None,
            above: None,
            equal_average: None,
            std_dev: None,
            unique: None,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::Top10 {
            priority,
            stop_if_true,
            rank,
            percent,
            bottom,
            style,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::Top10,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: Some(convert_style(style)),
            operator: None,
            values: vec![],
            formula: None,
            color_scale: None,
            data_bar: None,
            icon_set: None,
            text: None,
            text_operator: None,
            date_period: None,
            rank: Some(*rank),
            percent: *percent,
            bottom: *bottom,
            above: None,
            equal_average: None,
            std_dev: None,
            unique: None,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::AboveAverage {
            priority,
            stop_if_true,
            above_average,
            equal_average,
            std_dev,
            style,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::AboveAverage,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: Some(convert_style(style)),
            operator: None,
            values: vec![],
            formula: None,
            color_scale: None,
            data_bar: None,
            icon_set: None,
            text: None,
            text_operator: None,
            date_period: None,
            rank: None,
            percent: None,
            bottom: None,
            above: Some(*above_average),
            equal_average: *equal_average,
            std_dev: *std_dev,
            unique: None,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::DuplicateValues {
            priority,
            stop_if_true,
            unique,
            style,
            ..
        } => CFRuleWire {
            rule_type: CFRuleType::DuplicateValues,
            priority: *priority,
            stop_if_true: stop_if_true.unwrap_or(false),
            style: Some(convert_style(style)),
            operator: None,
            values: vec![],
            formula: None,
            color_scale: None,
            data_bar: None,
            icon_set: None,
            text: None,
            text_operator: None,
            date_period: None,
            rank: None,
            percent: None,
            bottom: None,
            above: None,
            equal_average: None,
            std_dev: None,
            unique: *unique,
            blanks: None,
            errors: None,
            ranges,
        },

        cf::CFRule::ContainsText {
            priority,
            stop_if_true,
            operator,
            text,
            style,
            ..
        } => {
            let text_operator = parse_text_operator(*operator);
            // Map to the appropriate rule type based on operator
            let rule_type = match text_operator {
                Some(CFTextOperator::NotContains) => CFRuleType::NotContainsText,
                Some(CFTextOperator::BeginsWith) => CFRuleType::BeginsWith,
                Some(CFTextOperator::EndsWith) => CFRuleType::EndsWith,
                _ => CFRuleType::ContainsText,
            };
            CFRuleWire {
                rule_type,
                priority: *priority,
                stop_if_true: stop_if_true.unwrap_or(false),
                style: Some(convert_style(style)),
                operator: None,
                values: vec![],
                formula: None,
                color_scale: None,
                data_bar: None,
                icon_set: None,
                text: Some(text.clone()),
                text_operator,
                date_period: None,
                rank: None,
                percent: None,
                bottom: None,
                above: None,
                equal_average: None,
                std_dev: None,
                unique: None,
                blanks: None,
                errors: None,
                ranges,
            }
        }

        cf::CFRule::ContainsBlanks {
            priority,
            stop_if_true,
            blanks,
            style,
            ..
        } => {
            let rule_type = if *blanks {
                CFRuleType::ContainsBlanks
            } else {
                CFRuleType::NotContainsBlanks
            };
            CFRuleWire {
                rule_type,
                priority: *priority,
                stop_if_true: stop_if_true.unwrap_or(false),
                style: Some(convert_style(style)),
                operator: None,
                values: vec![],
                formula: None,
                color_scale: None,
                data_bar: None,
                icon_set: None,
                text: None,
                text_operator: None,
                date_period: None,
                rank: None,
                percent: None,
                bottom: None,
                above: None,
                equal_average: None,
                std_dev: None,
                unique: None,
                blanks: Some(*blanks),
                errors: None,
                ranges,
            }
        }

        cf::CFRule::ContainsErrors {
            priority,
            stop_if_true,
            errors,
            style,
            ..
        } => {
            let rule_type = if *errors {
                CFRuleType::ContainsErrors
            } else {
                CFRuleType::NotContainsErrors
            };
            CFRuleWire {
                rule_type,
                priority: *priority,
                stop_if_true: stop_if_true.unwrap_or(false),
                style: Some(convert_style(style)),
                operator: None,
                values: vec![],
                formula: None,
                color_scale: None,
                data_bar: None,
                icon_set: None,
                text: None,
                text_operator: None,
                date_period: None,
                rank: None,
                percent: None,
                bottom: None,
                above: None,
                equal_average: None,
                std_dev: None,
                unique: None,
                blanks: None,
                errors: Some(*errors),
                ranges,
            }
        }

        cf::CFRule::TimePeriod {
            priority,
            stop_if_true,
            time_period,
            style,
            ..
        } => {
            let date_period = parse_date_period(*time_period);
            CFRuleWire {
                rule_type: CFRuleType::TimePeriod,
                priority: *priority,
                stop_if_true: stop_if_true.unwrap_or(false),
                style: Some(convert_style(style)),
                operator: None,
                values: vec![],
                formula: None,
                color_scale: None,
                data_bar: None,
                icon_set: None,
                text: None,
                text_operator: None,
                date_period,
                rank: None,
                percent: None,
                bottom: None,
                above: None,
                equal_average: None,
                std_dev: None,
                unique: None,
                blanks: None,
                errors: None,
                ranges,
            }
        }
    }
}

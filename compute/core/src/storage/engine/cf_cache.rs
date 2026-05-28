//! Conversion from domain-type conditional formats to compute-cf evaluation types.
//!
//! Bridges `domain_types::cf::ConditionalFormat` → `compute_cf::types::CFRule` by:
//! 1. Flattening the domain tagged enum into `CFRuleWire` (flat wire format)
//! 2. Reusing the existing `TryFrom<CFRuleWire> for CFRule` parsing
//!
//! This replaces the TypeScript `convertRuleToWire()` in condformat-cache.ts.

use crate::cf::types::{
    CFColorPointWire, CFColorScaleWire, CFDataBarAxisPosition, CFDataBarDirection, CFDataBarWire,
    CFIconSetName, CFIconSetWire, CFIconThresholdOperator, CFIconThresholdWire, CFOperator, CFRule,
    CFRuleType, CFRuleWire, CFTextOperator, CFValueType, CfRenderStyle, CfValue, DatePeriod,
};
use cell_types::{RangePos, SheetId};
use domain_types::domain::conditional_format::{self as cf, ConditionalFormat};

// =============================================================================
// Domain CFStyle -> compute-cf CfRenderStyle
// =============================================================================

/// Convert domain CFStyle (string colors, bool underline) to compute-cf CfRenderStyle
/// (Color values, CFUnderlineType).
fn convert_style(style: &cf::CFStyle) -> CfRenderStyle {
    use crate::cf::types::{CFBorderStyle, CFUnderlineType};
    use value_types::Color;

    use ooxml_types::styles::{BorderStyle as OoxmlBorderStyle, UnderlineStyle};

    // Resolve underline: prefer typed underline_type; fall back to legacy bool.
    let underline_type = if let Some(ut) = style.underline_type {
        Some(match ut {
            UnderlineStyle::Single => CFUnderlineType::Single,
            UnderlineStyle::Double => CFUnderlineType::Double,
            UnderlineStyle::SingleAccounting => CFUnderlineType::SingleAccounting,
            UnderlineStyle::DoubleAccounting => CFUnderlineType::DoubleAccounting,
            UnderlineStyle::None => CFUnderlineType::None,
        })
    } else {
        style.underline_legacy.map(|u| {
            if u {
                CFUnderlineType::Single
            } else {
                CFUnderlineType::None
            }
        })
    };

    // Domain BorderStyle -> compute-cf CFBorderStyle. The typed border_style
    // comes from domain-types as an ooxml enum; map exhaustively here.
    fn map_border_style(s: OoxmlBorderStyle) -> CFBorderStyle {
        match s {
            OoxmlBorderStyle::None => CFBorderStyle::None,
            OoxmlBorderStyle::Thin => CFBorderStyle::Thin,
            OoxmlBorderStyle::Medium => CFBorderStyle::Medium,
            OoxmlBorderStyle::Thick => CFBorderStyle::Thick,
            OoxmlBorderStyle::Dashed => CFBorderStyle::Dashed,
            OoxmlBorderStyle::Dotted => CFBorderStyle::Dotted,
            OoxmlBorderStyle::Double => CFBorderStyle::Double,
            OoxmlBorderStyle::Hair => CFBorderStyle::Hair,
            OoxmlBorderStyle::MediumDashed => CFBorderStyle::MediumDashed,
            OoxmlBorderStyle::DashDot => CFBorderStyle::DashDot,
            OoxmlBorderStyle::MediumDashDot => CFBorderStyle::MediumDashDot,
            OoxmlBorderStyle::DashDotDot => CFBorderStyle::DashDotDot,
            OoxmlBorderStyle::MediumDashDotDot => CFBorderStyle::MediumDashDotDot,
            OoxmlBorderStyle::SlantDashDot => CFBorderStyle::SlantDashDot,
        }
    }

    // Per-side border styles on CFStyle are still Option<String> (they belong
    // to the W-cond-format scope of round-D, not W-styles). Keep the string
    // matcher for those fields.
    fn parse_border_style(s: &str) -> CFBorderStyle {
        match s {
            "none" => CFBorderStyle::None,
            "thin" => CFBorderStyle::Thin,
            "medium" => CFBorderStyle::Medium,
            "thick" => CFBorderStyle::Thick,
            "dashed" => CFBorderStyle::Dashed,
            "dotted" => CFBorderStyle::Dotted,
            "double" => CFBorderStyle::Double,
            "hair" => CFBorderStyle::Hair,
            "mediumDashed" => CFBorderStyle::MediumDashed,
            "dashDot" => CFBorderStyle::DashDot,
            "mediumDashDot" => CFBorderStyle::MediumDashDot,
            "dashDotDot" => CFBorderStyle::DashDotDot,
            "mediumDashDotDot" => CFBorderStyle::MediumDashDotDot,
            "slantDashDot" => CFBorderStyle::SlantDashDot,
            _ => CFBorderStyle::Thin,
        }
    }

    CfRenderStyle {
        background_color: style
            .background_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        font_color: style
            .font_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        bold: style.bold,
        italic: style.italic,
        underline_type,
        strikethrough: style.strikethrough,
        border_color: style
            .border_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        // Unified border_style is the typed enum; per-side border styles are
        // still strings (W-cond-format scope).
        border_style: style.border_style.map(map_border_style),
        border_top_color: style
            .border_top_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_top_style: style.border_top_style.as_deref().map(parse_border_style),
        border_bottom_color: style
            .border_bottom_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_bottom_style: style.border_bottom_style.as_deref().map(parse_border_style),
        border_left_color: style
            .border_left_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_left_style: style.border_left_style.as_deref().map(parse_border_style),
        border_right_color: style
            .border_right_color
            .as_deref()
            .and_then(|s| Color::from_hex(s).ok()),
        border_right_style: style.border_right_style.as_deref().map(parse_border_style),
        number_format: style.number_format.clone(),
    }
}

// =============================================================================
// Domain CFColorPoint -> wire CFColorPointWire
// =============================================================================

fn convert_color_point_to_wire(pt: &cf::CFColorPoint) -> CFColorPointWire {
    // Typed OOXML preservation: collapsed `value_type: CfvoType` + `value: Option<Value>`
    // into a single typed `CFValueRef` enum. Lower each variant to the
    // compute-cf wire pair. The two Excel-2010+ extension variants
    // (`AutoMin`/`AutoMax`) don't have wire equivalents; fall back to
    // their natural base value (Min/Max) with a warn so the drift is
    // visible.
    let (value_type, value) = match &pt.value {
        cf::CFValueRef::Number { value } => {
            (CFValueType::Number, Some(CfValue::Number { value: *value }))
        }
        cf::CFValueRef::Percent { value } => (
            CFValueType::Percent,
            Some(CfValue::Number { value: *value }),
        ),
        cf::CFValueRef::Percentile { value } => (
            CFValueType::Percentile,
            Some(CfValue::Number { value: *value }),
        ),
        cf::CFValueRef::Formula { source } => (
            CFValueType::Formula,
            Some(CfValue::Formula {
                source: source.clone(),
            }),
        ),
        cf::CFValueRef::Min => (CFValueType::Min, None),
        cf::CFValueRef::Max => (CFValueType::Max, None),
        cf::CFValueRef::AutoMin => {
            tracing::warn!("CFColorPoint value=AutoMin not representable in wire, treating as Min");
            (CFValueType::Min, None)
        }
        cf::CFValueRef::AutoMax => {
            tracing::warn!("CFColorPoint value=AutoMax not representable in wire, treating as Max");
            (CFValueType::Max, None)
        }
    };
    CFColorPointWire {
        value_type,
        value,
        color: pt.color.clone(),
    }
}

fn normalize_data_bar_color(color: &str) -> Option<String> {
    value_types::Color::from_hex(color.trim())
        .ok()
        .map(|color| color.to_string())
}

// =============================================================================
// Domain CFColorScale -> wire CFColorScaleWire
// =============================================================================

fn convert_color_scale_to_wire(cs: &cf::CFColorScale) -> CFColorScaleWire {
    CFColorScaleWire {
        min_point: convert_color_point_to_wire(&cs.min_point),
        mid_point: cs.mid_point.as_ref().map(convert_color_point_to_wire),
        max_point: convert_color_point_to_wire(&cs.max_point),
    }
}

// =============================================================================
// Domain CFDataBar -> wire CFDataBarWire
// =============================================================================

fn convert_data_bar_point_to_wire(pt: &cf::CFColorPoint, fallback_color: &str) -> CFColorPointWire {
    let mut wire = convert_color_point_to_wire(pt);
    wire.color = normalize_data_bar_color(&pt.color).unwrap_or_else(|| fallback_color.to_string());
    wire
}

fn convert_data_bar_to_wire(db: &cf::CFDataBar) -> CFDataBarWire {
    use ooxml_types::cond_format::{DataBarAxisPosition, DataBarDirection};
    let direction = match db.direction {
        Some(DataBarDirection::LeftToRight) => CFDataBarDirection::LeftToRight,
        Some(DataBarDirection::RightToLeft) => CFDataBarDirection::RightToLeft,
        Some(DataBarDirection::Context) | None => CFDataBarDirection::default(),
    };
    // Note: the OOXML enum uses `Middle`; compute-cf's wire enum uses
    // `Midpoint`. Round-D does not unify these — the wire-types side is out
    // of Round-D scope per the task brief.
    let axis_position = match db.axis_position {
        Some(DataBarAxisPosition::Automatic) => CFDataBarAxisPosition::Automatic,
        Some(DataBarAxisPosition::Middle) => CFDataBarAxisPosition::Midpoint,
        Some(DataBarAxisPosition::None) => CFDataBarAxisPosition::None,
        None => CFDataBarAxisPosition::default(),
    };

    let positive_color =
        normalize_data_bar_color(&db.positive_color).unwrap_or_else(|| db.positive_color.clone());

    CFDataBarWire {
        min_point: convert_data_bar_point_to_wire(&db.min_point, &positive_color),
        max_point: convert_data_bar_point_to_wire(&db.max_point, &positive_color),
        positive_color,
        negative_color: db.negative_color.clone(),
        border_color: db.border_color.clone(),
        negative_border_color: None, // Domain type doesn't carry this field
        show_border: db.show_border.unwrap_or(false),
        gradient: db.gradient.unwrap_or(true),
        direction,
        axis_position,
        axis_color: db.axis_color.clone(),
        show_value: db.show_value.unwrap_or(true),
        min_length: data_bar_length_to_wire(db.min_length, 10),
        max_length: data_bar_length_to_wire(db.max_length, 90),
        match_positive_fill_color: db.match_positive_fill_color.unwrap_or(false),
        match_positive_border_color: db.match_positive_border_color.unwrap_or(false),
    }
}

fn data_bar_length_to_wire(value: Option<u32>, default: u8) -> u8 {
    value.map(|v| v.min(100) as u8).unwrap_or(default)
}

// =============================================================================
// Domain CFIconSet -> wire CFIconSetWire
// =============================================================================

fn convert_icon_set_to_wire(is: &cf::CFIconSet) -> CFIconSetWire {
    // Parse icon set name via serde from the OOXML token produced by
    // `IconSetType::to_ooxml()` — the compute-cf wire enum
    // `CFIconSetName` uses the same `"3Arrows"` / `"4Arrows"` / etc tokens.
    let icon_set_name: CFIconSetName = serde_json::from_value(serde_json::Value::String(
        is.icon_set_name.to_ooxml().to_string(),
    ))
    .unwrap_or(CFIconSetName::ThreeArrows);

    // Build default thresholds from the registry
    let icon_count = icon_set_name.icon_count();
    let thresholds = if icon_count > 1 {
        // Generate evenly-spaced percentage thresholds (excluding the first icon at 0%)
        // e.g., 3 icons -> thresholds at [33, 67], 4 icons -> [25, 50, 75]
        (1..icon_count)
            .map(|i| {
                let pct = (i as f64 / icon_count as f64 * 100.0).round();
                CFIconThresholdWire {
                    value_type: CFValueType::Percent,
                    // Synthesized numeric threshold — no reason to stringify
                    // it on the way out (typed formula boundary).
                    value: Some(CfValue::Number { value: pct }),
                    operator: CFIconThresholdOperator::GreaterThanOrEqual,
                    custom_icon: None,
                }
            })
            .collect()
    } else {
        vec![]
    };

    CFIconSetWire {
        icon_set_name,
        thresholds,
        reverse_order: is.reverse_order.unwrap_or(false),
        show_icon_only: is.show_icon_only.unwrap_or(false),
    }
}

// =============================================================================
// Domain CFRule -> CFRuleWire
// =============================================================================

/// Convert a single domain CF rule to the flat wire format.
/// The `ranges` are attached from the parent ConditionalFormat.
fn domain_rule_to_wire(rule: &cf::CFRule, ranges: Vec<RangePos>) -> CFRuleWire {
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

// =============================================================================
// ooxml enum -> compute-cf enum narrowing helpers
// =============================================================================

/// Narrow the OOXML `CfOperator` (12 variants covering both cellIs and text
/// ops) to compute-cf's `CFOperator` (8-variant cellIs-only subset). Returns
/// `None` if the input is a text-only variant — which should never appear on
/// `CFRule::CellValue.operator` by construction, so `None` is a soft warn.
fn parse_cf_operator(op: ooxml_types::cond_format::CfOperator) -> Option<CFOperator> {
    use ooxml_types::cond_format::CfOperator as OoxmlOp;
    match op {
        OoxmlOp::GreaterThan => Some(CFOperator::GreaterThan),
        OoxmlOp::LessThan => Some(CFOperator::LessThan),
        OoxmlOp::GreaterThanOrEqual => Some(CFOperator::GreaterThanOrEqual),
        OoxmlOp::LessThanOrEqual => Some(CFOperator::LessThanOrEqual),
        OoxmlOp::Equal => Some(CFOperator::Equal),
        OoxmlOp::NotEqual => Some(CFOperator::NotEqual),
        OoxmlOp::Between => Some(CFOperator::Between),
        OoxmlOp::NotBetween => Some(CFOperator::NotBetween),
        OoxmlOp::ContainsText | OoxmlOp::NotContains | OoxmlOp::BeginsWith | OoxmlOp::EndsWith => {
            tracing::warn!(
                "CF CellValue.operator carried text-op variant {:?}, skipping",
                op
            );
            None
        }
    }
}

/// Narrow the OOXML `CfOperator` to compute-cf's 4-variant text-op enum.
fn parse_text_operator(op: ooxml_types::cond_format::CfOperator) -> Option<CFTextOperator> {
    use ooxml_types::cond_format::CfOperator as OoxmlOp;
    match op {
        OoxmlOp::ContainsText => Some(CFTextOperator::Contains),
        OoxmlOp::NotContains => Some(CFTextOperator::NotContains),
        OoxmlOp::BeginsWith => Some(CFTextOperator::BeginsWith),
        OoxmlOp::EndsWith => Some(CFTextOperator::EndsWith),
        _ => {
            tracing::warn!("CF ContainsText.operator carried non-text variant {:?}", op);
            None
        }
    }
}

/// Map the OOXML `CfTimePeriod` (10 variants) to compute-cf's `DatePeriod`
/// (16 variants — includes Quarter / Year extensions the OOXML enum lacks).
fn parse_date_period(tp: ooxml_types::cond_format::CfTimePeriod) -> Option<DatePeriod> {
    use ooxml_types::cond_format::CfTimePeriod as OoxmlTp;
    Some(match tp {
        OoxmlTp::Yesterday => DatePeriod::Yesterday,
        OoxmlTp::Today => DatePeriod::Today,
        OoxmlTp::Tomorrow => DatePeriod::Tomorrow,
        OoxmlTp::Last7Days => DatePeriod::Last7Days,
        OoxmlTp::LastWeek => DatePeriod::LastWeek,
        OoxmlTp::ThisWeek => DatePeriod::ThisWeek,
        OoxmlTp::NextWeek => DatePeriod::NextWeek,
        OoxmlTp::LastMonth => DatePeriod::LastMonth,
        OoxmlTp::ThisMonth => DatePeriod::ThisMonth,
        OoxmlTp::NextMonth => DatePeriod::NextMonth,
    })
}

// =============================================================================
// Top-level conversion function
// =============================================================================

/// Convert domain `ConditionalFormat` list to compute-cf `CFRule` list.
///
/// For each `ConditionalFormat`:
///   - Primary: tries `range_identities` via the `resolve_cell_id` closure
///   - Fallback: converts position-based `ranges` field to `RangePos`
///   - For each rule in `format.rules`:
///     - Converts `domain::CFRule` -> `CFRuleWire` -> `CFRule`
///     - Attaches the resolved ranges
///   - Filters out conversion failures with warnings
///
/// The `resolve_cell_id` closure maps `(sheet_id_str, cell_id_str)` → `(row, col)`.
/// Pass `|_, _| None` in contexts where CellMirror is unavailable.
pub(crate) fn convert_cf_formats_to_rules(
    formats: &[ConditionalFormat],
    resolve_cell_id: impl Fn(&str, &str) -> Option<(u32, u32)>,
    fallback_sheet_id: Option<SheetId>,
) -> Vec<CFRule> {
    let mut result = Vec::new();

    for format in formats {
        // Parse the sheet_id from the format, or use the fallback (caller's sheet context).
        // The fallback handles the common case where the parser leaves sheet_id empty
        // and the caller (refresh_cf_cache) already knows the sheet.
        let sheet_id = match SheetId::from_uuid_str(&format.sheet_id) {
            Ok(sid) => sid,
            Err(_) => match fallback_sheet_id {
                Some(sid) => sid,
                None => {
                    tracing::warn!(
                        "CF format {} has invalid sheet_id '{}' and no fallback, skipping",
                        format.id,
                        format.sheet_id,
                    );
                    continue;
                }
            },
        };

        // Primary path: resolve range_identities via the closure
        let mut ranges: Vec<RangePos> = format
            .range_identities
            .as_ref()
            .map(|ris| {
                ris.iter()
                    .filter_map(|r| {
                        let start = resolve_cell_id(&format.sheet_id, &r.top_left_cell_id)?;
                        let end = resolve_cell_id(&format.sheet_id, &r.bottom_right_cell_id)?;
                        Some(RangePos::new(
                            sheet_id,
                            start.0.min(end.0),
                            start.1.min(end.1),
                            start.0.max(end.0),
                            start.1.max(end.1),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Fallback: if range_identities yielded nothing, use position-based ranges
        if ranges.is_empty() {
            ranges = format
                .ranges
                .iter()
                .map(|r| {
                    RangePos::new(
                        sheet_id,
                        r.start_row(),
                        r.start_col(),
                        r.end_row(),
                        r.end_col(),
                    )
                })
                .collect();
        }

        if ranges.is_empty() {
            tracing::debug!(
                "CF format {} has no valid ranges (neither range_identities nor ranges), skipping",
                format.id
            );
            continue;
        }

        for rule in &format.rules {
            let wire = domain_rule_to_wire(rule, ranges.clone());
            match CFRule::try_from(wire) {
                Ok(cf_rule) => result.push(cf_rule),
                Err(e) => {
                    tracing::warn!(
                        "Failed to convert CF rule {} in format {}: {}",
                        rule.id(),
                        format.id,
                        e
                    );
                }
            }
        }
    }

    result
}

// =============================================================================
// YrsComputeEngine integration
// =============================================================================

use super::YrsComputeEngine;
use crate::snapshot::RecalcResult;

impl YrsComputeEngine {
    /// After a recalculation pass, refresh the CF cache for every sheet that
    /// both (a) has conditional formatting rules and (b) had at least one cell
    /// change in the recalc result.
    ///
    /// Returns, per sheet, the `(row, col)` pairs of cells whose CF result
    /// changed but were NOT already in `recalc.changed_cells`. The caller
    /// (`produce_viewport_patches_for_recalc`) uses this to synthesize
    /// additional `CellChange` entries so sibling cells receive viewport patches.
    pub(crate) fn refresh_cf_caches_after_recalc(
        &mut self,
        recalc: &RecalcResult,
    ) -> rustc_hash::FxHashMap<cell_types::SheetId, Vec<(u32, u32)>> {
        super::services::cf_cache::refresh_cf_caches_after_recalc(
            &mut self.stores,
            &self.mirror,
            recalc,
        )
    }

    /// Re-evaluate all conditional formatting rules for a sheet and update the cache.
    pub(crate) fn refresh_cf_cache(&mut self, sheet_id: &cell_types::SheetId) {
        super::services::cf_cache::refresh_cf_cache(&mut self.stores, &self.mirror, sheet_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_style() -> cf::CFStyle {
        cf::CFStyle {
            font_color: Some("#FF0000".to_string()),
            background_color: Some("#00FF00".to_string()),
            bold: Some(true),
            ..Default::default()
        }
    }

    /// A valid UUID string for sheet_id in tests.
    const TEST_SHEET_UUID: &str = "00000000-0000-0000-0000-000000000099";

    fn make_format(rules: Vec<cf::CFRule>) -> ConditionalFormat {
        use cell_types::SheetRange;
        ConditionalFormat {
            id: "fmt1".to_string(),
            sheet_id: TEST_SHEET_UUID.to_string(),
            pivot: None,
            range_identities: None,
            ranges: vec![SheetRange::new(0, 0, 5, 3)],
            rules,
        }
    }

    /// Dummy resolver that always fails — forces fallback to position-based ranges.
    fn no_resolve(_sheet: &str, _cell: &str) -> Option<(u32, u32)> {
        None
    }

    #[test]
    fn test_convert_cell_value_rule() {
        use ooxml_types::cond_format::CfOperator;
        let rule = cf::CFRule::CellValue {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(42),
            value2: None,
            style: make_style(),
            text: None,
        };
        let formats = vec![make_format(vec![rule])];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].priority, 1);
        assert!(matches!(
            result[0].kind,
            crate::cf::types::CFRuleKind::CellValue { .. }
        ));
    }

    #[test]
    fn test_convert_formula_rule() {
        let rule = cf::CFRule::Formula {
            id: "r1".to_string(),
            priority: 2,
            stop_if_true: Some(true),
            formula: "=A1>10".to_string(),
            style: make_style(),
            text: None,
        };
        let formats = vec![make_format(vec![rule])];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 1);
        assert!(result[0].stop_if_true);
        assert!(matches!(
            result[0].kind,
            crate::cf::types::CFRuleKind::Formula { .. }
        ));
    }

    #[test]
    fn test_convert_multiple_rules_in_format() {
        use ooxml_types::cond_format::CfOperator;
        let rules = vec![
            cf::CFRule::CellValue {
                id: "r1".to_string(),
                priority: 1,
                stop_if_true: None,
                operator: CfOperator::Equal,
                value1: serde_json::json!("hello"),
                value2: None,
                style: make_style(),
                text: None,
            },
            cf::CFRule::ContainsBlanks {
                id: "r2".to_string(),
                priority: 2,
                stop_if_true: None,
                blanks: true,
                style: make_style(),
                formula: None,
            },
        ];
        let formats = vec![make_format(rules)];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_skip_format_with_no_ranges() {
        let format = ConditionalFormat {
            id: "fmt1".to_string(),
            sheet_id: TEST_SHEET_UUID.to_string(),
            pivot: None,
            range_identities: None,
            ranges: vec![],
            rules: vec![cf::CFRule::ContainsBlanks {
                id: "r1".to_string(),
                priority: 1,
                stop_if_true: None,
                blanks: true,
                style: make_style(),
                formula: None,
            }],
        };
        let result = convert_cf_formats_to_rules(&[format], no_resolve, None);
        assert!(result.is_empty());
    }

    #[test]
    fn test_convert_style_colors() {
        let style = cf::CFStyle {
            font_color: Some("#FF0000".to_string()),
            background_color: Some("#00FF00".to_string()),
            underline_legacy: Some(true),
            ..Default::default()
        };
        let converted = convert_style(&style);
        assert!(converted.font_color.is_some());
        assert!(converted.background_color.is_some());
        assert_eq!(
            converted.underline_type,
            Some(crate::cf::types::CFUnderlineType::Single)
        );
    }

    #[test]
    fn test_convert_between_cell_value() {
        use ooxml_types::cond_format::CfOperator;
        let rule = cf::CFRule::CellValue {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::Between,
            value1: serde_json::json!(10),
            value2: Some(serde_json::json!(20)),
            style: make_style(),
            text: None,
        };
        let formats = vec![make_format(vec![rule])];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 1);
        assert!(matches!(
            result[0].kind,
            crate::cf::types::CFRuleKind::CellValue {
                comparison: crate::cf::types::CellValueComparison::Between { .. }
            }
        ));
    }

    #[test]
    fn test_convert_color_scale_rule() {
        let rule = cf::CFRule::ColorScale {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            color_scale: cf::CFColorScale {
                min_point: cf::CFColorPoint {
                    value: cf::CFValueRef::Min,
                    ooxml_value: None,
                    color: "#FF0000".to_string(),
                    color_theme: None,
                    color_tint: None,
                    color_indexed: None,
                    color_auto: None,
                },
                mid_point: None,
                max_point: cf::CFColorPoint {
                    value: cf::CFValueRef::Max,
                    ooxml_value: None,
                    color: "#00FF00".to_string(),
                    color_theme: None,
                    color_tint: None,
                    color_indexed: None,
                    color_auto: None,
                },
            },
        };
        let formats = vec![make_format(vec![rule])];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 1);
        assert!(matches!(
            result[0].kind,
            crate::cf::types::CFRuleKind::ColorScale(_)
        ));
    }

    #[test]
    fn test_convert_data_bar_rule_accepts_ooxml_blank_threshold_colors() {
        use cell_types::SheetRange;
        use crate::cf::types::CFRuleKind;
        use value_types::Color;

        let blank_min = cf::CFColorPoint {
            value: cf::CFValueRef::Min,
            color: String::new(),
            ..Default::default()
        };
        let invalid_max = cf::CFColorPoint {
            value: cf::CFValueRef::Max,
            color: "not-a-color".to_string(),
            ..Default::default()
        };
        let rule = cf::CFRule::DataBar {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            data_bar: cf::CFDataBar {
                min_point: blank_min,
                max_point: invalid_max,
                min_length: None,
                max_length: None,
                positive_color: "004472C4".to_string(),
                negative_color: None,
                border_color: None,
                show_border: None,
                gradient: None,
                direction: None,
                axis_position: None,
                axis_color: None,
                show_value: None,
                match_positive_fill_color: None,
                match_positive_border_color: None,
                ext_id: None,
            },
        };
        let format = ConditionalFormat {
            id: "fmt1".to_string(),
            sheet_id: TEST_SHEET_UUID.to_string(),
            pivot: None,
            range_identities: None,
            ranges: vec![SheetRange::new(1, 0, 10, 0)],
            rules: vec![rule],
        };

        let result = convert_cf_formats_to_rules(&[format], no_resolve, None);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].ranges[0].start_row(), 1);
        assert_eq!(result[0].ranges[0].start_col(), 0);
        assert_eq!(result[0].ranges[0].end_row(), 10);
        assert_eq!(result[0].ranges[0].end_col(), 0);
        match &result[0].kind {
            CFRuleKind::DataBar(data_bar) => {
                let expected = Color::from_hex("004472C4").unwrap();
                assert_eq!(data_bar.positive_color, expected);
                assert_eq!(data_bar.min_point.color, expected);
                assert_eq!(data_bar.max_point.color, expected);
            }
            other => panic!("expected data bar rule, got {other:?}"),
        }
    }

    #[test]
    fn test_convert_contains_text_rule() {
        use ooxml_types::cond_format::CfOperator;
        let rule = cf::CFRule::ContainsText {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::BeginsWith,
            text: "hello".to_string(),
            style: make_style(),
            formula: None,
        };
        let formats = vec![make_format(vec![rule])];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 1);
        assert!(matches!(
            result[0].kind,
            crate::cf::types::CFRuleKind::ContainsText { .. }
        ));
    }

    #[test]
    fn test_convert_time_period_rule() {
        use ooxml_types::cond_format::CfTimePeriod;
        let rule = cf::CFRule::TimePeriod {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            time_period: CfTimePeriod::Today,
            style: make_style(),
            formula: None,
        };
        let formats = vec![make_format(vec![rule])];
        let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
        assert_eq!(result.len(), 1);
        assert!(matches!(
            result[0].kind,
            crate::cf::types::CFRuleKind::TimePeriod {
                period: DatePeriod::Today
            }
        ));
    }

    #[test]
    fn test_fallback_to_position_ranges() {
        use cell_types::SheetRange;

        let format = ConditionalFormat {
            id: "fmt1".to_string(),
            sheet_id: TEST_SHEET_UUID.to_string(),
            pivot: None,
            range_identities: None,
            ranges: vec![SheetRange::new(2, 1, 10, 4)],
            rules: vec![cf::CFRule::ContainsBlanks {
                id: "r1".to_string(),
                priority: 1,
                stop_if_true: None,
                blanks: true,
                style: make_style(),
                formula: None,
            }],
        };
        let result = convert_cf_formats_to_rules(&[format], no_resolve, None);
        assert_eq!(result.len(), 1);

        let expected_sheet_id = cell_types::SheetId::from_uuid_str(TEST_SHEET_UUID).unwrap();
        assert_eq!(result[0].ranges.len(), 1);
        assert_eq!(result[0].ranges[0].sheet(), expected_sheet_id);
        assert_eq!(result[0].ranges[0].start_row(), 2);
        assert_eq!(result[0].ranges[0].start_col(), 1);
        assert_eq!(result[0].ranges[0].end_row(), 10);
        assert_eq!(result[0].ranges[0].end_col(), 4);
    }

    #[test]
    fn test_range_identities_resolved_via_closure() {
        let tl_id = "00000000-0000-0000-0000-000000000001";
        let br_id = "00000000-0000-0000-0000-000000000002";

        let format = ConditionalFormat {
            id: "fmt1".to_string(),
            sheet_id: TEST_SHEET_UUID.to_string(),
            pivot: None,
            range_identities: Some(vec![
                domain_types::domain::conditional_format::CellIdRange {
                    top_left_cell_id: tl_id.to_string(),
                    bottom_right_cell_id: br_id.to_string(),
                },
            ]),
            ranges: vec![],
            rules: vec![cf::CFRule::ContainsBlanks {
                id: "r1".to_string(),
                priority: 1,
                stop_if_true: None,
                blanks: true,
                style: make_style(),
                formula: None,
            }],
        };

        // Resolver that maps our two known cell IDs to positions
        let resolver = |_sheet: &str, cell: &str| -> Option<(u32, u32)> {
            match cell {
                s if s == tl_id => Some((0, 0)),
                s if s == br_id => Some((5, 3)),
                _ => None,
            }
        };

        let result = convert_cf_formats_to_rules(&[format], resolver, None);
        assert_eq!(result.len(), 1);

        let expected_sheet_id = cell_types::SheetId::from_uuid_str(TEST_SHEET_UUID).unwrap();
        assert_eq!(result[0].ranges.len(), 1);
        assert_eq!(result[0].ranges[0].sheet(), expected_sheet_id);
        assert_eq!(result[0].ranges[0].start_row(), 0);
        assert_eq!(result[0].ranges[0].start_col(), 0);
        assert_eq!(result[0].ranges[0].end_row(), 5);
        assert_eq!(result[0].ranges[0].end_col(), 3);
    }

    #[test]
    fn test_range_identities_preferred_over_position_ranges() {
        use cell_types::SheetRange;

        let tl_id = "00000000-0000-0000-0000-000000000001";
        let br_id = "00000000-0000-0000-0000-000000000002";

        let format = ConditionalFormat {
            id: "fmt1".to_string(),
            sheet_id: TEST_SHEET_UUID.to_string(),
            pivot: None,
            range_identities: Some(vec![
                domain_types::domain::conditional_format::CellIdRange {
                    top_left_cell_id: tl_id.to_string(),
                    bottom_right_cell_id: br_id.to_string(),
                },
            ]),
            // Position-based ranges are different — should NOT be used
            ranges: vec![SheetRange::new(99, 99, 100, 100)],
            rules: vec![cf::CFRule::ContainsBlanks {
                id: "r1".to_string(),
                priority: 1,
                stop_if_true: None,
                blanks: true,
                style: make_style(),
                formula: None,
            }],
        };

        let resolver = |_sheet: &str, cell: &str| -> Option<(u32, u32)> {
            match cell {
                s if s == tl_id => Some((0, 0)),
                s if s == br_id => Some((5, 3)),
                _ => None,
            }
        };

        let result = convert_cf_formats_to_rules(&[format], resolver, None);
        assert_eq!(result.len(), 1);
        // Should use range_identities (0,0)→(5,3), NOT position ranges (99,99)→(100,100)
        assert_eq!(result[0].ranges[0].start_row(), 0);
        assert_eq!(result[0].ranges[0].end_row(), 5);
    }
}

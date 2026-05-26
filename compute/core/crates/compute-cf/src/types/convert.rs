//! Conversion logic from wire format to internal representation.

use value_types::Color;

use super::wire::{
    CFColorPointWire, CFColorScaleWire, CFDataBarWire, CFIconSetWire, CFIconThresholdWire,
};
use super::{
    CFColorPoint, CFColorScale, CFDataBar, CFIconSet, CFIconThreshold, CFOperator, CFRule,
    CFRuleKind, CFRuleType, CFRuleWire, CFTextOperator, CFValueType, CellValueComparison,
    CellValueSingleOp, CellValueThreshold, CfValue,
};

// =============================================================================
// Validation error
// =============================================================================

/// Validation error when converting from wire format to internal representation.
#[derive(Debug, Clone, PartialEq)]
pub enum CFRuleValidationError {
    MissingOperator,
    MissingFormula,
    MissingColorScale,
    MissingDataBar,
    MissingIconSet,
    MissingTimePeriod,
    MissingTextOperator,
    InvalidColor(String),
    InvalidThresholdValue(String),
    InvalidCellValueArity {
        operator: CFOperator,
        expected: usize,
        got: usize,
    },
    BetweenValuesNotNumeric {
        value: String,
    },
    DataBarMinLengthExceedsMax {
        min_length: u8,
        max_length: u8,
    },
    IconSetThresholdCountMismatch {
        expected: usize,
        got: usize,
    },
}

impl std::fmt::Display for CFRuleValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingOperator => write!(f, "CellValue rule requires 'operator' field"),
            Self::MissingFormula => write!(f, "Formula rule requires a non-empty 'formula' field"),
            Self::MissingColorScale => write!(f, "ColorScale rule requires 'colorScale' field"),
            Self::MissingDataBar => write!(f, "DataBar rule requires 'dataBar' field"),
            Self::MissingIconSet => write!(f, "IconSet rule requires 'iconSet' field"),
            Self::MissingTimePeriod => write!(f, "TimePeriod rule requires 'datePeriod' field"),
            Self::MissingTextOperator => {
                write!(f, "ContainsText rule requires 'textOperator' field")
            }
            Self::InvalidColor(color) => {
                write!(f, "Invalid color string: '{}'", color)
            }
            Self::InvalidThresholdValue(value) => {
                write!(
                    f,
                    "Invalid threshold value: '{}' is not a valid number",
                    value
                )
            }
            Self::InvalidCellValueArity {
                operator,
                expected,
                got,
            } => {
                write!(
                    f,
                    "CellValue operator {:?} requires {} value(s), got {}",
                    operator, expected, got
                )
            }
            Self::BetweenValuesNotNumeric { value } => {
                write!(f, "Between/NotBetween value '{}' is not numeric", value)
            }
            Self::DataBarMinLengthExceedsMax {
                min_length,
                max_length,
            } => {
                write!(
                    f,
                    "DataBar min_length ({}) exceeds max_length ({})",
                    min_length, max_length
                )
            }
            Self::IconSetThresholdCountMismatch { expected, got } => {
                write!(
                    f,
                    "IconSet threshold count mismatch: expected {}, got {}",
                    expected, got
                )
            }
        }
    }
}

impl std::error::Error for CFRuleValidationError {}

// =============================================================================
// Conversion helpers
// =============================================================================

/// Lower a typed color-point / icon-threshold operand to the `Option<f64>`
/// the internal representation stores.
///
/// * `Min` / `Max` value types carry no operand — always `None`.
/// * `Formula` operands try numeric coercion but tolerate failure (a
///   formula-string operand can't be reduced to an f64 until eval time).
/// * `Number` / `Percent` / `Percentile` operands must coerce — anything
///   that [`CfValue::as_number`] can't extract becomes
///   [`CFRuleValidationError::InvalidThresholdValue`].
///
/// Typed formula boundary: replaced the previous `Option<String>` signature that ran
/// every operand through `.parse::<f64>()`. Typed operands now dispatch on
/// the `CfValue` variant — `Bool(true)` cleanly yields `Some(1.0)` instead
/// of the former silent `NaN` fall-through.
fn parse_point_value(
    value_type: CFValueType,
    value: &Option<CfValue>,
) -> Result<Option<f64>, CFRuleValidationError> {
    match value_type {
        CFValueType::Min | CFValueType::Max => Ok(None),
        CFValueType::Formula => Ok(value.as_ref().and_then(CfValue::as_number)),
        CFValueType::Number | CFValueType::Percent | CFValueType::Percentile => match value {
            Some(v) => match v.as_number() {
                Some(n) => Ok(Some(n)),
                None => Err(CFRuleValidationError::InvalidThresholdValue(
                    v.display_text(),
                )),
            },
            None => Ok(None),
        },
    }
}

fn convert_color_point(wire: CFColorPointWire) -> Result<CFColorPoint, CFRuleValidationError> {
    let color = Color::from_hex(&wire.color)
        .map_err(|_| CFRuleValidationError::InvalidColor(wire.color.clone()))?;
    let value = parse_point_value(wire.value_type, &wire.value)?;
    Ok(CFColorPoint {
        value_type: wire.value_type,
        value,
        color,
    })
}

fn convert_color_scale(wire: CFColorScaleWire) -> Result<CFColorScale, CFRuleValidationError> {
    let min_point = convert_color_point(wire.min_point)?;
    let mid_point = wire.mid_point.map(convert_color_point).transpose()?;
    let max_point = convert_color_point(wire.max_point)?;
    Ok(CFColorScale {
        min_point,
        mid_point,
        max_point,
    })
}

fn convert_data_bar(wire: CFDataBarWire) -> Result<CFDataBar, CFRuleValidationError> {
    // Validate min_length <= max_length
    if wire.min_length > wire.max_length {
        return Err(CFRuleValidationError::DataBarMinLengthExceedsMax {
            min_length: wire.min_length,
            max_length: wire.max_length,
        });
    }

    let min_point = convert_color_point(wire.min_point)?;
    let max_point = convert_color_point(wire.max_point)?;

    let positive_color = Color::from_hex(&wire.positive_color)
        .map_err(|_| CFRuleValidationError::InvalidColor(wire.positive_color.clone()))?;

    let negative_color = wire
        .negative_color
        .map(|c| Color::from_hex(&c).map_err(|_| CFRuleValidationError::InvalidColor(c.clone())))
        .transpose()?;

    let border_color = wire
        .border_color
        .map(|c| Color::from_hex(&c).map_err(|_| CFRuleValidationError::InvalidColor(c.clone())))
        .transpose()?;

    let negative_border_color = wire
        .negative_border_color
        .map(|c| Color::from_hex(&c).map_err(|_| CFRuleValidationError::InvalidColor(c.clone())))
        .transpose()?;

    let axis_color = wire
        .axis_color
        .map(|c| Color::from_hex(&c).map_err(|_| CFRuleValidationError::InvalidColor(c.clone())))
        .transpose()?;

    Ok(CFDataBar {
        min_point,
        max_point,
        positive_color,
        negative_color,
        border_color,
        negative_border_color,
        show_border: wire.show_border,
        gradient: wire.gradient,
        direction: wire.direction,
        axis_position: wire.axis_position,
        axis_color,
        show_value: wire.show_value,
        min_length: wire.min_length,
        max_length: wire.max_length,
        match_positive_fill_color: wire.match_positive_fill_color,
        match_positive_border_color: wire.match_positive_border_color,
    })
}

fn convert_icon_threshold(
    wire: CFIconThresholdWire,
) -> Result<CFIconThreshold, CFRuleValidationError> {
    let value = parse_point_value(wire.value_type, &wire.value)?;
    Ok(CFIconThreshold {
        value_type: wire.value_type,
        value,
        operator: wire.operator,
        custom_icon: wire.custom_icon,
    })
}

fn convert_icon_set(wire: CFIconSetWire) -> Result<CFIconSet, CFRuleValidationError> {
    let expected = wire.icon_set_name.icon_count();
    // Only validate threshold count for standard icon sets (not NoIcons/Custom where icon_count==0)
    if expected > 0 {
        // Thresholds define boundaries between icons, so count = icon_count - 1
        let expected_thresholds = expected - 1;
        if wire.thresholds.len() != expected_thresholds {
            return Err(CFRuleValidationError::IconSetThresholdCountMismatch {
                expected: expected_thresholds,
                got: wire.thresholds.len(),
            });
        }
    }

    let thresholds = wire
        .thresholds
        .into_iter()
        .map(convert_icon_threshold)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(CFIconSet {
        icon_set_name: wire.icon_set_name,
        thresholds,
        reverse_order: wire.reverse_order,
        show_icon_only: wire.show_icon_only,
    })
}

fn convert_cell_value_comparison(
    operator: CFOperator,
    values: Vec<CfValue>,
) -> Result<CellValueComparison, CFRuleValidationError> {
    match operator {
        CFOperator::Between | CFOperator::NotBetween => {
            if values.len() != 2 {
                return Err(CFRuleValidationError::InvalidCellValueArity {
                    operator,
                    expected: 2,
                    got: values.len(),
                });
            }
            // `as_number` extracts a finite-or-NaN f64 per variant; we then
            // require the finite case. `CfValue::Bool(true)` → `Some(1.0)`
            // here, which is the behavioral fix this typed boundary needs
            // (previously: `"true".parse::<f64>()` → NaN fall-through).
            let a = values[0].as_number().ok_or_else(|| {
                CFRuleValidationError::BetweenValuesNotNumeric {
                    value: values[0].display_text(),
                }
            })?;
            let b = values[1].as_number().ok_or_else(|| {
                CFRuleValidationError::BetweenValuesNotNumeric {
                    value: values[1].display_text(),
                }
            })?;
            if !a.is_finite() {
                return Err(CFRuleValidationError::BetweenValuesNotNumeric {
                    value: values[0].display_text(),
                });
            }
            if !b.is_finite() {
                return Err(CFRuleValidationError::BetweenValuesNotNumeric {
                    value: values[1].display_text(),
                });
            }
            let low = a.min(b);
            let high = a.max(b);
            if operator == CFOperator::Between {
                Ok(CellValueComparison::Between { low, high })
            } else {
                Ok(CellValueComparison::NotBetween { low, high })
            }
        }
        _ => {
            if values.len() != 1 {
                return Err(CFRuleValidationError::InvalidCellValueArity {
                    operator,
                    expected: 1,
                    got: values.len(),
                });
            }
            let operand = values.into_iter().next().expect("arity validated above");
            // Reconstruct the `(text, number)` shape the evaluator reads.
            // Variant-aware: `Bool(true)` gets `number = Some(1.0)` AND
            // `text = "TRUE"` so both the numeric-compare and
            // case-insensitive string-compare paths behave correctly
            // against whatever shape the cell value takes.
            let number = operand.as_number();
            let text = operand.display_text();
            let single_op = match operator {
                CFOperator::GreaterThan => CellValueSingleOp::GreaterThan,
                CFOperator::LessThan => CellValueSingleOp::LessThan,
                CFOperator::GreaterThanOrEqual => CellValueSingleOp::GreaterThanOrEqual,
                CFOperator::LessThanOrEqual => CellValueSingleOp::LessThanOrEqual,
                CFOperator::Equal => CellValueSingleOp::Equal,
                CFOperator::NotEqual => CellValueSingleOp::NotEqual,
                CFOperator::Between | CFOperator::NotBetween => {
                    unreachable!("Between/NotBetween handled in outer match arm")
                }
            };
            Ok(CellValueComparison::Single {
                operator: single_op,
                threshold: CellValueThreshold { text, number },
            })
        }
    }
}

// =============================================================================
// TryFrom<CFRuleWire> for CFRule
// =============================================================================

impl TryFrom<CFRuleWire> for CFRule {
    type Error = CFRuleValidationError;

    fn try_from(wire: CFRuleWire) -> Result<Self, Self::Error> {
        let kind = match wire.rule_type {
            CFRuleType::CellValue => {
                let operator = wire
                    .operator
                    .ok_or(CFRuleValidationError::MissingOperator)?;
                let comparison = convert_cell_value_comparison(operator, wire.values)?;
                CFRuleKind::CellValue { comparison }
            }
            CFRuleType::Formula => {
                let formula = wire
                    .formula
                    .filter(|f| !f.trim().is_empty())
                    .ok_or(CFRuleValidationError::MissingFormula)?;
                CFRuleKind::Formula { formula }
            }
            CFRuleType::Top10 => CFRuleKind::Top10 {
                rank: wire.rank.unwrap_or(10),
                percent: wire.percent.unwrap_or(false),
                bottom: wire.bottom.unwrap_or(false),
            },
            CFRuleType::AboveAverage => CFRuleKind::AboveAverage {
                above: wire.above.unwrap_or(true),
                equal_average: wire.equal_average.unwrap_or(false),
                std_dev: wire.std_dev.unwrap_or(0),
            },
            CFRuleType::DuplicateValues => CFRuleKind::DuplicateValues {
                unique: wire.unique.unwrap_or(false),
            },
            CFRuleType::ContainsText => CFRuleKind::ContainsText {
                operator: wire
                    .text_operator
                    .ok_or(CFRuleValidationError::MissingTextOperator)?,
                text: wire.text.unwrap_or_default().to_lowercase(),
            },
            CFRuleType::NotContainsText => CFRuleKind::ContainsText {
                operator: CFTextOperator::NotContains,
                text: wire.text.unwrap_or_default().to_lowercase(),
            },
            CFRuleType::BeginsWith => CFRuleKind::ContainsText {
                operator: CFTextOperator::BeginsWith,
                text: wire.text.unwrap_or_default().to_lowercase(),
            },
            CFRuleType::EndsWith => CFRuleKind::ContainsText {
                operator: CFTextOperator::EndsWith,
                text: wire.text.unwrap_or_default().to_lowercase(),
            },
            CFRuleType::ContainsBlanks => CFRuleKind::ContainsBlanks {
                blanks: wire.blanks.unwrap_or(true),
            },
            CFRuleType::NotContainsBlanks => CFRuleKind::ContainsBlanks { blanks: false },
            CFRuleType::ContainsErrors => CFRuleKind::ContainsErrors {
                errors: wire.errors.unwrap_or(true),
            },
            CFRuleType::NotContainsErrors => CFRuleKind::ContainsErrors { errors: false },
            CFRuleType::TimePeriod => CFRuleKind::TimePeriod {
                period: wire
                    .date_period
                    .ok_or(CFRuleValidationError::MissingTimePeriod)?,
            },
            CFRuleType::ColorScale => {
                let wire_cs = wire
                    .color_scale
                    .ok_or(CFRuleValidationError::MissingColorScale)?;
                CFRuleKind::ColorScale(convert_color_scale(wire_cs)?)
            }
            CFRuleType::DataBar => {
                let wire_db = wire.data_bar.ok_or(CFRuleValidationError::MissingDataBar)?;
                CFRuleKind::DataBar(convert_data_bar(wire_db)?)
            }
            CFRuleType::IconSet => {
                let wire_is = wire.icon_set.ok_or(CFRuleValidationError::MissingIconSet)?;
                CFRuleKind::IconSet(convert_icon_set(wire_is)?)
            }
        };

        Ok(CFRule {
            priority: wire.priority,
            stop_if_true: wire.stop_if_true,
            ranges: wire.ranges,
            style: wire.style,
            kind,
        })
    }
}

// =============================================================================
// Tests: CfValue lowering (typed formula boundary)
// =============================================================================
//
// Exercises every `CfValue` variant through the two consumption points —
// `convert_cell_value_comparison` (cell-value rule thresholds) and
// `parse_point_value` (color-point / icon-threshold operands). Locks in the
// behavioral fix: `CfValue::Bool(true)`
// compared against a numeric operator no longer silently round-trips to
// `NaN` via `"true".parse::<f64>()`.

#[cfg(test)]
mod w8_regression_tests {
    use super::*;

    // ── convert_cell_value_comparison ────────────────────────────────────

    fn single_eq(v: CfValue) -> Result<CellValueComparison, CFRuleValidationError> {
        convert_cell_value_comparison(CFOperator::Equal, vec![v])
    }

    fn between(a: CfValue, b: CfValue) -> Result<CellValueComparison, CFRuleValidationError> {
        convert_cell_value_comparison(CFOperator::Between, vec![a, b])
    }

    #[test]
    fn single_number_preserves_numeric_path() {
        match single_eq(CfValue::Number { value: 42.0 }).unwrap() {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, Some(42.0));
                assert_eq!(threshold.text, "42");
            }
            _ => panic!("expected Single"),
        }
    }

    #[test]
    fn single_text_numeric_string_still_parses_numeric() {
        // Back-compat with the pre-W8 behavior where a JSON `"100"` string
        // threshold participated in numeric comparison via `.parse::<f64>()`.
        match single_eq(CfValue::Text {
            value: "100".into(),
        })
        .unwrap()
        {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, Some(100.0));
                assert_eq!(threshold.text, "100");
            }
            _ => panic!("expected Single"),
        }
    }

    #[test]
    fn single_text_non_numeric_is_text_only() {
        match single_eq(CfValue::Text {
            value: "apple".into(),
        })
        .unwrap()
        {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, None);
                assert_eq!(threshold.text, "apple");
            }
            _ => panic!("expected Single"),
        }
    }

    #[test]
    fn single_bool_true_fixes_nan_regression() {
        // Legacy behavior: `json_value_to_string(true)` →
        // `"true"` → `.parse::<f64>()` → fails → threshold.number = None → a
        // numeric cell compared against this threshold silently fell through
        // to the text-path `"TRUE"` vs whatever the cell formatted to.
        //
        // Post-W8: `CfValue::Bool(true)` → threshold.number = Some(1.0),
        // text = "TRUE" — both the numeric and string-compare paths are
        // consistent and Excel-shaped.
        match single_eq(CfValue::Bool { value: true }).unwrap() {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, Some(1.0));
                assert_eq!(threshold.text, "TRUE");
            }
            _ => panic!("expected Single"),
        }
    }

    #[test]
    fn single_bool_false_maps_to_zero() {
        match single_eq(CfValue::Bool { value: false }).unwrap() {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, Some(0.0));
                assert_eq!(threshold.text, "FALSE");
            }
            _ => panic!("expected Single"),
        }
    }

    #[test]
    fn single_null_yields_empty_text_threshold() {
        // Mirrors pre-W8: `Value::Null` → `""` → no numeric threshold.
        match single_eq(CfValue::Null).unwrap() {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, None);
                assert_eq!(threshold.text, "");
            }
            _ => panic!("expected Single"),
        }
    }

    #[test]
    fn single_formula_carries_source_text() {
        // Formula operands can't be numerically coerced at conversion time.
        // They flow through as the text form — the formula evaluator is not
        // involved here (CFRuleType::CellValue uses literal thresholds).
        match single_eq(CfValue::Formula {
            source: "=A1+1".into(),
        })
        .unwrap()
        {
            CellValueComparison::Single { threshold, .. } => {
                assert_eq!(threshold.number, None);
                assert_eq!(threshold.text, "=A1+1");
            }
            _ => panic!("expected Single"),
        }
    }

    // ── Between: all variants ────────────────────────────────────────────

    #[test]
    fn between_two_numbers_ok() {
        let cmp = between(
            CfValue::Number { value: 5.0 },
            CfValue::Number { value: 10.0 },
        )
        .unwrap();
        match cmp {
            CellValueComparison::Between { low, high } => {
                assert_eq!(low, 5.0);
                assert_eq!(high, 10.0);
            }
            _ => panic!("expected Between"),
        }
    }

    #[test]
    fn between_bool_and_number_ok() {
        // Post-W8: `Bool(true)` coerces cleanly to 1.0 and participates in
        // Between. Pre-W8 this would have been `NonNumeric`.
        let cmp = between(
            CfValue::Bool { value: true },
            CfValue::Number { value: 10.0 },
        )
        .unwrap();
        match cmp {
            CellValueComparison::Between { low, high } => {
                assert_eq!(low, 1.0);
                assert_eq!(high, 10.0);
            }
            _ => panic!("expected Between"),
        }
    }

    #[test]
    fn between_text_numeric_strings_ok() {
        // Back-compat: text-wrapped numeric strings still participate in Between.
        let cmp = between(
            CfValue::Text { value: "5".into() },
            CfValue::Text { value: "10".into() },
        )
        .unwrap();
        match cmp {
            CellValueComparison::Between { low, high } => {
                assert_eq!(low, 5.0);
                assert_eq!(high, 10.0);
            }
            _ => panic!("expected Between"),
        }
    }

    #[test]
    fn between_non_numeric_text_errors() {
        let err = between(
            CfValue::Text {
                value: "abc".into(),
            },
            CfValue::Number { value: 10.0 },
        )
        .unwrap_err();
        match err {
            CFRuleValidationError::BetweenValuesNotNumeric { value } => {
                assert_eq!(value, "abc");
            }
            other => panic!("expected BetweenValuesNotNumeric, got {other:?}"),
        }
    }

    #[test]
    fn between_null_errors_with_empty_text() {
        let err = between(CfValue::Null, CfValue::Number { value: 10.0 }).unwrap_err();
        match err {
            CFRuleValidationError::BetweenValuesNotNumeric { value } => {
                assert_eq!(value, "");
            }
            other => panic!("expected BetweenValuesNotNumeric, got {other:?}"),
        }
    }

    #[test]
    fn between_formula_errors() {
        // `Formula` operands can't be reduced to an f64 without invoking
        // the evaluator — `as_number` returns None, so the typed path
        // surfaces a clean error.
        let err = between(
            CfValue::Formula {
                source: "=A1".into(),
            },
            CfValue::Number { value: 10.0 },
        )
        .unwrap_err();
        match err {
            CFRuleValidationError::BetweenValuesNotNumeric { value } => {
                assert_eq!(value, "=A1");
            }
            other => panic!("expected BetweenValuesNotNumeric, got {other:?}"),
        }
    }

    // ── parse_point_value ────────────────────────────────────────────────

    #[test]
    fn point_value_number_variant_returns_f64() {
        let out =
            parse_point_value(CFValueType::Number, &Some(CfValue::Number { value: 42.0 })).unwrap();
        assert_eq!(out, Some(42.0));
    }

    #[test]
    fn point_value_bool_variant_coerces() {
        let out =
            parse_point_value(CFValueType::Percent, &Some(CfValue::Bool { value: true })).unwrap();
        assert_eq!(out, Some(1.0));
    }

    #[test]
    fn point_value_text_numeric_parses() {
        let out = parse_point_value(
            CFValueType::Percentile,
            &Some(CfValue::Text { value: "75".into() }),
        )
        .unwrap();
        assert_eq!(out, Some(75.0));
    }

    #[test]
    fn point_value_text_non_numeric_errors() {
        let err = parse_point_value(
            CFValueType::Number,
            &Some(CfValue::Text {
                value: "xyz".into(),
            }),
        )
        .unwrap_err();
        match err {
            CFRuleValidationError::InvalidThresholdValue(s) => assert_eq!(s, "xyz"),
            other => panic!("expected InvalidThresholdValue, got {other:?}"),
        }
    }

    #[test]
    fn point_value_null_variant_errors_for_numeric_types() {
        let err = parse_point_value(CFValueType::Number, &Some(CfValue::Null)).unwrap_err();
        assert!(matches!(
            err,
            CFRuleValidationError::InvalidThresholdValue(_)
        ));
    }

    #[test]
    fn point_value_formula_variant_returns_none_tolerantly() {
        // Formula value-type: `as_number` returns None, `parse_point_value`
        // tolerates failure. Same behavior as pre-W8's `.parse::<f64>().ok()`.
        let out = parse_point_value(
            CFValueType::Formula,
            &Some(CfValue::Formula {
                source: "=A1+1".into(),
            }),
        )
        .unwrap();
        assert_eq!(out, None);
    }

    #[test]
    fn point_value_min_max_always_none() {
        // Min / Max types compute the operand from data; stored operand
        // (if any) is ignored.
        assert_eq!(
            parse_point_value(CFValueType::Min, &Some(CfValue::Number { value: 1.0 })).unwrap(),
            None
        );
        assert_eq!(
            parse_point_value(CFValueType::Max, &Some(CfValue::Bool { value: true })).unwrap(),
            None
        );
    }

    // ── End-to-end through TryFrom<CFRuleWire> ───────────────────────────

    #[test]
    fn end_to_end_bool_between_rule_via_try_from() {
        use crate::types::{CFOperator, CFRuleKind, CFRuleType, CFRuleWire, CellValueComparison};
        let wire = CFRuleWire {
            rule_type: CFRuleType::CellValue,
            priority: 1,
            stop_if_true: false,
            style: None,
            operator: Some(CFOperator::Between),
            values: vec![
                CfValue::Bool { value: false },
                CfValue::Number { value: 10.0 },
            ],
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
            ranges: vec![],
        };
        let rule = crate::types::CFRule::try_from(wire).expect("should convert");
        match rule.kind {
            CFRuleKind::CellValue {
                comparison: CellValueComparison::Between { low, high },
            } => {
                // Bool(false) → 0.0, preserved Excel coercion semantics.
                assert_eq!(low, 0.0);
                assert_eq!(high, 10.0);
            }
            other => panic!("unexpected rule kind: {other:?}"),
        }
    }
}

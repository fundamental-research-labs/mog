//! Yrs schema for [`ConditionalFormat`] — unified conditional formatting.
//!
//! Top-level ConditionalFormat is a Y.Map with scalar fields + JSON-serialized
//! ranges. Rules live in a Y.Array of Y.Maps (one per rule), managed by the
//! caller (cf_store). Each rule Y.Map uses a `"type"` discriminator to select
//! the variant, with variant-specific fields stored as native Yrs keys.
//!
//! **Critical:** Every formula-bearing variant (ContainsText, ContainsBlanks,
//! ContainsErrors, TimePeriod, AboveAverage) ALWAYS reads and writes its
//! `"formula"` key. This fixes the old `formula: _` bug that silently dropped
//! formulas during round-trip.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn};

use super::helpers::*;
use crate::domain::conditional_format::*;
use ooxml_types::cond_format::{CfOperator, CfTimePeriod};

// =============================================================================
// Y.Map key constants — top-level ConditionalFormat
// =============================================================================

pub const KEY_ID: &str = "id";
pub const KEY_SHEET_ID: &str = "sheetId";
pub const KEY_PIVOT: &str = "pivot";
pub const KEY_RANGES: &str = "ranges";
pub const KEY_RANGE_IDENTITIES: &str = "rangeIdentities";

// =============================================================================
// Y.Map key constants — CFRule fields
// =============================================================================

pub const KEY_TYPE: &str = "type";
pub const KEY_RULE_ID: &str = "id";
pub const KEY_PRIORITY: &str = "priority";
pub const KEY_STOP_IF_TRUE: &str = "stopIfTrue";
pub const KEY_OPERATOR: &str = "operator";
pub const KEY_VALUE1: &str = "value1";
pub const KEY_VALUE2: &str = "value2";
pub const KEY_STYLE: &str = "style";
pub const KEY_FORMULA: &str = "formula";
pub const KEY_TEXT: &str = "text";
pub const KEY_COLOR_SCALE: &str = "colorScale";
pub const KEY_DATA_BAR: &str = "dataBar";
pub const KEY_ICON_SET: &str = "iconSet";
pub const KEY_RANK: &str = "rank";
pub const KEY_PERCENT: &str = "percent";
pub const KEY_BOTTOM: &str = "bottom";
pub const KEY_ABOVE_AVERAGE: &str = "aboveAverage";
pub const KEY_EQUAL_AVERAGE: &str = "equalAverage";
pub const KEY_STD_DEV: &str = "stdDev";
pub const KEY_UNIQUE: &str = "unique";
pub const KEY_BLANKS: &str = "blanks";
pub const KEY_ERRORS: &str = "errors";
pub const KEY_TIME_PERIOD: &str = "timePeriod";

// =============================================================================
// Type discriminator values (match serde tag names)
// =============================================================================

pub const TYPE_CELL_VALUE: &str = "cellValue";
pub const TYPE_FORMULA: &str = "formula";
pub const TYPE_COLOR_SCALE: &str = "colorScale";
pub const TYPE_DATA_BAR: &str = "dataBar";
pub const TYPE_ICON_SET: &str = "iconSet";
pub const TYPE_TOP10: &str = "top10";
pub const TYPE_ABOVE_AVERAGE: &str = "aboveAverage";
pub const TYPE_DUPLICATE_VALUES: &str = "duplicateValues";
pub const TYPE_CONTAINS_TEXT: &str = "containsText";
pub const TYPE_CONTAINS_BLANKS: &str = "containsBlanks";
pub const TYPE_CONTAINS_ERRORS: &str = "containsErrors";
pub const TYPE_TIME_PERIOD: &str = "timePeriod";

// =============================================================================
// Top-level: ConditionalFormat → Y.Map prelim
// =============================================================================

/// Convert a [`ConditionalFormat`] to Yrs prelim entries (top-level fields only).
/// Rules are NOT included — the caller inserts them into a Y.Array separately.
pub fn cf_to_yrs_prelim(cf: &ConditionalFormat) -> Vec<(&str, Any)> {
    let ranges_json = serde_json::to_string(&cf.ranges).unwrap_or_default();

    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(cf.id.as_str()))),
        (KEY_SHEET_ID, Any::String(Arc::from(cf.sheet_id.as_str()))),
        (KEY_RANGES, Any::String(Arc::from(ranges_json.as_str()))),
    ];

    if let Some(pivot) = cf.pivot {
        entries.push((KEY_PIVOT, Any::Bool(pivot)));
    }

    if let Some(ref identities) = cf.range_identities {
        let json = serde_json::to_string(identities).unwrap_or_default();
        entries.push((KEY_RANGE_IDENTITIES, Any::String(Arc::from(json.as_str()))));
    }

    entries
}

// =============================================================================
// CFRule → Y.Map prelim
// =============================================================================

/// Convert a [`CFRule`] to Yrs prelim entries.
///
/// The `"type"` discriminator is always the first entry so observers can
/// dispatch without reading the entire map.
pub fn rule_to_yrs_prelim(rule: &CFRule) -> Vec<(&str, Any)> {
    match rule {
        CFRule::CellValue {
            id,
            priority,
            stop_if_true,
            operator,
            value1,
            value2,
            style,
            text,
        } => {
            let mut e = rule_common(TYPE_CELL_VALUE, id, *priority, stop_if_true);
            e.push((KEY_OPERATOR, Any::String(Arc::from(operator.to_ooxml()))));
            e.push((KEY_VALUE1, json_value_to_any(value1)));
            if let Some(v2) = value2 {
                e.push((KEY_VALUE2, json_value_to_any(v2)));
            }
            e.push((KEY_STYLE, json_to_any_string(style)));
            if let Some(t) = text {
                e.push(("text", Any::String(Arc::from(t.as_str()))));
            }
            e
        }
        CFRule::Formula {
            id,
            priority,
            stop_if_true,
            formula,
            style,
            text,
        } => {
            let mut e = rule_common(TYPE_FORMULA, id, *priority, stop_if_true);
            e.push((KEY_FORMULA, Any::String(Arc::from(formula.as_str()))));
            e.push((KEY_STYLE, json_to_any_string(style)));
            if let Some(t) = text {
                e.push((KEY_TEXT, Any::String(Arc::from(t.as_str()))));
            }
            e
        }
        CFRule::ColorScale {
            id,
            priority,
            stop_if_true,
            color_scale,
        } => {
            let mut e = rule_common(TYPE_COLOR_SCALE, id, *priority, stop_if_true);
            e.push((KEY_COLOR_SCALE, json_to_any_string(color_scale)));
            e
        }
        CFRule::DataBar {
            id,
            priority,
            stop_if_true,
            data_bar,
        } => {
            let mut e = rule_common(TYPE_DATA_BAR, id, *priority, stop_if_true);
            e.push((KEY_DATA_BAR, json_to_any_string(data_bar)));
            e
        }
        CFRule::IconSet {
            id,
            priority,
            stop_if_true,
            icon_set,
        } => {
            let mut e = rule_common(TYPE_ICON_SET, id, *priority, stop_if_true);
            e.push((KEY_ICON_SET, json_to_any_string(icon_set)));
            e
        }
        CFRule::Top10 {
            id,
            priority,
            stop_if_true,
            rank,
            percent,
            bottom,
            style,
        } => {
            let mut e = rule_common(TYPE_TOP10, id, *priority, stop_if_true);
            e.push((KEY_RANK, Any::Number(*rank as f64)));
            e.push((KEY_PERCENT, option_bool(percent)));
            e.push((KEY_BOTTOM, option_bool(bottom)));
            e.push((KEY_STYLE, json_to_any_string(style)));
            e
        }
        CFRule::AboveAverage {
            id,
            priority,
            stop_if_true,
            above_average,
            equal_average,
            std_dev,
            style,
            formula,
        } => {
            let mut e = rule_common(TYPE_ABOVE_AVERAGE, id, *priority, stop_if_true);
            e.push((KEY_ABOVE_AVERAGE, Any::Bool(*above_average)));
            e.push((KEY_EQUAL_AVERAGE, option_bool(equal_average)));
            e.push((KEY_STD_DEV, option_i32(std_dev)));
            e.push((KEY_STYLE, json_to_any_string(style)));
            // CRITICAL: always write formula (fixes the formula: _ bug)
            e.push((KEY_FORMULA, option_string(formula)));
            e
        }
        CFRule::DuplicateValues {
            id,
            priority,
            stop_if_true,
            unique,
            style,
        } => {
            let mut e = rule_common(TYPE_DUPLICATE_VALUES, id, *priority, stop_if_true);
            e.push((KEY_UNIQUE, option_bool(unique)));
            e.push((KEY_STYLE, json_to_any_string(style)));
            e
        }
        CFRule::ContainsText {
            id,
            priority,
            stop_if_true,
            operator,
            text,
            style,
            formula,
        } => {
            let mut e = rule_common(TYPE_CONTAINS_TEXT, id, *priority, stop_if_true);
            e.push((KEY_OPERATOR, Any::String(Arc::from(operator.to_ooxml()))));
            e.push((KEY_TEXT, Any::String(Arc::from(text.as_str()))));
            e.push((KEY_STYLE, json_to_any_string(style)));
            // CRITICAL: always write formula (fixes the formula: _ bug)
            e.push((KEY_FORMULA, option_string(formula)));
            e
        }
        CFRule::ContainsBlanks {
            id,
            priority,
            stop_if_true,
            blanks,
            style,
            formula,
        } => {
            let mut e = rule_common(TYPE_CONTAINS_BLANKS, id, *priority, stop_if_true);
            e.push((KEY_BLANKS, Any::Bool(*blanks)));
            e.push((KEY_STYLE, json_to_any_string(style)));
            // CRITICAL: always write formula (fixes the formula: _ bug)
            e.push((KEY_FORMULA, option_string(formula)));
            e
        }
        CFRule::ContainsErrors {
            id,
            priority,
            stop_if_true,
            errors,
            style,
            formula,
        } => {
            let mut e = rule_common(TYPE_CONTAINS_ERRORS, id, *priority, stop_if_true);
            e.push((KEY_ERRORS, Any::Bool(*errors)));
            e.push((KEY_STYLE, json_to_any_string(style)));
            // CRITICAL: always write formula (fixes the formula: _ bug)
            e.push((KEY_FORMULA, option_string(formula)));
            e
        }
        CFRule::TimePeriod {
            id,
            priority,
            stop_if_true,
            time_period,
            style,
            formula,
        } => {
            let mut e = rule_common(TYPE_TIME_PERIOD, id, *priority, stop_if_true);
            e.push((
                KEY_TIME_PERIOD,
                Any::String(Arc::from(time_period.to_ooxml())),
            ));
            e.push((KEY_STYLE, json_to_any_string(style)));
            // CRITICAL: always write formula (fixes the formula: _ bug)
            e.push((KEY_FORMULA, option_string(formula)));
            e
        }
    }
}

// =============================================================================
// Y.Map → ConditionalFormat (top-level only, rules populated by caller)
// =============================================================================

/// Read a [`ConditionalFormat`] from a Y.Map. Returns `None` if required
/// fields (`id`, `sheetId`) are missing. The `rules` vec is always empty —
/// the caller populates it from the Y.Array of rule maps.
pub fn cf_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<ConditionalFormat> {
    let id = read_string(map, txn, KEY_ID)?;
    let sheet_id = read_string(map, txn, KEY_SHEET_ID)?;
    let pivot = read_bool(map, txn, KEY_PIVOT);

    let ranges: Vec<CFCellRange> = read_string(map, txn, KEY_RANGES)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let range_identities: Option<Vec<CellIdRange>> =
        read_string(map, txn, KEY_RANGE_IDENTITIES).and_then(|s| serde_json::from_str(&s).ok());

    Some(ConditionalFormat {
        id,
        sheet_id,
        pivot,
        ranges,
        range_identities,
        rules: Vec::new(),
    })
}

// =============================================================================
// Y.Map → CFRule
// =============================================================================

/// Read a [`CFRule`] from a Y.Map. Returns `None` if the `"type"`
/// discriminator is missing or unrecognised.
pub fn rule_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<CFRule> {
    let rule_type = read_string(map, txn, KEY_TYPE)?;
    let id = read_string(map, txn, KEY_RULE_ID)?;
    let priority = read_i32(map, txn, KEY_PRIORITY).unwrap_or(0);
    let stop_if_true = read_bool(map, txn, KEY_STOP_IF_TRUE);

    match rule_type.as_str() {
        TYPE_CELL_VALUE => {
            // Strict parse: silently-defaulting an unknown operator would
            // change `>=` rules into `<` rules (data corruption). Drop the
            // whole rule with loud context on unknown input.
            let op_str = read_string(map, txn, KEY_OPERATOR)?;
            let operator = match CfOperator::from_ooxml_token(&op_str) {
                Some(op) => op,
                None => {
                    tracing::warn!(
                        rule_id = %id,
                        rule_type = TYPE_CELL_VALUE,
                        operator = %op_str,
                        "unknown CfOperator token in stored Yrs CF rule; dropping rule"
                    );
                    return None;
                }
            };
            let value1 = read_json_value(map, txn, KEY_VALUE1).unwrap_or(serde_json::Value::Null);
            let value2 = read_json_value(map, txn, KEY_VALUE2);
            let style = read_style(map, txn);
            let text = read_string(map, txn, "text");
            Some(CFRule::CellValue {
                id,
                priority,
                stop_if_true,
                operator,
                value1,
                value2,
                style,
                text,
            })
        }
        TYPE_FORMULA => {
            let formula = read_string(map, txn, KEY_FORMULA)?;
            let style = read_style(map, txn);
            Some(CFRule::Formula {
                id,
                priority,
                stop_if_true,
                formula,
                style,
                text: read_string(map, txn, KEY_TEXT),
            })
        }
        TYPE_COLOR_SCALE => {
            let color_scale: CFColorScale = read_json_obj(map, txn, KEY_COLOR_SCALE)?;
            Some(CFRule::ColorScale {
                id,
                priority,
                stop_if_true,
                color_scale,
            })
        }
        TYPE_DATA_BAR => {
            let data_bar: CFDataBar = read_json_obj(map, txn, KEY_DATA_BAR)?;
            Some(CFRule::DataBar {
                id,
                priority,
                stop_if_true,
                data_bar,
            })
        }
        TYPE_ICON_SET => {
            let icon_set: CFIconSet = read_json_obj(map, txn, KEY_ICON_SET)?;
            Some(CFRule::IconSet {
                id,
                priority,
                stop_if_true,
                icon_set,
            })
        }
        TYPE_TOP10 => {
            let rank = read_u32(map, txn, KEY_RANK).unwrap_or(10);
            let percent = read_bool(map, txn, KEY_PERCENT);
            let bottom = read_bool(map, txn, KEY_BOTTOM);
            let style = read_style(map, txn);
            Some(CFRule::Top10 {
                id,
                priority,
                stop_if_true,
                rank,
                percent,
                bottom,
                style,
            })
        }
        TYPE_ABOVE_AVERAGE => {
            let above_average = read_bool(map, txn, KEY_ABOVE_AVERAGE).unwrap_or(true);
            let equal_average = read_bool(map, txn, KEY_EQUAL_AVERAGE);
            let std_dev = read_i32(map, txn, KEY_STD_DEV);
            let style = read_style(map, txn);
            // CRITICAL: read formula (fixes the formula: _ bug)
            let formula = read_string(map, txn, KEY_FORMULA);
            Some(CFRule::AboveAverage {
                id,
                priority,
                stop_if_true,
                above_average,
                equal_average,
                std_dev,
                style,
                formula,
            })
        }
        TYPE_DUPLICATE_VALUES => {
            let unique = read_bool(map, txn, KEY_UNIQUE);
            let style = read_style(map, txn);
            Some(CFRule::DuplicateValues {
                id,
                priority,
                stop_if_true,
                unique,
                style,
            })
        }
        TYPE_CONTAINS_TEXT => {
            let op_str = read_string(map, txn, KEY_OPERATOR)?;
            let operator = match CfOperator::from_ooxml_token(&op_str) {
                Some(op) => op,
                None => {
                    tracing::warn!(
                        rule_id = %id,
                        rule_type = TYPE_CONTAINS_TEXT,
                        operator = %op_str,
                        "unknown CfOperator token in stored Yrs CF rule; dropping rule"
                    );
                    return None;
                }
            };
            let text = read_string(map, txn, KEY_TEXT).unwrap_or_default();
            let style = read_style(map, txn);
            // CRITICAL: read formula (fixes the formula: _ bug)
            let formula = read_string(map, txn, KEY_FORMULA);
            Some(CFRule::ContainsText {
                id,
                priority,
                stop_if_true,
                operator,
                text,
                style,
                formula,
            })
        }
        TYPE_CONTAINS_BLANKS => {
            let blanks = read_bool(map, txn, KEY_BLANKS).unwrap_or(true);
            let style = read_style(map, txn);
            // CRITICAL: read formula (fixes the formula: _ bug)
            let formula = read_string(map, txn, KEY_FORMULA);
            Some(CFRule::ContainsBlanks {
                id,
                priority,
                stop_if_true,
                blanks,
                style,
                formula,
            })
        }
        TYPE_CONTAINS_ERRORS => {
            let errors = read_bool(map, txn, KEY_ERRORS).unwrap_or(true);
            let style = read_style(map, txn);
            // CRITICAL: read formula (fixes the formula: _ bug)
            let formula = read_string(map, txn, KEY_FORMULA);
            Some(CFRule::ContainsErrors {
                id,
                priority,
                stop_if_true,
                errors,
                style,
                formula,
            })
        }
        TYPE_TIME_PERIOD => {
            let tp_str = read_string(map, txn, KEY_TIME_PERIOD)?;
            let time_period = match CfTimePeriod::from_ooxml_token(&tp_str) {
                Some(tp) => tp,
                None => {
                    tracing::warn!(
                        rule_id = %id,
                        rule_type = TYPE_TIME_PERIOD,
                        time_period = %tp_str,
                        "unknown CfTimePeriod token in stored Yrs CF rule; dropping rule"
                    );
                    return None;
                }
            };
            let style = read_style(map, txn);
            // CRITICAL: read formula (fixes the formula: _ bug)
            let formula = read_string(map, txn, KEY_FORMULA);
            Some(CFRule::TimePeriod {
                id,
                priority,
                stop_if_true,
                time_period,
                style,
                formula,
            })
        }
        _ => None,
    }
}

// =============================================================================
// Private helpers
// =============================================================================

/// Build common rule prelim entries: type, id, priority, stopIfTrue.
fn rule_common<'a>(
    type_str: &'a str,
    id: &'a str,
    priority: i32,
    stop_if_true: &Option<bool>,
) -> Vec<(&'a str, Any)> {
    let mut entries = vec![
        (KEY_TYPE, Any::String(Arc::from(type_str))),
        (KEY_RULE_ID, Any::String(Arc::from(id))),
        (KEY_PRIORITY, Any::Number(priority as f64)),
    ];
    entries.push((KEY_STOP_IF_TRUE, option_bool(stop_if_true)));
    entries
}

/// Serialize a serde-serializable value to a JSON string stored as Yrs Any::String.
fn json_to_any_string<T: serde::Serialize>(val: &T) -> Any {
    let json = serde_json::to_string(val).unwrap_or_default();
    Any::String(Arc::from(json.as_str()))
}

/// Convert a serde_json::Value to Yrs Any, using String representation for
/// non-primitive values and native types for primitives.
fn json_value_to_any(val: &serde_json::Value) -> Any {
    match val {
        serde_json::Value::Null => Any::Null,
        serde_json::Value::Bool(b) => Any::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                Any::Number(f)
            } else {
                Any::String(Arc::from(n.to_string().as_str()))
            }
        }
        serde_json::Value::String(s) => Any::String(Arc::from(s.as_str())),
        // Arrays and objects get serialized as JSON strings
        _ => {
            let json = serde_json::to_string(val).unwrap_or_default();
            Any::String(Arc::from(json.as_str()))
        }
    }
}

/// Read a serde_json::Value from a Y.Map, reversing json_value_to_any.
fn read_json_value<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<serde_json::Value> {
    match map.get(txn, key)? {
        yrs::Out::Any(Any::Null) => Some(serde_json::Value::Null),
        yrs::Out::Any(Any::Bool(b)) => Some(serde_json::Value::Bool(b)),
        yrs::Out::Any(Any::Number(n)) => Some(serde_json::Value::Number(
            serde_json::Number::from_f64(n).unwrap_or_else(|| serde_json::Number::from(0)),
        )),
        yrs::Out::Any(Any::String(s)) => {
            // Try parsing as JSON first (could be array/object), fall back to string
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&s) {
                // Only accept structured types from JSON parse; plain strings would
                // successfully parse as JSON strings too but we already have the value.
                match &parsed {
                    serde_json::Value::Array(_) | serde_json::Value::Object(_) => Some(parsed),
                    _ => Some(serde_json::Value::String(s.to_string())),
                }
            } else {
                Some(serde_json::Value::String(s.to_string()))
            }
        }
        _ => None,
    }
}

/// Read a JSON-serialized object from a Y.Map string field.
fn read_json_obj<T: ReadTxn, D: serde::de::DeserializeOwned>(
    map: &MapRef,
    txn: &T,
    key: &str,
) -> Option<D> {
    let s = read_string(map, txn, key)?;
    match serde_json::from_str::<D>(&s) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(
                yrs_key = key,
                error = %e,
                target_type = std::any::type_name::<D>(),
                stored_bytes = %s,
                "JSON deserialization failed for stored Yrs value; dropping field/rule"
            );
            None
        }
    }
}

/// Read a CFStyle from the Y.Map `"style"` key (JSON-serialized).
fn read_style<T: ReadTxn>(map: &MapRef, txn: &T) -> CFStyle {
    read_json_obj(map, txn, KEY_STYLE).unwrap_or_default()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::cond_format::{
        CfOperator, CfTimePeriod, CfvoType, DataBarAxisPosition, DataBarDirection, IconSetType,
    };
    use yrs::{Doc, Transact};

    /// Write a `CFRule` prelim to a fresh Y.Map, then read it back, and
    /// assert equality. Locks the Round-D invariant that typed enum fields
    /// survive Yrs serialization byte-for-byte.
    fn yrs_roundtrip(rule: CFRule) {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("rule");
        {
            let mut txn = doc.transact_mut();
            for (k, v) in rule_to_yrs_prelim(&rule) {
                map.insert(&mut txn, k, v);
            }
        }
        let txn = doc.transact();
        let roundtripped = rule_from_yrs_map(&map, &txn).expect("roundtrip failed");
        assert_eq!(roundtripped, rule);
    }

    #[test]
    fn yrs_roundtrip_cell_value_typed_operator() {
        // Use a string value1 — Yrs' Any::Number is f64-only, so an integer
        // literal like `100` round-trips as `100.0`. That's a pre-existing
        // json_value_to_any <-> read_json_value quirk, orthogonal to Round-D
        // operator typing. Strings survive unchanged.
        yrs_roundtrip(CFRule::CellValue {
            id: "r1".into(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::Value::String("100".into()),
            value2: None,
            style: CFStyle::default(),
            text: None,
        });
    }

    #[test]
    fn yrs_roundtrip_contains_text_typed_operator() {
        yrs_roundtrip(CFRule::ContainsText {
            id: "r2".into(),
            priority: 2,
            stop_if_true: Some(true),
            operator: CfOperator::BeginsWith,
            text: "hello".into(),
            style: CFStyle::default(),
            formula: Some("LEFT(A1,5)=\"hello\"".into()),
        });
    }

    #[test]
    fn yrs_roundtrip_time_period_typed() {
        yrs_roundtrip(CFRule::TimePeriod {
            id: "r3".into(),
            priority: 3,
            stop_if_true: None,
            time_period: CfTimePeriod::Last7Days,
            style: CFStyle::default(),
            formula: None,
        });
    }

    /// Data bar + icon set + color scale Yrs round-trips go through JSON
    /// serialization (see `json_to_any_string` in the prelim writer), so
    /// this test exercises both the Any::String wrap and the serde enum
    /// rename round-trip in one pass.
    #[test]
    fn yrs_roundtrip_data_bar_with_typed_direction_and_axis() {
        yrs_roundtrip(CFRule::DataBar {
            id: "r4".into(),
            priority: 4,
            stop_if_true: None,
            data_bar: CFDataBar {
                min_point: CFColorPoint {
                    value: crate::domain::conditional_format::CFValueRef::Min,
                    color: "".into(),
                    ..Default::default()
                },
                max_point: CFColorPoint {
                    value: crate::domain::conditional_format::CFValueRef::Max,
                    color: "".into(),
                    ..Default::default()
                },
                min_length: None,
                max_length: None,
                positive_color: "#638EC6".into(),
                direction: Some(DataBarDirection::LeftToRight),
                axis_position: Some(DataBarAxisPosition::Middle),
                negative_color: None,
                border_color: None,
                negative_border_color: None,
                show_border: None,
                gradient: Some(true),
                axis_color: None,
                show_value: Some(true),
                match_positive_fill_color: None,
                match_positive_border_color: None,
                ext_id: None,
            },
        });
    }

    #[test]
    fn yrs_roundtrip_icon_set_with_typed_name_and_cfvo() {
        yrs_roundtrip(CFRule::IconSet {
            id: "r5".into(),
            priority: 5,
            stop_if_true: None,
            icon_set: CFIconSet {
                icon_set_name: IconSetType::ThreeArrows,
                reverse_order: Some(false),
                show_icon_only: None,
                percent: None,
                thresholds: vec![
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("33".into()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("67".into()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                ],
                custom_icons: vec![],
            },
        });
    }
}

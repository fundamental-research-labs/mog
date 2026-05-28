//! YrsSchema for ValidationSpec — data validation rules.
//!
//! Each validation is one Y.Map with all fields stored as native keys.
//! The ValidationRule enum is decomposed into flat keys (ruleType, operator,
//! formula1, formula2, showDropdown) for collaborative editing.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::*;
use crate::domain::validation::*;

// ── Y.Map keys ───────────────────────────────────────────────────────
pub const KEY_RULE_TYPE: &str = "ruleType";
pub const KEY_OPERATOR: &str = "operator";
pub const KEY_FORMULA1: &str = "formula1";
pub const KEY_FORMULA2: &str = "formula2";
pub const KEY_ERROR_STYLE: &str = "errorStyle";
pub const KEY_SHOW_ERROR: &str = "showError";
pub const KEY_ERROR_TITLE: &str = "errorTitle";
pub const KEY_ERROR_MESSAGE: &str = "errorMessage";
pub const KEY_SHOW_PROMPT: &str = "showPrompt";
pub const KEY_PROMPT_TITLE: &str = "promptTitle";
pub const KEY_PROMPT_MESSAGE: &str = "promptMessage";
pub const KEY_ALLOW_BLANK: &str = "allowBlank";
pub const KEY_SHOW_DROPDOWN: &str = "showDropdown";
pub const KEY_RANGES: &str = "ranges";
pub const KEY_IME_MODE: &str = "imeMode";
pub const KEY_UID: &str = "uid";

/// Every Y.Map key that `to_yrs_prelim` may write. Used by the upsert-update
/// branch in `compute/core/src/storage/sheet/schemas.rs` to clear optional
/// fields before writing new ones — otherwise a field that was present in the
/// old spec but is absent from the new spec would linger.
pub const ALL_KEYS: &[&str] = &[
    KEY_RULE_TYPE,
    KEY_OPERATOR,
    KEY_FORMULA1,
    KEY_FORMULA2,
    KEY_ERROR_STYLE,
    KEY_SHOW_ERROR,
    KEY_ERROR_TITLE,
    KEY_ERROR_MESSAGE,
    KEY_SHOW_PROMPT,
    KEY_PROMPT_TITLE,
    KEY_PROMPT_MESSAGE,
    KEY_ALLOW_BLANK,
    KEY_SHOW_DROPDOWN,
    KEY_RANGES,
    KEY_IME_MODE,
    KEY_UID,
];

/// Write a ValidationSpec to Y.Map prelim entries.
pub fn to_yrs_prelim(spec: &ValidationSpec) -> Vec<(&str, Any)> {
    let ranges_json = serde_json::to_string(&spec.ranges).unwrap_or_default();

    let mut entries = vec![
        (KEY_RANGES, Any::String(Arc::from(ranges_json.as_str()))),
        (
            KEY_ERROR_STYLE,
            Any::String(Arc::from(spec.error_style.as_str())),
        ),
        (KEY_SHOW_ERROR, Any::Bool(spec.show_error)),
        (KEY_SHOW_PROMPT, Any::Bool(spec.show_prompt)),
        (KEY_ALLOW_BLANK, Any::Bool(spec.allow_blank)),
    ];

    // Optional string fields
    if let Some(t) = &spec.error_title {
        entries.push((KEY_ERROR_TITLE, Any::String(Arc::from(t.as_str()))));
    }
    if let Some(m) = &spec.error_message {
        entries.push((KEY_ERROR_MESSAGE, Any::String(Arc::from(m.as_str()))));
    }
    if let Some(t) = &spec.prompt_title {
        entries.push((KEY_PROMPT_TITLE, Any::String(Arc::from(t.as_str()))));
    }
    if let Some(m) = &spec.prompt_message {
        entries.push((KEY_PROMPT_MESSAGE, Any::String(Arc::from(m.as_str()))));
    }

    // Optional uid for revision tracking
    if let Some(uid) = &spec.uid {
        entries.push((KEY_UID, Any::String(Arc::from(uid.as_str()))));
    }

    // imeMode — only persist when non-default (noControl).
    if spec.ime_mode != ImeMode::NoControl {
        entries.push((KEY_IME_MODE, Any::String(Arc::from(spec.ime_mode.as_str()))));
    }

    // Decompose ValidationRule into flat keys
    match &spec.rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("wholeNumber"))));
            entries.push((KEY_OPERATOR, Any::String(Arc::from(operator.as_str()))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            if let Some(f2) = formula2 {
                entries.push((KEY_FORMULA2, Any::String(Arc::from(f2.as_str()))));
            }
        }
        ValidationRule::Decimal {
            operator,
            formula1,
            formula2,
        } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("decimal"))));
            entries.push((KEY_OPERATOR, Any::String(Arc::from(operator.as_str()))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            if let Some(f2) = formula2 {
                entries.push((KEY_FORMULA2, Any::String(Arc::from(f2.as_str()))));
            }
        }
        ValidationRule::List {
            formula1,
            show_dropdown,
        } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("list"))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            entries.push((KEY_SHOW_DROPDOWN, Any::Bool(*show_dropdown)));
        }
        ValidationRule::Date {
            operator,
            formula1,
            formula2,
        } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("date"))));
            entries.push((KEY_OPERATOR, Any::String(Arc::from(operator.as_str()))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            if let Some(f2) = formula2 {
                entries.push((KEY_FORMULA2, Any::String(Arc::from(f2.as_str()))));
            }
        }
        ValidationRule::Time {
            operator,
            formula1,
            formula2,
        } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("time"))));
            entries.push((KEY_OPERATOR, Any::String(Arc::from(operator.as_str()))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            if let Some(f2) = formula2 {
                entries.push((KEY_FORMULA2, Any::String(Arc::from(f2.as_str()))));
            }
        }
        ValidationRule::TextLength {
            operator,
            formula1,
            formula2,
        } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("textLength"))));
            entries.push((KEY_OPERATOR, Any::String(Arc::from(operator.as_str()))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            if let Some(f2) = formula2 {
                entries.push((KEY_FORMULA2, Any::String(Arc::from(f2.as_str()))));
            }
        }
        ValidationRule::Custom { formula1 } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("custom"))));
            entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
        }
        ValidationRule::None { formula1 } => {
            entries.push((KEY_RULE_TYPE, Any::String(Arc::from("none"))));
            if !formula1.is_empty() {
                entries.push((KEY_FORMULA1, Any::String(Arc::from(formula1.as_str()))));
            }
        }
    }

    entries
}

/// Read a ValidationSpec from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<ValidationSpec> {
    let rule_type = read_string(map, txn, KEY_RULE_TYPE)?;

    let rule = match rule_type.as_str() {
        "wholeNumber" => ValidationRule::WholeNumber {
            operator: read_string(map, txn, KEY_OPERATOR)
                .map(|s| ValidationOperator::from_str_lossy(&s))
                .unwrap_or_default(),
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
            formula2: read_string(map, txn, KEY_FORMULA2),
        },
        "decimal" => ValidationRule::Decimal {
            operator: read_string(map, txn, KEY_OPERATOR)
                .map(|s| ValidationOperator::from_str_lossy(&s))
                .unwrap_or_default(),
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
            formula2: read_string(map, txn, KEY_FORMULA2),
        },
        "list" => ValidationRule::List {
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
            show_dropdown: read_bool(map, txn, KEY_SHOW_DROPDOWN).unwrap_or(true),
        },
        "date" => ValidationRule::Date {
            operator: read_string(map, txn, KEY_OPERATOR)
                .map(|s| ValidationOperator::from_str_lossy(&s))
                .unwrap_or_default(),
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
            formula2: read_string(map, txn, KEY_FORMULA2),
        },
        "time" => ValidationRule::Time {
            operator: read_string(map, txn, KEY_OPERATOR)
                .map(|s| ValidationOperator::from_str_lossy(&s))
                .unwrap_or_default(),
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
            formula2: read_string(map, txn, KEY_FORMULA2),
        },
        "textLength" => ValidationRule::TextLength {
            operator: read_string(map, txn, KEY_OPERATOR)
                .map(|s| ValidationOperator::from_str_lossy(&s))
                .unwrap_or_default(),
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
            formula2: read_string(map, txn, KEY_FORMULA2),
        },
        "custom" => ValidationRule::Custom {
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
        },
        "none" => ValidationRule::None {
            formula1: read_string(map, txn, KEY_FORMULA1).unwrap_or_default(),
        },
        _ => return None,
    };

    let ranges: Vec<String> = read_string(map, txn, KEY_RANGES)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Some(ValidationSpec {
        ranges,
        rule,
        error_style: read_string(map, txn, KEY_ERROR_STYLE)
            .map(|s| ErrorStyle::from_str_lossy(&s))
            .unwrap_or_default(),
        show_error: read_bool(map, txn, KEY_SHOW_ERROR).unwrap_or(true),
        error_title: read_string(map, txn, KEY_ERROR_TITLE),
        error_message: read_string(map, txn, KEY_ERROR_MESSAGE),
        show_prompt: read_bool(map, txn, KEY_SHOW_PROMPT).unwrap_or(false),
        prompt_title: read_string(map, txn, KEY_PROMPT_TITLE),
        prompt_message: read_string(map, txn, KEY_PROMPT_MESSAGE),
        allow_blank: read_bool(map, txn, KEY_ALLOW_BLANK).unwrap_or(true),
        ime_mode: read_string(map, txn, KEY_IME_MODE)
            .map(|s| ImeMode::from_str_lossy(&s))
            .unwrap_or_default(),
        uid: read_string(map, txn, KEY_UID),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, Map, Transact};

    #[test]
    fn none_rule_formula1_round_trips_through_yrs_schema() {
        let spec = ValidationSpec {
            ranges: vec!["A1".to_string()],
            rule: ValidationRule::None {
                formula1: "TRUE".to_string(),
            },
            ..Default::default()
        };
        let doc = Doc::new();
        let map = doc.get_or_insert_map("validation");
        let mut txn = doc.transact_mut();
        for (key, value) in to_yrs_prelim(&spec) {
            map.insert(&mut txn, key, value);
        }
        drop(txn);

        let txn = doc.transact();
        let round_tripped = from_yrs_map(&map, &txn).expect("validation should hydrate");
        assert_eq!(round_tripped.rule, spec.rule);
    }
}

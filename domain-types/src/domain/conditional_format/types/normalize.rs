use super::{CFRule, ConditionalFormat};

/// Set of cellValue operators that actually belong on a `containsText` rule.
/// Callers historically sent `{ type: 'cellValue', operator: 'containsText',
/// value1: 'foo' }`; the correct shape is `{ type: 'containsText', operator:
/// 'containsText', text: 'foo' }`.
const TEXT_OPERATORS: &[&str] = &[
    "containsText",
    "notContainsText",
    "notContains",
    "beginsWith",
    "endsWith",
];

/// Public CF rule types the canonical [`super::CFRule`] enum models (after
/// normalization). This is the complete enumeration of every variant
/// the public TS API can produce or that XLSX hydration emits.
///
/// Used as a reference target for [`normalize_cf_rule_input`] —
/// every input the public API accepts must rewrite into one of these
/// canonical type tags.
pub const CANONICAL_CF_RULE_TYPES: &[&str] = &[
    "cellValue",
    "formula",
    "colorScale",
    "dataBar",
    "iconSet",
    "top10",
    "aboveAverage",
    "duplicateValues",
    "containsText",
    "containsBlanks",
    "containsErrors",
    "timePeriod",
];

/// Normalize a single CF rule's wire JSON in-place to the canonical
/// [`super::CFRule`] shape. Idempotent on already-canonical input.
///
/// Handles every **public CF rule type variant** the TS API accepts or
/// XLSX hydration emits. The complete public set:
///
/// | Public type tag       | Canonical tag       | Normalization                                                           |
/// |-----------------------|---------------------|-------------------------------------------------------------------------|
/// | `cellIs`              | `cellValue`         | OOXML alias for `cellValue`; rewrites the type tag                      |
/// | `cellValue` + text op | `containsText`      | text-operator subset (containsText / beginsWith / etc.) belongs on `containsText` |
/// | `cellValue`           | `cellValue`         | comparison operators stay; `formula`/`value` shorthand → `value1`       |
/// | `formula`/`expression`| `formula`           | `expression` is a serde alias; `value1` shorthand → `formula` field     |
/// | `colorScale`          | `colorScale`        | nested `colorScale` payload — no shape change                           |
/// | `dataBar`             | `dataBar`           | nested `dataBar` payload — no shape change                              |
/// | `iconSet`             | `iconSet`           | nested `iconSet` payload — no shape change                              |
/// | `top10`               | `top10`             | `value1` → `rank`, operator → `percent`/`bottom` flags; omitted flags default false |
/// | `aboveAverage`        | `aboveAverage`      | default `above_average: true` if unset; `belowAverage` flips the flag    |
/// | `belowAverage`        | `aboveAverage`      | OOXML doesn't have a separate type; this is the negation of aboveAverage |
/// | `duplicateValues`     | `duplicateValues`   | default `unique: false` if unset                                        |
/// | `uniqueValues`        | `duplicateValues`   | OOXML semantic: unique = duplicate-style with `unique: true`             |
/// | `containsText` + `value1` | `containsText`  | `value1` → `text` fallback                                              |
/// | `containsBlanks`      | `containsBlanks`    | default `blanks: true` if unset                                         |
/// | `notContainsBlanks`   | `containsBlanks`    | sets `blanks: false`                                                    |
/// | `containsErrors`      | `containsErrors`    | default `errors: true` if unset                                         |
/// | `notContainsErrors`   | `containsErrors`    | sets `errors: false`                                                    |
/// | `timePeriod`          | `timePeriod`        | direct                                                                  |
///
/// Field-rename aliases that don't change the type tag (e.g.
/// `expression` → `formula` variant) are handled by `#[serde(alias)]`
/// on the canonical enum directly.
pub fn normalize_cf_rule_input(rule: &mut serde_json::Value) {
    let serde_json::Value::Object(obj) = rule else {
        return;
    };
    let Some(serde_json::Value::String(rule_type)) = obj.get("type").cloned() else {
        return;
    };

    match rule_type.as_str() {
        "cellIs" => {
            obj.insert("type".into(), serde_json::Value::String("cellValue".into()));
            normalize_cell_value_arm(obj);
        }
        "notContainsBlanks" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("containsBlanks".into()),
            );
            obj.entry("blanks")
                .or_insert(serde_json::Value::Bool(false));
        }
        "containsBlanks" => {
            obj.entry("blanks").or_insert(serde_json::Value::Bool(true));
        }
        "notContainsErrors" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("containsErrors".into()),
            );
            obj.entry("errors")
                .or_insert(serde_json::Value::Bool(false));
        }
        "containsErrors" => {
            obj.entry("errors").or_insert(serde_json::Value::Bool(true));
        }
        "cellValue" => {
            normalize_cell_value_arm(obj);
        }
        "top10" => {
            if !obj.contains_key("rank")
                && let Some(v1) = obj.remove("value1")
            {
                let rank = match &v1 {
                    serde_json::Value::Number(n) => n.as_u64().unwrap_or(10),
                    serde_json::Value::String(s) => s.parse::<u64>().unwrap_or(10),
                    _ => 10,
                };
                obj.insert("rank".into(), serde_json::json!(rank));
            }
            if let Some(serde_json::Value::String(op)) = obj.get("operator").cloned() {
                match op.as_str() {
                    "bottom" => {
                        obj.entry("bottom").or_insert(serde_json::Value::Bool(true));
                    }
                    "topPercent" | "bottomPercent" => {
                        obj.entry("percent")
                            .or_insert(serde_json::Value::Bool(true));
                        if op == "bottomPercent" {
                            obj.entry("bottom").or_insert(serde_json::Value::Bool(true));
                        }
                    }
                    _ => {}
                }
            }
            obj.remove("operator");
            obj.entry("percent")
                .or_insert(serde_json::Value::Bool(false));
            obj.entry("bottom")
                .or_insert(serde_json::Value::Bool(false));
        }
        "containsText" => {
            if !obj.contains_key("text")
                && let Some(v1) = obj.remove("value1")
            {
                let text = match v1 {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert("text".into(), serde_json::Value::String(text));
            }
            if obj.get("operator").and_then(|v| v.as_str()) == Some("notContainsText") {
                obj.insert(
                    "operator".into(),
                    serde_json::Value::String("notContains".into()),
                );
            }
        }
        "formula" | "expression" => {
            obj.insert("type".into(), serde_json::Value::String("formula".into()));
            if !obj.contains_key("formula")
                && let Some(v1) = obj.remove("value1")
            {
                let formula = match v1 {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert("formula".into(), serde_json::Value::String(formula));
            }
            obj.remove("operator");
            obj.remove("value2");
        }
        "aboveAverage" => {
            obj.entry("aboveAverage")
                .or_insert(serde_json::Value::Bool(true));
        }
        "belowAverage" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("aboveAverage".into()),
            );
            obj.insert("aboveAverage".into(), serde_json::Value::Bool(false));
        }
        "uniqueValues" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("duplicateValues".into()),
            );
            obj.entry("unique").or_insert(serde_json::Value::Bool(true));
        }
        "duplicateValues" => {
            obj.entry("unique")
                .or_insert(serde_json::Value::Bool(false));
        }
        "colorScale" | "dataBar" | "iconSet" | "timePeriod" => {}
        _ => {}
    }
}

/// Shape-coerce a `cellValue`/`cellIs` rule. Extracted so the `cellIs`
/// type-rename arm can share the same body without re-entering
/// `normalize_cf_rule_input` recursively.
fn normalize_cell_value_arm(obj: &mut serde_json::Map<String, serde_json::Value>) {
    let op_is_text = obj
        .get("operator")
        .and_then(|v| v.as_str())
        .is_some_and(|op| TEXT_OPERATORS.contains(&op));
    if op_is_text {
        obj.insert(
            "type".into(),
            serde_json::Value::String("containsText".into()),
        );
        let text = obj
            .get("value1")
            .map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        obj.insert("text".into(), serde_json::Value::String(text));
        if obj.get("operator").and_then(|v| v.as_str()) == Some("notContainsText") {
            obj.insert(
                "operator".into(),
                serde_json::Value::String("notContains".into()),
            );
        }
        obj.remove("value1");
        obj.remove("value2");
        return;
    }

    if !obj.contains_key("value1") {
        if let Some(v) = obj.remove("value") {
            obj.insert("value1".into(), v);
        } else if let Some(f) = obj.remove("formula") {
            obj.insert("value1".into(), f);
        }
    }
}

/// Normalize all rules in a `ConditionalFormat`-shaped JSON value in-place.
/// Walks `value["rules"]` and applies [`normalize_cf_rule_input`] to each
/// element. No-op if `rules` is missing or not an array.
pub fn normalize_conditional_format_input(value: &mut serde_json::Value) {
    let Some(rules) = value.get_mut("rules").and_then(|r| r.as_array_mut()) else {
        return;
    };
    for rule in rules.iter_mut() {
        normalize_cf_rule_input(rule);
    }
}

/// Canonicalize defaults on an already-typed CF rule.
///
/// `normalize_cf_rule_input` handles public/JSON inputs before serde
/// deserialization. XLSX import and some internal callers construct the typed
/// enum directly, so this is the typed counterpart that keeps authored,
/// imported, edited, and exported rules on the same domain representation.
pub fn canonicalize_cf_rule_defaults(rule: &mut CFRule) {
    match rule {
        CFRule::Top10 {
            percent, bottom, ..
        } => {
            percent.get_or_insert(false);
            bottom.get_or_insert(false);
        }
        CFRule::DuplicateValues { unique, .. } => {
            unique.get_or_insert(false);
        }
        _ => {}
    }
}

/// Canonicalize defaults on every rule in a conditional-format container.
pub fn canonicalize_conditional_format_defaults(format: &mut ConditionalFormat) {
    for rule in &mut format.rules {
        canonicalize_cf_rule_defaults(rule);
    }
}

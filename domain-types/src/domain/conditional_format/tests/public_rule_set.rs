use super::*;

#[test]
fn normalize_cell_is_alias_to_cell_value() {
    // OOXML uses `<cfRule type="cellIs">`; the public TS API exposes
    // `cellIs` for parity. The canonical Rust enum tag is `cellValue`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellIs",
        "id": "r1",
        "priority": 1,
        "operator": "greaterThan",
        "value1": 10,
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::GreaterThan);
            assert_eq!(value1, serde_json::json!(10));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn normalize_cell_is_with_text_op_promotes_to_contains_text() {
    // `cellIs` with a text operator should rewrite to `containsText`,
    // matching the `cellValue` arm's behavior.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellIs",
        "id": "r1",
        "priority": 1,
        "operator": "containsText",
        "value1": "hello",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { operator, text, .. } => {
            assert_eq!(operator, CfOperator::ContainsText);
            assert_eq!(text, "hello");
        }
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_cell_value_value_shorthand_to_value1() {
    // Public API ergonomics: `value` is a single-shorthand for
    // `value1` on equality / comparison rules.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "equal",
        "value": 42,
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::Equal);
            assert_eq!(value1, serde_json::json!(42));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn normalize_cell_value_formula_field_to_value1() {
    // OOXML-style: a `cellIs`/`cellValue` rule sometimes ships its
    // comparison value inside `formula` (an OOXML formula token).
    // The canonical schema accepts any JSON in `value1`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "greaterThan",
        "formula": "=A1*2",
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::GreaterThan);
            assert_eq!(value1, serde_json::json!("=A1*2"));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn normalize_formula_value1_shorthand() {
    // `formula` with `value1` shorthand (matches the `cellValue`
    // shape used by `cf-custom-formula` app-eval scenario).
    let rule = normalize_and_parse(serde_json::json!({
        "type": "formula",
        "id": "r1",
        "priority": 1,
        "operator": "expression",
        "value1": "=MOD(ROW(),2)=0",
        "style": {},
    }));
    match rule {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=MOD(ROW(),2)=0"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn normalize_expression_value1_shorthand_promotes_to_formula() {
    // `expression` is a deprecated public alias for the `formula`
    // type tag; combined with the `value1` shorthand it must still
    // produce a valid Formula variant. This is the exact shape
    // shipped by the `cf-custom-formula` app-eval scenario.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "expression",
        "id": "r1",
        "priority": 1,
        "operator": "expression",
        "value1": "=MOD(ROW(),2)=0",
        "style": { "backgroundColor": "#E6F0FF" },
    }));
    match rule {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=MOD(ROW(),2)=0"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn normalize_above_average_default_true() {
    // `aboveAverage` without an explicit flag defaults to `true`
    // (Excel's "Above Average" UI command).
    let rule = normalize_and_parse(serde_json::json!({
        "type": "aboveAverage",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::AboveAverage { above_average, .. } => assert!(above_average),
        _ => panic!("expected AboveAverage variant"),
    }
}

#[test]
fn normalize_above_average_camelcase_field() {
    // Rust uses `above_average`; normalized JSON uses the camelCase
    // TS/API wire field.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "aboveAverage",
        "id": "r1",
        "priority": 1,
        "aboveAverage": false,
        "style": {},
    }));
    match rule {
        CFRule::AboveAverage { above_average, .. } => assert!(!above_average),
        _ => panic!("expected AboveAverage variant"),
    }
}

#[test]
fn normalize_below_average_to_above_average_false() {
    // `belowAverage` is a public alias for the negation form of
    // `aboveAverage`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "belowAverage",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::AboveAverage { above_average, .. } => assert!(!above_average),
        _ => panic!("expected AboveAverage variant"),
    }
}

#[test]
fn normalize_unique_values_to_duplicate_values_unique_true() {
    // OOXML's `uniqueValues` is the negation form of
    // `duplicateValues`; the canonical enum collapses both into
    // `DuplicateValues { unique: bool }`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "uniqueValues",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::DuplicateValues { unique, .. } => assert_eq!(unique, Some(true)),
        _ => panic!("expected DuplicateValues variant"),
    }
}

#[test]
fn normalize_duplicate_values_canonical() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "duplicateValues",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::DuplicateValues { unique, .. } => assert_eq!(unique, None),
        _ => panic!("expected DuplicateValues variant"),
    }
}

#[test]
fn normalize_time_period_canonical() {
    // Rust uses `time_period`; normalized JSON uses the camelCase
    // TS/API wire field.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "timePeriod",
        "id": "r1",
        "priority": 1,
        "timePeriod": "today",
        "style": {},
    }));
    match rule {
        CFRule::TimePeriod { time_period, .. } => {
            assert_eq!(time_period, CfTimePeriod::Today);
        }
        _ => panic!("expected TimePeriod variant"),
    }
}

#[test]
fn normalize_color_scale_canonical_passthrough() {
    // colorScale carries its payload nested; the normalizer must
    // not alter the shape. The canonical CFColorPoint uses
    // `value: { kind: ... }` (a typed `CFValueRef`), not
    // `valueType`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "colorScale",
        "id": "r1",
        "priority": 1,
        "colorScale": {
            "minPoint": { "value": { "kind": "min" }, "color": "#FF0000" },
            "maxPoint": { "value": { "kind": "max" }, "color": "#00FF00" },
        },
    }));
    assert!(matches!(rule, CFRule::ColorScale { .. }));
}

#[test]
fn normalize_data_bar_canonical_passthrough() {
    // CFDataBar uses `#[serde(rename_all = "camelCase")]`. Each
    // CFColorPoint requires `value` (CFValueRef) and `color`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "dataBar",
        "id": "r1",
        "priority": 1,
        "dataBar": {
            "minPoint": { "value": { "kind": "min" }, "color": "" },
            "maxPoint": { "value": { "kind": "max" }, "color": "" },
            "positiveColor": "#638EC6",
        },
    }));
    assert!(matches!(rule, CFRule::DataBar { .. }));
}

#[test]
fn normalize_icon_set_canonical_passthrough() {
    // CFIconSet uses `#[serde(rename_all = "camelCase")]`, so
    // `icon_set_name` becomes `iconSetName` in JSON.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "iconSet",
        "id": "r1",
        "priority": 1,
        "iconSet": {
            "iconSetName": "3TrafficLights1",
            "thresholds": [],
        },
    }));
    assert!(matches!(rule, CFRule::IconSet { .. }));
}

/// Drives [`normalize_cf_rule_input`] across every public rule type
/// and verifies the result deserializes to a canonical [`CFRule`].
/// The asserted set is [`CANONICAL_CF_RULE_TYPES`] plus the public
/// aliases (`cellIs`, `belowAverage`, `uniqueValues`, `expression`,
/// `notContainsBlanks`, `notContainsErrors`).
///
/// If a future audit adds a new public rule type, this test must
/// fail until the normalization arm is added.
#[test]
fn normalize_full_public_cf_rule_type_set() {
    let cases: Vec<(&str, serde_json::Value)> = vec![
        (
            "cellValue",
            serde_json::json!({
                "type": "cellValue", "id": "r", "priority": 1,
                "operator": "greaterThan", "value1": 1, "style": {}
            }),
        ),
        (
            "cellIs",
            serde_json::json!({
                "type": "cellIs", "id": "r", "priority": 1,
                "operator": "lessThan", "value1": 1, "style": {}
            }),
        ),
        (
            "formula",
            serde_json::json!({
                "type": "formula", "id": "r", "priority": 1,
                "formula": "=TRUE", "style": {}
            }),
        ),
        (
            "expression",
            serde_json::json!({
                "type": "expression", "id": "r", "priority": 1,
                "value1": "=TRUE", "style": {}
            }),
        ),
        (
            "colorScale",
            serde_json::json!({
                "type": "colorScale", "id": "r", "priority": 1,
                "colorScale": {
                    "minPoint": { "value": { "kind": "min" }, "color": "#FF0000" },
                    "maxPoint": { "value": { "kind": "max" }, "color": "#00FF00" },
                },
            }),
        ),
        (
            "dataBar",
            serde_json::json!({
                "type": "dataBar", "id": "r", "priority": 1,
                "dataBar": {
                    "minPoint": { "value": { "kind": "min" }, "color": "" },
                    "maxPoint": { "value": { "kind": "max" }, "color": "" },
                    "positiveColor": "#638EC6",
                },
            }),
        ),
        (
            "iconSet",
            serde_json::json!({
                "type": "iconSet", "id": "r", "priority": 1,
                "iconSet": {
                    "iconSetName": "3TrafficLights1",
                    "thresholds": [],
                },
            }),
        ),
        (
            "top10",
            serde_json::json!({
                "type": "top10", "id": "r", "priority": 1,
                "rank": 10, "style": {}
            }),
        ),
        (
            "aboveAverage",
            serde_json::json!({
                "type": "aboveAverage", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "belowAverage",
            serde_json::json!({
                "type": "belowAverage", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "duplicateValues",
            serde_json::json!({
                "type": "duplicateValues", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "uniqueValues",
            serde_json::json!({
                "type": "uniqueValues", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "containsText",
            serde_json::json!({
                "type": "containsText", "id": "r", "priority": 1,
                "operator": "containsText", "text": "x", "style": {}
            }),
        ),
        (
            "containsBlanks",
            serde_json::json!({
                "type": "containsBlanks", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "notContainsBlanks",
            serde_json::json!({
                "type": "notContainsBlanks", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "containsErrors",
            serde_json::json!({
                "type": "containsErrors", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "notContainsErrors",
            serde_json::json!({
                "type": "notContainsErrors", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "timePeriod",
            serde_json::json!({
                "type": "timePeriod", "id": "r", "priority": 1,
                "timePeriod": "today", "style": {}
            }),
        ),
    ];

    for (label, mut json) in cases {
        normalize_cf_rule_input(&mut json);
        let parsed: CFRule = serde_json::from_value(json.clone()).unwrap_or_else(|e| {
            panic!("input '{}' must normalize: err={} json={}", label, e, json)
        });
        // Every output type tag must be in the canonical set.
        let json_after = serde_json::to_value(&parsed).unwrap();
        let tag = json_after
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(
            CANONICAL_CF_RULE_TYPES.contains(&tag),
            "input '{}' produced non-canonical tag '{}'",
            label,
            tag,
        );
    }
}

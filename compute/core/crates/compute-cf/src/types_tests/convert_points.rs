use super::*;

// -----------------------------------------------------------------------
// Color point parsing for Formula value type
// -----------------------------------------------------------------------

#[test]
fn test_color_point_formula_type_non_numeric_value() {
    // Formula type with non-numeric value should not error (value=None)
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "formula", "value": "=A1+B1", "color": "#FF0000" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            assert_eq!(cs.min_point.value_type, CFValueType::Formula);
            assert_eq!(cs.min_point.value, None); // formula string doesn't parse as f64
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

#[test]
fn test_color_point_formula_type_numeric_value() {
    // Formula type with numeric value should parse successfully
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "formula", "value": "42.5", "color": "#FF0000" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            assert_eq!(cs.min_point.value_type, CFValueType::Formula);
            assert_eq!(cs.min_point.value, Some(42.5));
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

// -----------------------------------------------------------------------
// Wire conversion: Number-type point with missing value returns Ok(None)
// -----------------------------------------------------------------------

#[test]
fn test_wire_color_scale_number_point_missing_value() {
    // A Number-type color point with no value should convert successfully
    // with value = None rather than erroring, since the wire format allows
    // it and the runtime can fall back to defaults.
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "number", "color": "#FF0000" },
            "maxPoint": { "type": "number", "value": "100", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            // minPoint has type=Number but no value — should be None
            assert_eq!(cs.min_point.value_type, CFValueType::Number);
            assert_eq!(cs.min_point.value, None);
            // maxPoint has value=100
            assert_eq!(cs.max_point.value_type, CFValueType::Number);
            assert_eq!(cs.max_point.value, Some(100.0));
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

#[test]
fn test_wire_data_bar_percentile_point_missing_value() {
    // Same test for data bar: a Percentile-type point with no value
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "percentile", "color": "#000000" },
            "maxPoint": { "type": "percentile", "value": "90", "color": "#000000" },
            "positiveColor": "#638EC6",
            "showBorder": false,
            "gradient": true,
            "direction": "leftToRight",
            "axisPosition": "automatic",
            "showValue": true
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.min_point.value_type, CFValueType::Percentile);
            assert_eq!(db.min_point.value, None);
            assert_eq!(db.max_point.value, Some(90.0));
        }
        _ => panic!("Expected DataBar variant"),
    }
}

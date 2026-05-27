use super::*;

// =======================================================================
// Wire deserialization: CellValue rule
// =======================================================================

#[test]
fn test_wire_deser_cell_value_rule() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "stopIfTrue": false,
        "operator": "greaterThan",
        "values": ["100"],
        "style": {
            "backgroundColor": "#FF0000",
            "bold": true
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    assert_eq!(wire.rule_type, CFRuleType::CellValue);
    assert_eq!(wire.priority, 1);
    assert!(!wire.stop_if_true);
    assert_eq!(wire.operator, Some(CFOperator::GreaterThan));
    // Typed formula boundary: `values` is now `Vec<CfValue>`. Shorthand JSON string
    // `"100"` deserializes into `CfValue::Text` (the fallback accepts bare
    // strings). Downstream `.as_number()` still extracts 100.0 for the
    // numeric-compare path — covered by the `try_from_wire` tests below.
    assert_eq!(
        wire.values,
        vec![CfValue::Text {
            value: "100".to_string()
        }]
    );

    let style = wire.style.as_ref().unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, Some(true));
}

#[test]
fn test_wire_to_internal_cell_value_between() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 2,
        "stopIfTrue": true,
        "operator": "between",
        "values": ["10", "20"],
        "style": { "fontColor": "#000000" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    assert_eq!(rule.priority, 2);
    assert!(rule.stop_if_true);
    match &rule.kind {
        CFRuleKind::CellValue { comparison } => match comparison {
            CellValueComparison::Between { low, high } => {
                assert_eq!(*low, 10.0);
                assert_eq!(*high, 20.0);
            }
            _ => panic!("Expected Between variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().font_color,
        Some(Color::from_hex("#000000").unwrap())
    );
}

#[test]
fn test_wire_to_internal_cell_value_single() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "greaterThan",
        "values": ["100"],
        "style": { "bold": true },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Single {
                operator,
                threshold,
            } => {
                assert_eq!(*operator, CellValueSingleOp::GreaterThan);
                assert_eq!(threshold.text, "100");
                assert_eq!(threshold.number, Some(100.0));
            }
            _ => panic!("Expected Single variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

#[test]
fn test_wire_to_internal_cell_value_single_text() {
    // Non-numeric value
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "equal",
        "values": ["hello"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Single {
                operator,
                threshold,
            } => {
                assert_eq!(*operator, CellValueSingleOp::Equal);
                assert_eq!(threshold.text, "hello");
                assert_eq!(threshold.number, None);
            }
            _ => panic!("Expected Single variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

#[test]
fn test_wire_to_internal_cell_value_between_sorts_values() {
    // High value first — should be sorted to low/high
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["20", "10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Between { low, high } => {
                assert_eq!(*low, 10.0);
                assert_eq!(*high, 20.0);
            }
            _ => panic!("Expected Between variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: Formula rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_formula_rule() {
    let json = r#"{
        "ruleType": "formula",
        "priority": 3,
        "formula": "A1>100",
        "style": { "italic": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::Formula { formula } => {
            assert_eq!(formula, "A1>100");
        }
        _ => panic!("Expected Formula variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().italic, Some(true));
}

// -----------------------------------------------------------------------
// Wire deserialization: ColorScale rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_color_scale_rule() {
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "min", "color": "#FF0000" },
            "midPoint": { "type": "percentile", "value": "50", "color": "#FFFF00" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            assert_eq!(cs.min_point.value_type, CFValueType::Min);
            assert_eq!(cs.min_point.color, Color::rgb(255, 0, 0));
            assert!(cs.mid_point.is_some());
            let mid = cs.mid_point.as_ref().unwrap();
            assert_eq!(mid.value_type, CFValueType::Percentile);
            assert_eq!(mid.value, Some(50.0));
            assert_eq!(mid.color, Color::rgb(255, 255, 0));
            assert_eq!(cs.max_point.value_type, CFValueType::Max);
            assert_eq!(cs.max_point.color, Color::rgb(0, 255, 0));
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: DataBar rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_data_bar_rule() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#000000" },
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
            assert_eq!(db.positive_color, Color::from_hex("#638EC6").unwrap());
            assert!(db.gradient);
            assert_eq!(db.direction, CFDataBarDirection::LeftToRight);
            assert_eq!(db.axis_position, CFDataBarAxisPosition::Automatic);
            assert!(db.show_value);
            assert!(!db.show_border);
        }
        _ => panic!("Expected DataBar variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: IconSet rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_icon_set_rule() {
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "3Arrows",
            "thresholds": [
                { "type": "percent", "value": "33", "operator": "greaterThanOrEqual" },
                { "type": "percent", "value": "67", "operator": "greaterThanOrEqual" }
            ],
            "reverseOrder": false,
            "showIconOnly": true
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::IconSet(is) => {
            assert_eq!(is.icon_set_name, CFIconSetName::ThreeArrows);
            assert_eq!(is.thresholds.len(), 2);
            assert!(is.show_icon_only);
            assert!(!is.reverse_order);
            assert_eq!(
                is.thresholds[0].operator,
                CFIconThresholdOperator::GreaterThanOrEqual
            );
            assert_eq!(is.thresholds[0].value, Some(33.0));
            assert_eq!(is.thresholds[1].value, Some(67.0));
        }
        _ => panic!("Expected IconSet variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: Top10 rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_top10_rule() {
    let json = r##"{
        "ruleType": "top10",
        "priority": 5,
        "rank": 10,
        "percent": true,
        "bottom": false,
        "style": { "backgroundColor": "#FFFF00" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::Top10 {
            rank,
            percent,
            bottom,
        } => {
            assert_eq!(*rank, 10);
            assert!(*percent);
            assert!(!*bottom);
        }
        _ => panic!("Expected Top10 variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FFFF00").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: AboveAverage rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_above_average_rule() {
    let json = r#"{
        "ruleType": "aboveAverage",
        "priority": 3,
        "above": true,
        "equalAverage": true,
        "stdDev": 2,
        "style": { "bold": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::AboveAverage {
            above,
            equal_average,
            std_dev,
        } => {
            assert!(*above);
            assert!(*equal_average);
            assert_eq!(*std_dev, 2);
        }
        _ => panic!("Expected AboveAverage variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().bold, Some(true));
}

// -----------------------------------------------------------------------
// Wire deserialization: DuplicateValues rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_duplicate_values_rule() {
    let json = r#"{
        "ruleType": "duplicateValues",
        "priority": 1,
        "unique": true,
        "style": { "strikethrough": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DuplicateValues { unique } => {
            assert!(*unique);
        }
        _ => panic!("Expected DuplicateValues variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().strikethrough, Some(true));
}

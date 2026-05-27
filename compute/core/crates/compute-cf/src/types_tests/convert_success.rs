use super::*;

// -----------------------------------------------------------------------
// Full wire -> internal round-trip for all rule types
// -----------------------------------------------------------------------

#[test]
fn test_wire_roundtrip_all_rule_types() {
    let rule_types = vec![
        (
            r#"{"ruleType":"cellValue","priority":1,"operator":"notEqual","values":["42"],"style":{},"ranges":[]}"#,
            CFRuleType::CellValue,
        ),
        (
            r#"{"ruleType":"formula","priority":2,"formula":"=A1>0","style":{},"ranges":[]}"#,
            CFRuleType::Formula,
        ),
        (
            r##"{"ruleType":"colorScale","priority":3,"colorScale":{"minPoint":{"type":"min","color":"#FF0000"},"maxPoint":{"type":"max","color":"#00FF00"}},"ranges":[]}"##,
            CFRuleType::ColorScale,
        ),
        (
            r##"{"ruleType":"dataBar","priority":4,"dataBar":{"minPoint":{"type":"min","color":"#000000"},"maxPoint":{"type":"max","color":"#000000"},"positiveColor":"#638EC6","showBorder":false,"gradient":false,"direction":"leftToRight","axisPosition":"automatic","showValue":true},"ranges":[]}"##,
            CFRuleType::DataBar,
        ),
        (
            r#"{"ruleType":"iconSet","priority":5,"iconSet":{"iconSetName":"NoIcons","thresholds":[],"reverseOrder":false,"showIconOnly":false},"ranges":[]}"#,
            CFRuleType::IconSet,
        ),
        (
            r#"{"ruleType":"top10","priority":6,"rank":5,"style":{},"ranges":[]}"#,
            CFRuleType::Top10,
        ),
        (
            r#"{"ruleType":"aboveAverage","priority":7,"above":false,"style":{},"ranges":[]}"#,
            CFRuleType::AboveAverage,
        ),
        (
            r#"{"ruleType":"duplicateValues","priority":8,"style":{},"ranges":[]}"#,
            CFRuleType::DuplicateValues,
        ),
        (
            r#"{"ruleType":"containsText","priority":9,"textOperator":"contains","text":"test","style":{},"ranges":[]}"#,
            CFRuleType::ContainsText,
        ),
        (
            r#"{"ruleType":"containsBlanks","priority":10,"blanks":false,"style":{},"ranges":[]}"#,
            CFRuleType::ContainsBlanks,
        ),
        (
            r#"{"ruleType":"containsErrors","priority":11,"errors":true,"style":{},"ranges":[]}"#,
            CFRuleType::ContainsErrors,
        ),
        (
            r#"{"ruleType":"timePeriod","priority":12,"datePeriod":"tomorrow","style":{},"ranges":[]}"#,
            CFRuleType::TimePeriod,
        ),
    ];

    for (json, expected_type) in rule_types {
        let wire: CFRuleWire = serde_json::from_str(json)
            .unwrap_or_else(|e| panic!("Failed to deserialize {:?}: {}", expected_type, e));
        assert_eq!(wire.rule_type, expected_type);

        let rule: CFRule = CFRule::try_from(wire).unwrap();
        // Verify correct variant was created
        match (&rule.kind, expected_type) {
            (CFRuleKind::CellValue { .. }, CFRuleType::CellValue) => {}
            (CFRuleKind::Formula { .. }, CFRuleType::Formula) => {}
            (CFRuleKind::ColorScale(_), CFRuleType::ColorScale) => {}
            (CFRuleKind::DataBar(_), CFRuleType::DataBar) => {}
            (CFRuleKind::IconSet(_), CFRuleType::IconSet) => {}
            (CFRuleKind::Top10 { .. }, CFRuleType::Top10) => {}
            (CFRuleKind::AboveAverage { .. }, CFRuleType::AboveAverage) => {}
            (CFRuleKind::DuplicateValues { .. }, CFRuleType::DuplicateValues) => {}
            (CFRuleKind::ContainsText { .. }, CFRuleType::ContainsText) => {}
            (CFRuleKind::ContainsBlanks { .. }, CFRuleType::ContainsBlanks) => {}
            (CFRuleKind::ContainsErrors { .. }, CFRuleType::ContainsErrors) => {}
            (CFRuleKind::TimePeriod { .. }, CFRuleType::TimePeriod) => {}
            (kind, expected) => {
                panic!(
                    "Variant mismatch: got {:?} but expected {:?}",
                    std::mem::discriminant(kind),
                    expected
                );
            }
        }
    }
}

// -----------------------------------------------------------------------
// TryFrom for new rule types
// -----------------------------------------------------------------------

#[test]
fn test_try_from_not_contains_text() {
    let json = r#"{
        "ruleType": "notContainsText",
        "priority": 1,
        "text": "HELLO",
        "style": { "bold": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text } => {
            assert_eq!(*operator, CFTextOperator::NotContains);
            assert_eq!(text, "hello");
        }
        _ => panic!("Expected ContainsText variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().bold, Some(true));
}

#[test]
fn test_try_from_begins_with() {
    let json = r#"{
        "ruleType": "beginsWith",
        "priority": 1,
        "text": "Prefix",
        "style": {},
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text, .. } => {
            assert_eq!(*operator, CFTextOperator::BeginsWith);
            assert_eq!(text, "prefix");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

#[test]
fn test_try_from_ends_with() {
    let json = r#"{
        "ruleType": "endsWith",
        "priority": 1,
        "text": "Suffix",
        "style": {},
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text, .. } => {
            assert_eq!(*operator, CFTextOperator::EndsWith);
            assert_eq!(text, "suffix");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

#[test]
fn test_try_from_not_contains_blanks() {
    let json = r##"{
        "ruleType": "notContainsBlanks",
        "priority": 1,
        "style": { "backgroundColor": "#00FF00" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsBlanks { blanks } => {
            assert!(!*blanks);
        }
        _ => panic!("Expected ContainsBlanks variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#00FF00").unwrap())
    );
}

#[test]
fn test_try_from_not_contains_errors() {
    let json = r#"{
        "ruleType": "notContainsErrors",
        "priority": 1,
        "style": { "italic": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsErrors { errors } => {
            assert!(!*errors);
        }
        _ => panic!("Expected ContainsErrors variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().italic, Some(true));
}

// -----------------------------------------------------------------------
// Text pre-lowercasing in TryFrom
// -----------------------------------------------------------------------

#[test]
fn test_contains_text_pre_lowercases() {
    let json = r##"{
        "ruleType": "containsText",
        "priority": 1,
        "textOperator": "contains",
        "text": "HELLO",
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { text, .. } => {
            assert_eq!(text, "hello");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

#[test]
fn test_contains_text_mixed_case_lowercased() {
    let json = r##"{
        "ruleType": "containsText",
        "priority": 1,
        "textOperator": "contains",
        "text": "HeLLo WoRLd",
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { text, .. } => {
            assert_eq!(text, "hello world");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

// -----------------------------------------------------------------------
// OOXML alias wire -> internal round-trip (expression alias)
// -----------------------------------------------------------------------

#[test]
fn test_expression_alias_wire_to_internal() {
    let json = r#"{
        "ruleType": "expression",
        "priority": 1,
        "formula": "=B1>0",
        "style": { "bold": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    assert_eq!(wire.rule_type, CFRuleType::Formula);

    let rule: CFRule = CFRule::try_from(wire).unwrap();
    match &rule.kind {
        CFRuleKind::Formula { formula } => {
            assert_eq!(formula, "=B1>0");
        }
        _ => panic!("Expected Formula variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().bold, Some(true));
}

// -----------------------------------------------------------------------
// NotBetween
// -----------------------------------------------------------------------

#[test]
fn test_wire_to_internal_cell_value_not_between() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "notBetween",
        "values": ["5", "15"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::NotBetween { low, high } => {
                assert_eq!(*low, 5.0);
                assert_eq!(*high, 15.0);
            }
            _ => panic!("Expected NotBetween variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

// -----------------------------------------------------------------------
// DataBar with all color fields
// -----------------------------------------------------------------------

#[test]
fn test_data_bar_full_colors() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#FFFFFF" },
            "positiveColor": "#638EC6",
            "negativeColor": "#FF0000",
            "borderColor": "#333333",
            "negativeBorderColor": "#990000",
            "axisColor": "#808080",
            "showBorder": true,
            "gradient": true,
            "direction": "rightToLeft",
            "axisPosition": "midpoint",
            "showValue": false,
            "minLength": 5,
            "maxLength": 95
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.positive_color, Color::from_hex("#638EC6").unwrap());
            assert_eq!(db.negative_color, Some(Color::from_hex("#FF0000").unwrap()));
            assert_eq!(db.border_color, Some(Color::from_hex("#333333").unwrap()));
            assert_eq!(
                db.negative_border_color,
                Some(Color::from_hex("#990000").unwrap())
            );
            assert_eq!(db.axis_color, Some(Color::from_hex("#808080").unwrap()));
            assert!(db.show_border);
            assert!(db.gradient);
            assert_eq!(db.direction, CFDataBarDirection::RightToLeft);
            assert_eq!(db.axis_position, CFDataBarAxisPosition::Midpoint);
            assert!(!db.show_value);
            assert_eq!(db.min_length, 5);
            assert_eq!(db.max_length, 95);
        }
        _ => panic!("Expected DataBar variant"),
    }
}

// -----------------------------------------------------------------------
// All CellValueSingleOp variants via wire
// -----------------------------------------------------------------------

#[test]
fn test_all_single_ops() {
    let ops = vec![
        ("greaterThan", CellValueSingleOp::GreaterThan),
        ("lessThan", CellValueSingleOp::LessThan),
        ("greaterThanOrEqual", CellValueSingleOp::GreaterThanOrEqual),
        ("lessThanOrEqual", CellValueSingleOp::LessThanOrEqual),
        ("equal", CellValueSingleOp::Equal),
        ("notEqual", CellValueSingleOp::NotEqual),
    ];

    for (op_str, expected_op) in ops {
        let json = format!(
            r#"{{"ruleType":"cellValue","priority":1,"operator":"{}","values":["42"],"style":{{}},"ranges":[]}}"#,
            op_str
        );
        let wire: CFRuleWire = serde_json::from_str(&json).unwrap();
        let rule: CFRule = CFRule::try_from(wire).unwrap();

        match &rule.kind {
            CFRuleKind::CellValue { comparison, .. } => match comparison {
                CellValueComparison::Single { operator, .. } => {
                    assert_eq!(*operator, expected_op, "Mismatch for op '{}'", op_str);
                }
                _ => panic!("Expected Single variant for op '{}'", op_str),
            },
            _ => panic!("Expected CellValue variant for op '{}'", op_str),
        }
    }
}

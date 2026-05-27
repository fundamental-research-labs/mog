use super::*;

// -----------------------------------------------------------------------
// Wire deserialization: defaults when optional fields are missing
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_minimal_cell_value() {
    // Minimal CellValue with explicit operator (operator is required)
    let json = r#"{
        "ruleType": "cellValue",
        "priority": 0,
        "operator": "equal",
        "values": ["test"],
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    assert_eq!(rule.priority, 0);
    assert!(!rule.stop_if_true);
    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Single {
                operator,
                threshold,
            } => {
                assert_eq!(*operator, CellValueSingleOp::Equal);
                assert_eq!(threshold.text, "test");
            }
            _ => panic!("Expected Single variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

// -----------------------------------------------------------------------
// Serde defaults: DataBar wire with minimal fields
// -----------------------------------------------------------------------

#[test]
fn test_data_bar_wire_deser_minimal() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#000000" },
            "positiveColor": "#638EC6"
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.positive_color, Color::from_hex("#638EC6").unwrap());
            assert!(!db.show_border);
            assert!(!db.gradient);
            assert_eq!(db.direction, CFDataBarDirection::LeftToRight);
            assert_eq!(db.axis_position, CFDataBarAxisPosition::Automatic);
            assert!(db.show_value);
            assert_eq!(db.min_length, 10);
            assert_eq!(db.max_length, 90);
            assert!(db.negative_color.is_none());
            assert!(db.border_color.is_none());
            assert!(db.axis_color.is_none());
        }
        _ => panic!("Expected DataBar variant"),
    }
}

#[test]
fn test_icon_set_wire_deser_minimal() {
    // NoIcons has icon_count == 0, so empty thresholds are valid
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "NoIcons",
            "thresholds": []
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::IconSet(is) => {
            assert_eq!(is.icon_set_name, CFIconSetName::NoIcons);
            assert!(!is.reverse_order);
            assert!(!is.show_icon_only);
        }
        _ => panic!("Expected IconSet variant"),
    }
}

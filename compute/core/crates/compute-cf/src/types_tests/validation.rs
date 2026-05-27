use super::*;

#[test]
fn test_wire_deser_cell_value_missing_operator_errors() {
    let json = r#"{
        "ruleType": "cellValue",
        "priority": 0,
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("operator"));
}

// -----------------------------------------------------------------------
// TryFrom error cases: missing required fields
// -----------------------------------------------------------------------

#[test]
fn test_try_from_color_scale_missing_field() {
    let json = r#"{"ruleType":"colorScale","priority":1,"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("colorScale"));
}

#[test]
fn test_try_from_data_bar_missing_field() {
    let json = r#"{"ruleType":"dataBar","priority":1,"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("dataBar"));
}

#[test]
fn test_try_from_icon_set_missing_field() {
    let json = r#"{"ruleType":"iconSet","priority":1,"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("iconSet"));
}

#[test]
fn test_try_from_contains_text_missing_operator() {
    let json = r#"{"ruleType":"containsText","priority":1,"text":"hello","style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("textOperator"));
}

#[test]
fn test_try_from_time_period_missing_period() {
    let json = r#"{"ruleType":"timePeriod","priority":1,"style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("datePeriod"));
}

#[test]
fn test_try_from_formula_empty_string_errors() {
    let json = r#"{"ruleType":"formula","priority":1,"formula":"  ","style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("formula"));
}

#[test]
fn test_try_from_formula_missing_field_errors() {
    let json = r#"{"ruleType":"formula","priority":1,"style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("formula"));
}

// -----------------------------------------------------------------------
// std::error::Error impl for CFRuleValidationError
// -----------------------------------------------------------------------

#[test]
fn test_cf_rule_validation_error_is_std_error() {
    let err: Box<dyn std::error::Error> = Box::new(CFRuleValidationError::MissingOperator);
    assert!(err.to_string().contains("operator"));
}

// =======================================================================
// NEW validation error tests
// =======================================================================

#[test]
fn test_invalid_color_error() {
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "min", "color": "not-a-color" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidColor(c) => assert_eq!(c, "not-a-color"),
        _ => panic!("Expected InvalidColor, got {:?}", err),
    }
    assert!(err.to_string().contains("not-a-color"));
}

#[test]
fn test_invalid_threshold_value_error() {
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "number", "value": "abc", "color": "#FF0000" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidThresholdValue(v) => assert_eq!(v, "abc"),
        _ => panic!("Expected InvalidThresholdValue, got {:?}", err),
    }
}

#[test]
fn test_cell_value_arity_between_needs_2() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidCellValueArity {
            operator,
            expected,
            got,
        } => {
            assert_eq!(*operator, CFOperator::Between);
            assert_eq!(*expected, 2);
            assert_eq!(*got, 1);
        }
        _ => panic!("Expected InvalidCellValueArity, got {:?}", err),
    }
}

#[test]
fn test_cell_value_arity_single_needs_1() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "greaterThan",
        "values": [],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidCellValueArity {
            operator,
            expected,
            got,
        } => {
            assert_eq!(*operator, CFOperator::GreaterThan);
            assert_eq!(*expected, 1);
            assert_eq!(*got, 0);
        }
        _ => panic!("Expected InvalidCellValueArity, got {:?}", err),
    }
}

#[test]
fn test_data_bar_min_length_exceeds_max() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#000000" },
            "positiveColor": "#638EC6",
            "minLength": 95,
            "maxLength": 10
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::DataBarMinLengthExceedsMax {
            min_length,
            max_length,
        } => {
            assert_eq!(*min_length, 95);
            assert_eq!(*max_length, 10);
        }
        _ => panic!("Expected DataBarMinLengthExceedsMax, got {:?}", err),
    }
}

#[test]
fn test_icon_set_threshold_count_mismatch() {
    // 3Arrows needs 2 thresholds (icon_count - 1 = 3 - 1 = 2)
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "3Arrows",
            "thresholds": [
                { "type": "percent", "value": "33", "operator": "greaterThanOrEqual" }
            ],
            "reverseOrder": false,
            "showIconOnly": false
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::IconSetThresholdCountMismatch { expected, got } => {
            assert_eq!(*expected, 2);
            assert_eq!(*got, 1);
        }
        _ => panic!("Expected IconSetThresholdCountMismatch, got {:?}", err),
    }
}

#[test]
fn test_icon_set_no_icons_allows_empty_thresholds() {
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "NoIcons",
            "thresholds": [],
            "reverseOrder": false,
            "showIconOnly": false
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_ok());
}

#[test]
fn test_icon_set_custom_allows_any_thresholds() {
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "Custom",
            "thresholds": [
                { "type": "percent", "value": "50", "operator": "greaterThanOrEqual" }
            ],
            "reverseOrder": false,
            "showIconOnly": false
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_ok());
}

// -----------------------------------------------------------------------
// Validation error Display coverage
// -----------------------------------------------------------------------

#[test]
fn test_validation_error_display_all_variants() {
    let errors: Vec<CFRuleValidationError> = vec![
        CFRuleValidationError::MissingOperator,
        CFRuleValidationError::MissingFormula,
        CFRuleValidationError::MissingColorScale,
        CFRuleValidationError::MissingDataBar,
        CFRuleValidationError::MissingIconSet,
        CFRuleValidationError::MissingTimePeriod,
        CFRuleValidationError::MissingTextOperator,
        CFRuleValidationError::InvalidColor("bad".to_string()),
        CFRuleValidationError::InvalidThresholdValue("xyz".to_string()),
        CFRuleValidationError::InvalidCellValueArity {
            operator: CFOperator::Between,
            expected: 2,
            got: 1,
        },
        CFRuleValidationError::BetweenValuesNotNumeric {
            value: "abc".to_string(),
        },
        CFRuleValidationError::DataBarMinLengthExceedsMax {
            min_length: 95,
            max_length: 10,
        },
        CFRuleValidationError::IconSetThresholdCountMismatch {
            expected: 2,
            got: 1,
        },
    ];

    for err in errors {
        // Just verify Display doesn't panic and produces non-empty output
        let msg = err.to_string();
        assert!(!msg.is_empty(), "Empty display for {:?}", err);
    }
}

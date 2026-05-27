use super::*;

#[test]
fn test_between_values_not_numeric() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10", "abc"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "abc");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_between_rejects_nan() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["NaN", "10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "NaN");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_between_rejects_infinity() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10", "Infinity"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "Infinity");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_not_between_rejects_negative_infinity() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "notBetween",
        "values": ["-Infinity", "10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "-Infinity");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

// -----------------------------------------------------------------------
// Between with non-numeric values produces BetweenValuesNotNumeric error
// -----------------------------------------------------------------------

#[test]
fn test_wire_between_non_numeric_first_value() {
    // In Excel, Between/NotBetween CF rules require numeric thresholds.
    // Non-numeric values like "abc" should produce a validation error.
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["abc", "100"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);

    assert!(result.is_err());
    match result.unwrap_err() {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "abc");
        }
        other => panic!("Expected BetweenValuesNotNumeric, got {:?}", other),
    }
}

#[test]
fn test_wire_between_non_numeric_second_value() {
    // Second value is non-numeric
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10", "xyz"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);

    assert!(result.is_err());
    match result.unwrap_err() {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "xyz");
        }
        other => panic!("Expected BetweenValuesNotNumeric, got {:?}", other),
    }
}

#[test]
fn test_wire_not_between_non_numeric_values() {
    // NotBetween operator should also reject non-numeric values
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "notBetween",
        "values": ["hello", "world"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);

    assert!(result.is_err());
    match result.unwrap_err() {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            // First non-numeric value should be reported
            assert_eq!(value, "hello");
        }
        other => panic!("Expected BetweenValuesNotNumeric, got {:?}", other),
    }
}

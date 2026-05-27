use super::*;

// -----------------------------------------------------------------------
// Wire deserialization: ContainsText rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_contains_text_rule() {
    let json = r##"{
        "ruleType": "containsText",
        "priority": 1,
        "textOperator": "beginsWith",
        "text": "hello",
        "style": { "fontColor": "#0000FF" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text } => {
            assert_eq!(*operator, CFTextOperator::BeginsWith);
            assert_eq!(text, "hello");
        }
        _ => panic!("Expected ContainsText variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().font_color,
        Some(Color::from_hex("#0000FF").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: ContainsBlanks rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_contains_blanks_rule() {
    let json = r##"{
        "ruleType": "containsBlanks",
        "priority": 1,
        "blanks": true,
        "style": { "backgroundColor": "#CCCCCC" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsBlanks { blanks } => {
            assert!(*blanks);
        }
        _ => panic!("Expected ContainsBlanks variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#CCCCCC").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: ContainsErrors rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_contains_errors_rule() {
    let json = r##"{
        "ruleType": "containsErrors",
        "priority": 1,
        "errors": false,
        "style": { "backgroundColor": "#00FF00" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsErrors { errors } => {
            assert!(!*errors);
        }
        _ => panic!("Expected ContainsErrors variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#00FF00").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: TimePeriod rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_time_period_rule() {
    let json = r#"{
        "ruleType": "timePeriod",
        "priority": 1,
        "datePeriod": "thisWeek",
        "style": { "italic": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::TimePeriod { period } => {
            assert_eq!(*period, DatePeriod::ThisWeek);
        }
        _ => panic!("Expected TimePeriod variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().italic, Some(true));
}

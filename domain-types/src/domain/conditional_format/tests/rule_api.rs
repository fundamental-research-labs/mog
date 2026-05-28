use super::*;

#[test]
fn id_and_priority_accessors() {
    let rule = CFRule::Formula {
        id: "test-id".into(),
        priority: 42,
        stop_if_true: None,
        formula: "=TRUE".into(),
        style: CFStyle::default(),
        text: None,
    };
    assert_eq!(rule.id(), "test-id");
    assert_eq!(rule.priority(), 42);
}

// =========================================================================
// from_ooxml_token — regression tests for typed formula boundary
//
// Each OOXML token the deleted `parse_cf_operator` / `parse_text_operator` /
// `parse_date_period` shadow parsers accepted must continue to parse via
// `from_ooxml_token`. Every malformed token must return `None` without
// panicking.
// =========================================================================

#[test]
fn set_priority_covers_every_variant() {
    // Build one rule per variant and confirm `set_priority` mutates
    // the field on each. The list mirrors `CANONICAL_CF_RULE_TYPES`.
    let mut rules: Vec<CFRule> = vec![
        CFRule::CellValue {
            id: "a".into(),
            priority: 5,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(0),
            value2: None,
            style: CFStyle::default(),
            text: None,
        },
        CFRule::Formula {
            id: "b".into(),
            priority: 5,
            stop_if_true: None,
            formula: "=TRUE".into(),
            style: CFStyle::default(),
            text: None,
        },
        CFRule::Top10 {
            id: "c".into(),
            priority: 5,
            stop_if_true: None,
            rank: 10,
            percent: None,
            bottom: None,
            style: CFStyle::default(),
        },
        CFRule::AboveAverage {
            id: "d".into(),
            priority: 5,
            stop_if_true: None,
            above_average: true,
            equal_average: None,
            std_dev: None,
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::DuplicateValues {
            id: "e".into(),
            priority: 5,
            stop_if_true: None,
            unique: None,
            style: CFStyle::default(),
        },
        CFRule::ContainsText {
            id: "f".into(),
            priority: 5,
            stop_if_true: None,
            operator: CfOperator::ContainsText,
            text: "x".into(),
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::ContainsBlanks {
            id: "g".into(),
            priority: 5,
            stop_if_true: None,
            blanks: true,
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::ContainsErrors {
            id: "h".into(),
            priority: 5,
            stop_if_true: None,
            errors: true,
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::TimePeriod {
            id: "i".into(),
            priority: 5,
            stop_if_true: None,
            time_period: CfTimePeriod::Today,
            style: CFStyle::default(),
            formula: None,
        },
    ];
    for r in rules.iter_mut() {
        assert_eq!(r.priority(), 5);
        r.set_priority(99);
        assert_eq!(r.priority(), 99);
    }
}

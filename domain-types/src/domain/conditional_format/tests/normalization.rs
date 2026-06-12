use super::*;

#[test]
fn normalize_contains_blanks_default_blanks_true() {
    // Canonical schema: `containsBlanks` requires `blanks: bool`. Public
    // callers historically omitted it, expecting the default to be `true`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "containsBlanks",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsBlanks { blanks, .. } => assert!(blanks),
        _ => panic!("expected ContainsBlanks variant"),
    }
}

#[test]
fn normalize_not_contains_blanks_to_contains_blanks_false() {
    // `notContainsBlanks` is a public-API type promotion: the canonical
    // schema only models `containsBlanks` with `blanks: bool`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "notContainsBlanks",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsBlanks { blanks, .. } => assert!(!blanks),
        _ => panic!("expected ContainsBlanks variant"),
    }
}

#[test]
fn normalize_contains_errors_default_errors_true() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "containsErrors",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsErrors { errors, .. } => assert!(errors),
        _ => panic!("expected ContainsErrors variant"),
    }
}

#[test]
fn normalize_not_contains_errors_to_contains_errors_false() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "notContainsErrors",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsErrors { errors, .. } => assert!(!errors),
        _ => panic!("expected ContainsErrors variant"),
    }
}

#[test]
fn normalize_top10_value1_to_rank() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "top10",
        "id": "r1",
        "priority": 1,
        "value1": 5,
        "operator": "topPercent",
        "style": {},
    }));
    match rule {
        CFRule::Top10 {
            rank,
            percent,
            bottom,
            ..
        } => {
            assert_eq!(rank, 5);
            assert_eq!(percent, Some(true));
            assert_eq!(bottom, Some(false));
        }
        _ => panic!("expected Top10 variant"),
    }
}

#[test]
fn normalize_top10_bottom_operator_sets_bottom_flag() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "top10",
        "id": "r1",
        "priority": 1,
        "value1": 3,
        "operator": "bottom",
        "style": {},
    }));
    match rule {
        CFRule::Top10 { rank, bottom, .. } => {
            assert_eq!(rank, 3);
            assert_eq!(bottom, Some(true));
        }
        _ => panic!("expected Top10 variant"),
    }
}

#[test]
fn normalize_cell_value_with_text_op_promotes_to_contains_text() {
    // Public API ergonomics: callers historically sent
    // `{ type: 'cellValue', operator: 'containsText', value1: 'foo' }`.
    // The canonical Rust shape is `{ type: 'containsText', operator:
    // 'containsText', text: 'foo' }`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
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
fn normalize_cell_value_not_contains_promotes_to_contains_text_not_contains() {
    // `notContainsText` is a deprecated public alias; the canonical
    // OOXML token on `containsText.operator` is `notContains`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "notContainsText",
        "value1": "bad",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { operator, text, .. } => {
            assert_eq!(operator, CfOperator::NotContains);
            assert_eq!(text, "bad");
        }
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_cell_value_with_comparison_op_stays_cell_value() {
    // Non-text operators must keep `cellValue` shape untouched.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "greaterThan",
        "value1": 100,
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::GreaterThan);
            assert_eq!(value1, serde_json::json!(100));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn expression_alias_deserializes_to_formula_variant() {
    // Field-rename aliases are handled by `#[serde(alias = "expression")]`
    // on the `Formula` variant, not by `normalize_cf_rule_input`. This
    // test locks the behavior so future refactors can't drop the alias.
    let json = serde_json::json!({
        "type": "expression",
        "id": "r1",
        "priority": 1,
        "formula": "=A1>10",
        "style": {},
    });
    let rule: CFRule = serde_json::from_value(json).unwrap();
    match rule {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=A1>10"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn normalize_contains_text_value1_fallback_to_text() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "containsText",
        "id": "r1",
        "priority": 1,
        "operator": "containsText",
        "value1": "needle",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { text, .. } => assert_eq!(text, "needle"),
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_idempotent_on_canonical_input() {
    // A fully-canonical rule must round-trip unchanged through normalization.
    let canonical = serde_json::json!({
        "type": "containsBlanks",
        "id": "r1",
        "priority": 1,
        "blanks": true,
        "style": {},
    });
    let mut v = canonical.clone();
    normalize_cf_rule_input(&mut v);
    assert_eq!(v, canonical);
}

#[test]
fn normalize_conditional_format_walks_all_rules() {
    let mut cf = serde_json::json!({
        "id": "cf-1",
        "sheetId": "s1",
        "ranges": [],
        "rules": [
            { "type": "notContainsBlanks", "id": "r1", "priority": 1, "style": {} },
            { "type": "expression", "id": "r2", "priority": 2, "formula": "=TRUE", "style": {} },
        ],
    });
    normalize_conditional_format_input(&mut cf);
    let parsed: ConditionalFormat = serde_json::from_value(cf).unwrap();
    assert_eq!(parsed.rules.len(), 2);
    match &parsed.rules[0] {
        CFRule::ContainsBlanks { blanks, .. } => assert!(!blanks),
        _ => panic!("expected ContainsBlanks variant"),
    }
    match &parsed.rules[1] {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=TRUE"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn canonicalize_typed_defaults_materializes_false_flags() {
    let mut format = ConditionalFormat {
        id: "cf-1".into(),
        sheet_id: "s1".into(),
        pivot: None,
        ranges: vec![],
        range_identities: None,
        rules: vec![
            CFRule::Top10 {
                id: "r1".into(),
                priority: 1,
                stop_if_true: None,
                rank: 10,
                percent: None,
                bottom: None,
                style: CFStyle::default(),
            },
            CFRule::DuplicateValues {
                id: "r2".into(),
                priority: 2,
                stop_if_true: None,
                unique: None,
                style: CFStyle::default(),
            },
        ],
    };

    canonicalize_conditional_format_defaults(&mut format);

    match &format.rules[0] {
        CFRule::Top10 {
            percent, bottom, ..
        } => {
            assert_eq!(*percent, Some(false));
            assert_eq!(*bottom, Some(false));
        }
        _ => panic!("expected Top10 variant"),
    }
    match &format.rules[1] {
        CFRule::DuplicateValues { unique, .. } => assert_eq!(*unique, Some(false)),
        _ => panic!("expected DuplicateValues variant"),
    }
}

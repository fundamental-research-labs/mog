use super::helpers::*;

#[test]
fn formula_rule_matches_with_true_result_in_cascade() {
    let rules = vec![
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::Formula {
                formula: "=A1>0".to_string(),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
    ];

    let result = evaluate_rules(
        &n(10.0),
        &rules,
        &default_stats(),
        &[None, Some(CellValue::Boolean(true)), None],
        test_now(),
    )
    .unwrap();
    let style = result.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.italic, Some(true));
}

#[test]
fn formula_rule_skipped_with_false_result_in_cascade() {
    let rules = vec![
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::Formula {
                formula: "=A1>0".to_string(),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
    ];

    let result = evaluate_rules(
        &n(10.0),
        &rules,
        &default_stats(),
        &[None, Some(CellValue::Boolean(false)), None],
        test_now(),
    )
    .unwrap();
    let style = result.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, None);
    assert_eq!(style.italic, Some(true));
}

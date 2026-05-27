use super::helpers::*;

// `stop_if_true` is not global: CascadeEvaluator tracks style and visual
// stops independently, so a matched rule only blocks later rules in its category.

#[test]
fn matching_stopped_style_rule_blocks_later_style_rules() {
    let rules = vec![
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true,
        ),
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                italic: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now()).unwrap();
    let style = result.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.font_color, None);
    assert_eq!(style.italic, None);
}

#[test]
fn non_matching_stopped_rule_does_not_block_later_rules() {
    let rules = vec![
        greater_than_rule(
            "100",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true,
        ),
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now()).unwrap();
    let style = result.style.unwrap();
    assert_eq!(style.background_color, None);
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
}

#[test]
fn visual_rule_returning_none_does_not_stop_later_rules() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rules = vec![
        color_scale_rule(1, true),
        make_rule(
            CFRuleKind::ContainsText {
                operator: CFTextOperator::Contains,
                text: "hello".to_string(),
            },
            Some(CfRenderStyle {
                bold: Some(true),
                font_color: Some(Color::from_hex("#0000FF").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(
        &CellValue::Text("hello world".into()),
        &rules,
        &stats,
        &[],
        test_now(),
    )
    .unwrap();
    let style = result.style.unwrap();
    assert!(result.color_scale.is_none());
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.font_color, Some(Color::from_hex("#0000FF").unwrap()));
}

#[test]
fn visual_stop_blocks_later_visual_rules() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rules = vec![color_scale_rule(1, true), data_bar_rule(2, false)];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now()).unwrap();
    assert!(result.color_scale.is_some());
    assert!(result.data_bar.is_none());
}

#[test]
fn style_stop_and_visual_stop_are_independent_categories() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let style_then_visual = vec![
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true,
        ),
        color_scale_rule(2, false),
    ];
    let visual_then_style = vec![
        color_scale_rule(1, true),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                bold: Some(true),
                font_color: Some(Color::from_hex("#0000FF").unwrap()),
                ..Default::default()
            }),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &style_then_visual, &stats, &[], test_now()).unwrap();
    assert_eq!(
        result.style.unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert!(result.color_scale.is_some());

    let result = evaluate_rules(&n(50.0), &visual_then_style, &stats, &[], test_now()).unwrap();
    let style = result.style.unwrap();
    assert!(result.color_scale.is_some());
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.font_color, Some(Color::from_hex("#0000FF").unwrap()));
}

#[test]
fn middle_matching_stop_blocks_only_later_style_rules() {
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
            CFRuleKind::ContainsBlanks { blanks: false },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            true,
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

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now()).unwrap();
    let style = result.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.italic, None);
}

#[test]
fn all_rules_stop_if_true_returns_first_matching_style_result() {
    let rules = vec![
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            true,
        ),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            2,
            true,
        ),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            true,
        ),
    ];

    let result = evaluate_rules(&n(10.0), &rules, &default_stats(), &[], test_now()).unwrap();
    let style = result.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.font_color, None);
    assert_eq!(style.italic, None);
}

#[test]
fn cascade_is_stopped_reports_same_category_stop() {
    let mut cascade = CascadeEvaluator::new();
    let rule1 = greater_than_rule("5", Some(test_style()), 1, true);
    let rule2 = greater_than_rule(
        "0",
        Some(CfRenderStyle {
            bold: Some(true),
            ..Default::default()
        }),
        2,
        false,
    );

    cascade.apply(&n(10.0), &rule1, &default_stats(), None, test_now());

    assert!(cascade.is_stopped(&rule2));
}

#[test]
fn cascade_is_stopped_does_not_cross_categories() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let mut cascade = CascadeEvaluator::new();
    let rule1 = greater_than_rule("0", Some(test_style()), 1, true);
    let rule2 = color_scale_rule(2, false);

    cascade.apply(&n(50.0), &rule1, &stats, None, test_now());

    assert!(!cascade.is_stopped(&rule2));
}

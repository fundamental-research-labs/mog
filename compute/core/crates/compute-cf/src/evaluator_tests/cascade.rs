use super::helpers::*;

#[test]
fn no_rules_returns_none() {
    let result = evaluate_rules(&n(5.0), &[], &default_stats(), &[], test_now());
    assert!(result.is_none());
}

#[test]
fn single_matching_rule_returns_style() {
    let rules = vec![greater_than_rule("10", Some(test_style()), 1, false)];

    let result = evaluate_rules(&n(15.0), &rules, &default_stats(), &[], test_now()).unwrap();
    let style = result.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
}

#[test]
fn single_non_matching_rule_returns_none() {
    let rules = vec![greater_than_rule("10", Some(test_style()), 1, false)];

    let result = evaluate_rules(&n(5.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_none());
}

#[test]
fn multiple_rules_merge_in_priority_order() {
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
        greater_than_rule(
            "5",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#0000FF").unwrap()),
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
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
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
}

#[test]
fn no_matches_returns_none() {
    let rules = vec![
        greater_than_rule("100", Some(test_style()), 1, false),
        make_rule(
            CFRuleKind::CellValue {
                comparison: single_comparison(CellValueSingleOp::LessThan, "0"),
            },
            Some(test_style()),
            2,
            false,
        ),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &default_stats(), &[], test_now());
    assert!(result.is_none());
}

#[test]
fn mixed_style_rule_types_merge() {
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
}

#[test]
fn style_and_visual_rule_types_merge() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rules = vec![
        greater_than_rule(
            "25",
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            1,
            false,
        ),
        color_scale_rule(2, false),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now()).unwrap();
    assert_eq!(result.style.unwrap().bold, Some(true));
    assert!(result.color_scale.is_some());
}

#[test]
fn three_rules_all_match_full_merge() {
    let rules = vec![
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                bold: Some(true),
                ..Default::default()
            }),
            1,
            false,
        ),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                italic: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                strikethrough: Some(true),
                underline_type: Some(CFUnderlineType::Single),
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
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
    assert_eq!(style.italic, Some(true));
    assert_eq!(style.strikethrough, Some(true));
    assert_eq!(style.underline_type, Some(CFUnderlineType::Single));
}

#[test]
fn two_color_scale_rules_higher_priority_wins() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rules = vec![
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#0000FF").unwrap(),
                },
            }),
            None,
            1,
            false,
        ),
        make_rule(
            CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#FFFF00").unwrap(),
                },
            }),
            None,
            2,
            false,
        ),
    ];

    let min_result = evaluate_rules(&n(0.0), &rules, &stats, &[], test_now()).unwrap();
    assert_eq!(min_result.color_scale.unwrap().color, Color::rgb(255, 0, 0));

    let max_result = evaluate_rules(&n(100.0), &rules, &stats, &[], test_now()).unwrap();
    assert_eq!(max_result.color_scale.unwrap().color, Color::rgb(0, 0, 255));
}

#[test]
fn data_bar_icon_set_and_color_scale_can_coexist() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rules = vec![
        data_bar_rule(1, false),
        icon_set_rule(2, false),
        color_scale_rule(3, false),
    ];

    let result = evaluate_rules(&n(50.0), &rules, &stats, &[], test_now()).unwrap();
    assert!(result.data_bar.is_some(), "data_bar should be present");
    assert!(result.icon.is_some(), "icon should be present");
    assert!(
        result.color_scale.is_some(),
        "color_scale should be present"
    );
    assert!((result.data_bar.unwrap().fill_percent - 50.0).abs() < 1e-10);
}

#[test]
fn cascade_empty_finishes_none() {
    let cascade = CascadeEvaluator::new();
    assert!(cascade.finish().is_none());
}

#[test]
fn cascade_single_match_returns_style() {
    let mut cascade = CascadeEvaluator::new();
    let rule = greater_than_rule("5", Some(test_style()), 1, false);

    cascade.apply(&n(10.0), &rule, &default_stats(), None, test_now());

    let result = cascade.finish().unwrap();
    assert!(result.style.is_some());
}

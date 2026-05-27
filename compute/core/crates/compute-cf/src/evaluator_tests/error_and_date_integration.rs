use super::helpers::*;

#[test]
fn error_cell_through_pipeline_returns_no_match_for_numeric_rules() {
    use value_types::CellError;

    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let rules = vec![
        greater_than_rule(
            "0",
            Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            1,
            false,
        ),
        make_rule(
            CFRuleKind::Top10 {
                rank: 3,
                percent: false,
                bottom: false,
            },
            Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            2,
            false,
        ),
        make_rule(
            CFRuleKind::AboveAverage {
                above: true,
                equal_average: false,
                std_dev: 0,
            },
            Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            3,
            false,
        ),
        color_scale_rule(4, false),
    ];

    let result = evaluate_rules(
        &CellValue::Error(CellError::Value, None),
        &rules,
        &stats,
        &[],
        test_now(),
    );
    assert!(result.is_none());
}

#[test]
fn time_period_today_matches_fixed_serial_date() {
    let now = test_now();
    let serial = value_types::date_serial::date_to_serial(&now);
    let rule = style_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(serial), &rule, &default_stats(), None, now).unwrap();
    assert_eq!(
        result.style.unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
}

#[test]
fn time_period_today_does_not_match_yesterday_serial_date() {
    let now = test_now();
    let yesterday = NaiveDate::from_ymd_opt(2026, 1, 14).unwrap();
    let serial = value_types::date_serial::date_to_serial(&yesterday);
    let rule = style_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        1,
        false,
    );

    let result = evaluate_rule(&n(serial), &rule, &default_stats(), None, now);
    assert!(result.is_none());
}

#[test]
fn time_period_text_value_does_not_match() {
    let now = test_now();
    let rule = style_rule(
        CFRuleKind::TimePeriod {
            period: DatePeriod::Today,
        },
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("2026-01-15".into()),
        &rule,
        &default_stats(),
        None,
        now,
    );
    assert!(result.is_none());
}

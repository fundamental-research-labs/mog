use super::helpers::*;

#[test]
fn color_scale_returns_visual_result() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rule = color_scale_rule(1, false);

    let result = evaluate_rule(&n(0.0), &rule, &stats, None, test_now()).unwrap();
    assert_eq!(result.color_scale.unwrap().color, Color::rgb(255, 0, 0));
    assert!(result.style.is_none());
}

#[test]
fn color_scale_non_numeric_returns_none() {
    let stats = stats_from_values(&[0.0, 100.0]);
    let rule = color_scale_rule(1, false);

    let result = evaluate_rule(
        &CellValue::Text("hello".into()),
        &rule,
        &stats,
        None,
        test_now(),
    );
    assert!(result.is_none());
}

#[test]
fn data_bar_returns_visual_result() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rule = data_bar_rule(1, false);

    let result = evaluate_rule(&n(50.0), &rule, &stats, None, test_now()).unwrap();
    assert!((result.data_bar.unwrap().fill_percent - 50.0).abs() < 1e-10);
    assert!(result.style.is_none());
}

#[test]
fn data_bar_non_numeric_returns_none() {
    let stats = stats_from_values(&[0.0, 100.0]);
    let rule = data_bar_rule(1, false);

    let result = evaluate_rule(&CellValue::Null, &rule, &stats, None, test_now());
    assert!(result.is_none());
}

#[test]
fn icon_set_returns_visual_result() {
    let stats = stats_from_values(&[0.0, 50.0, 100.0]);
    let rule = icon_set_rule(1, false);

    let result = evaluate_rule(&n(100.0), &rule, &stats, None, test_now()).unwrap();
    let icon = result.icon.unwrap();
    assert_eq!(icon.set_name, CFIconSetName::ThreeArrows);
    assert!(result.style.is_none());
}

#[test]
fn icon_set_non_numeric_returns_none() {
    let stats = stats_from_values(&[0.0, 100.0]);
    let rule = make_rule(
        CFRuleKind::IconSet(CFIconSet {
            icon_set_name: CFIconSetName::ThreeArrows,
            thresholds: vec![],
            reverse_order: false,
            show_icon_only: false,
        }),
        None,
        1,
        false,
    );

    let result = evaluate_rule(
        &CellValue::Text("text".into()),
        &rule,
        &stats,
        None,
        test_now(),
    );
    assert!(result.is_none());
}

#[test]
fn visual_rules_coerce_true_to_one() {
    let stats = stats_from_values(&[0.0, 1.0]);

    let color_scale = evaluate_rule(
        &CellValue::Boolean(true),
        &color_scale_rule(1, false),
        &stats,
        None,
        test_now(),
    )
    .unwrap();
    assert_eq!(
        color_scale.color_scale.unwrap().color,
        Color::rgb(0, 255, 0)
    );

    let icon = evaluate_rule(
        &CellValue::Boolean(true),
        &icon_set_rule(1, false),
        &stats,
        None,
        test_now(),
    )
    .unwrap()
    .icon
    .unwrap();
    assert_eq!(icon.icon_index, 0);
}

#[test]
fn visual_rules_coerce_false_to_zero() {
    let stats = stats_from_values(&[0.0, 1.0]);
    let result = evaluate_rule(
        &CellValue::Boolean(false),
        &data_bar_rule(1, false),
        &stats,
        None,
        test_now(),
    )
    .unwrap();

    assert!((result.data_bar.unwrap().fill_percent - 10.0).abs() < 1e-10);
}

use super::*;
use crate::cf::types::DatePeriod;
use domain_types::domain::conditional_format::{self as cf, ConditionalFormat};

fn make_style() -> cf::CFStyle {
    cf::CFStyle {
        font_color: Some("#FF0000".to_string()),
        background_color: Some("#00FF00".to_string()),
        bold: Some(true),
        ..Default::default()
    }
}

/// A valid UUID string for sheet_id in tests.
const TEST_SHEET_UUID: &str = "00000000-0000-0000-0000-000000000099";

fn make_format(rules: Vec<cf::CFRule>) -> ConditionalFormat {
    use cell_types::SheetRange;
    ConditionalFormat {
        id: "fmt1".to_string(),
        sheet_id: TEST_SHEET_UUID.to_string(),
        pivot: None,
        range_identities: None,
        ranges: vec![SheetRange::new(0, 0, 5, 3)],
        rules,
    }
}

/// Dummy resolver that always fails - forces fallback to position-based ranges.
fn no_resolve(_sheet: &str, _cell: &str) -> Option<(u32, u32)> {
    None
}

#[test]
fn test_convert_cell_value_rule() {
    use ooxml_types::cond_format::CfOperator;
    let rule = cf::CFRule::CellValue {
        id: "r1".to_string(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::GreaterThan,
        value1: serde_json::json!(42),
        value2: None,
        style: make_style(),
        text: None,
    };
    let formats = vec![make_format(vec![rule])];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].priority, 1);
    assert!(matches!(
        result[0].kind,
        crate::cf::types::CFRuleKind::CellValue { .. }
    ));
}

#[test]
fn test_convert_formula_rule() {
    let rule = cf::CFRule::Formula {
        id: "r1".to_string(),
        priority: 2,
        stop_if_true: Some(true),
        formula: "=A1>10".to_string(),
        style: make_style(),
        text: None,
    };
    let formats = vec![make_format(vec![rule])];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 1);
    assert!(result[0].stop_if_true);
    assert!(matches!(
        result[0].kind,
        crate::cf::types::CFRuleKind::Formula { .. }
    ));
}

#[test]
fn test_convert_multiple_rules_in_format() {
    use ooxml_types::cond_format::CfOperator;
    let rules = vec![
        cf::CFRule::CellValue {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::Equal,
            value1: serde_json::json!("hello"),
            value2: None,
            style: make_style(),
            text: None,
        },
        cf::CFRule::ContainsBlanks {
            id: "r2".to_string(),
            priority: 2,
            stop_if_true: None,
            blanks: true,
            style: make_style(),
            formula: None,
        },
    ];
    let formats = vec![make_format(rules)];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 2);
}

#[test]
fn test_skip_format_with_no_ranges() {
    let format = ConditionalFormat {
        id: "fmt1".to_string(),
        sheet_id: TEST_SHEET_UUID.to_string(),
        pivot: None,
        range_identities: None,
        ranges: vec![],
        rules: vec![cf::CFRule::ContainsBlanks {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            blanks: true,
            style: make_style(),
            formula: None,
        }],
    };
    let result = convert_cf_formats_to_rules(&[format], no_resolve, None);
    assert!(result.is_empty());
}

#[test]
fn test_convert_style_colors() {
    let style = cf::CFStyle {
        font_color: Some("#FF0000".to_string()),
        background_color: Some("#00FF00".to_string()),
        underline_legacy: Some(true),
        ..Default::default()
    };
    let converted = super::style::convert_style(&style);
    assert!(converted.font_color.is_some());
    assert!(converted.background_color.is_some());
    assert_eq!(
        converted.underline_type,
        Some(crate::cf::types::CFUnderlineType::Single)
    );
}

#[test]
fn test_convert_between_cell_value() {
    use ooxml_types::cond_format::CfOperator;
    let rule = cf::CFRule::CellValue {
        id: "r1".to_string(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::Between,
        value1: serde_json::json!(10),
        value2: Some(serde_json::json!(20)),
        style: make_style(),
        text: None,
    };
    let formats = vec![make_format(vec![rule])];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 1);
    assert!(matches!(
        result[0].kind,
        crate::cf::types::CFRuleKind::CellValue {
            comparison: crate::cf::types::CellValueComparison::Between { .. }
        }
    ));
}

#[test]
fn test_convert_color_scale_rule() {
    let rule = cf::CFRule::ColorScale {
        id: "r1".to_string(),
        priority: 1,
        stop_if_true: None,
        color_scale: cf::CFColorScale {
            points: Vec::new(),
            min_point: cf::CFColorPoint {
                value: cf::CFValueRef::Min,
                ooxml_value: None,
                color: "#FF0000".to_string(),
                color_theme: None,
                color_tint: None,
                color_indexed: None,
                color_auto: None,
                ext_lst_xml: None,
            },
            mid_point: None,
            max_point: cf::CFColorPoint {
                value: cf::CFValueRef::Max,
                ooxml_value: None,
                color: "#00FF00".to_string(),
                color_theme: None,
                color_tint: None,
                color_indexed: None,
                color_auto: None,
                ext_lst_xml: None,
            },
        },
    };
    let formats = vec![make_format(vec![rule])];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 1);
    assert!(matches!(
        result[0].kind,
        crate::cf::types::CFRuleKind::ColorScale(_)
    ));
}

#[test]
fn test_convert_data_bar_rule_accepts_ooxml_blank_threshold_colors() {
    use crate::cf::types::CFRuleKind;
    use cell_types::SheetRange;
    use value_types::Color;

    let blank_min = cf::CFColorPoint {
        value: cf::CFValueRef::Min,
        color: String::new(),
        ..Default::default()
    };
    let invalid_max = cf::CFColorPoint {
        value: cf::CFValueRef::Max,
        color: "not-a-color".to_string(),
        ..Default::default()
    };
    let rule = cf::CFRule::DataBar {
        id: "r1".to_string(),
        priority: 1,
        stop_if_true: None,
        data_bar: cf::CFDataBar {
            min_point: blank_min,
            max_point: invalid_max,
            min_length: None,
            max_length: None,
            positive_color: "004472C4".to_string(),
            negative_color: None,
            border_color: None,
            negative_border_color: None,
            show_border: None,
            gradient: None,
            direction: None,
            axis_position: None,
            axis_color: None,
            show_value: None,
            match_positive_fill_color: None,
            match_positive_border_color: None,
            ext_id: None,
        },
    };
    let format = ConditionalFormat {
        id: "fmt1".to_string(),
        sheet_id: TEST_SHEET_UUID.to_string(),
        pivot: None,
        range_identities: None,
        ranges: vec![SheetRange::new(1, 0, 10, 0)],
        rules: vec![rule],
    };

    let result = convert_cf_formats_to_rules(&[format], no_resolve, None);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].ranges[0].start_row(), 1);
    assert_eq!(result[0].ranges[0].start_col(), 0);
    assert_eq!(result[0].ranges[0].end_row(), 10);
    assert_eq!(result[0].ranges[0].end_col(), 0);
    match &result[0].kind {
        CFRuleKind::DataBar(data_bar) => {
            let expected = Color::from_hex("004472C4").unwrap();
            assert_eq!(data_bar.positive_color, expected);
            assert_eq!(data_bar.min_point.color, expected);
            assert_eq!(data_bar.max_point.color, expected);
        }
        other => panic!("expected data bar rule, got {other:?}"),
    }
}

#[test]
fn test_convert_contains_text_rule() {
    use ooxml_types::cond_format::CfOperator;
    let rule = cf::CFRule::ContainsText {
        id: "r1".to_string(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::BeginsWith,
        text: "hello".to_string(),
        style: make_style(),
        formula: None,
    };
    let formats = vec![make_format(vec![rule])];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 1);
    assert!(matches!(
        result[0].kind,
        crate::cf::types::CFRuleKind::ContainsText { .. }
    ));
}

#[test]
fn test_convert_time_period_rule() {
    use ooxml_types::cond_format::CfTimePeriod;
    let rule = cf::CFRule::TimePeriod {
        id: "r1".to_string(),
        priority: 1,
        stop_if_true: None,
        time_period: CfTimePeriod::Today,
        style: make_style(),
        formula: None,
    };
    let formats = vec![make_format(vec![rule])];
    let result = convert_cf_formats_to_rules(&formats, no_resolve, None);
    assert_eq!(result.len(), 1);
    assert!(matches!(
        result[0].kind,
        crate::cf::types::CFRuleKind::TimePeriod {
            period: DatePeriod::Today
        }
    ));
}

#[test]
fn test_fallback_to_position_ranges() {
    use cell_types::SheetRange;

    let format = ConditionalFormat {
        id: "fmt1".to_string(),
        sheet_id: TEST_SHEET_UUID.to_string(),
        pivot: None,
        range_identities: None,
        ranges: vec![SheetRange::new(2, 1, 10, 4)],
        rules: vec![cf::CFRule::ContainsBlanks {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            blanks: true,
            style: make_style(),
            formula: None,
        }],
    };
    let result = convert_cf_formats_to_rules(&[format], no_resolve, None);
    assert_eq!(result.len(), 1);

    let expected_sheet_id = cell_types::SheetId::from_uuid_str(TEST_SHEET_UUID).unwrap();
    assert_eq!(result[0].ranges.len(), 1);
    assert_eq!(result[0].ranges[0].sheet(), expected_sheet_id);
    assert_eq!(result[0].ranges[0].start_row(), 2);
    assert_eq!(result[0].ranges[0].start_col(), 1);
    assert_eq!(result[0].ranges[0].end_row(), 10);
    assert_eq!(result[0].ranges[0].end_col(), 4);
}

#[test]
fn test_range_identities_resolved_via_closure() {
    let tl_id = "00000000-0000-0000-0000-000000000001";
    let br_id = "00000000-0000-0000-0000-000000000002";

    let format = ConditionalFormat {
        id: "fmt1".to_string(),
        sheet_id: TEST_SHEET_UUID.to_string(),
        pivot: None,
        range_identities: Some(vec![
            domain_types::domain::conditional_format::CellIdRange {
                top_left_cell_id: tl_id.to_string(),
                bottom_right_cell_id: br_id.to_string(),
            },
        ]),
        ranges: vec![],
        rules: vec![cf::CFRule::ContainsBlanks {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            blanks: true,
            style: make_style(),
            formula: None,
        }],
    };

    // Resolver that maps our two known cell IDs to positions
    let resolver = |_sheet: &str, cell: &str| -> Option<(u32, u32)> {
        match cell {
            s if s == tl_id => Some((0, 0)),
            s if s == br_id => Some((5, 3)),
            _ => None,
        }
    };

    let result = convert_cf_formats_to_rules(&[format], resolver, None);
    assert_eq!(result.len(), 1);

    let expected_sheet_id = cell_types::SheetId::from_uuid_str(TEST_SHEET_UUID).unwrap();
    assert_eq!(result[0].ranges.len(), 1);
    assert_eq!(result[0].ranges[0].sheet(), expected_sheet_id);
    assert_eq!(result[0].ranges[0].start_row(), 0);
    assert_eq!(result[0].ranges[0].start_col(), 0);
    assert_eq!(result[0].ranges[0].end_row(), 5);
    assert_eq!(result[0].ranges[0].end_col(), 3);
}

#[test]
fn test_range_identities_preferred_over_position_ranges() {
    use cell_types::SheetRange;

    let tl_id = "00000000-0000-0000-0000-000000000001";
    let br_id = "00000000-0000-0000-0000-000000000002";

    let format = ConditionalFormat {
        id: "fmt1".to_string(),
        sheet_id: TEST_SHEET_UUID.to_string(),
        pivot: None,
        range_identities: Some(vec![
            domain_types::domain::conditional_format::CellIdRange {
                top_left_cell_id: tl_id.to_string(),
                bottom_right_cell_id: br_id.to_string(),
            },
        ]),
        // Position-based ranges are different - should NOT be used
        ranges: vec![SheetRange::new(99, 99, 100, 100)],
        rules: vec![cf::CFRule::ContainsBlanks {
            id: "r1".to_string(),
            priority: 1,
            stop_if_true: None,
            blanks: true,
            style: make_style(),
            formula: None,
        }],
    };

    let resolver = |_sheet: &str, cell: &str| -> Option<(u32, u32)> {
        match cell {
            s if s == tl_id => Some((0, 0)),
            s if s == br_id => Some((5, 3)),
            _ => None,
        }
    };

    let result = convert_cf_formats_to_rules(&[format], resolver, None);
    assert_eq!(result.len(), 1);
    // Should use range_identities (0,0)->(5,3), NOT position ranges (99,99)->(100,100)
    assert_eq!(result[0].ranges[0].start_row(), 0);
    assert_eq!(result[0].ranges[0].end_row(), 5);
}

use super::helpers::*;
use domain_types::{
    CFCellRange, CFColorPoint, CFColorScale, CFDataBar, CFIconSet, CFIconThreshold, CFRule,
    CFStyle, CFValueRef, ConditionalFormat,
};
use ooxml_types::cond_format::{CfOperator, CfvoType, IconSetType};
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_conditional_format_cell_value() {
    let mut output = make_single_sheet(
        "CF_CellValue",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap())),
            cell(1, 0, CellValue::Number(FiniteF64::new(20.0).unwrap())),
            cell(2, 0, CellValue::Number(FiniteF64::new(30.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 1;
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-1".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 2, 0)], // A1:A3
        range_identities: None,
        rules: vec![CFRule::CellValue {
            id: "test-rule-1".to_string(),
            operator: CfOperator::GreaterThan,
            value1: serde_json::Value::String("15".to_string()),
            value2: None,
            style: CFStyle::default(),
            priority: 1,
            stop_if_true: None,
            text: None,
        }],
    }];

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_cfs = &rt.sheets[0].conditional_formats;
    assert!(
        !rt_cfs.is_empty(),
        "Conditional formats should survive round-trip"
    );

    // Find a CellValue rule
    let has_cell_value_rule = rt_cfs.iter().any(|cf| {
        cf.rules
            .iter()
            .any(|r| matches!(r, CFRule::CellValue { .. }))
    });
    assert!(
        has_cell_value_rule,
        "CellValue CF rule should survive round-trip. Got: {:?}",
        rt_cfs
    );

    // Verify range preserved (should contain A1, i.e. start_row=0, start_col=0)
    let cf = &rt_cfs[0];
    assert!(
        cf.ranges
            .iter()
            .any(|r| r.start_row() == 0 && r.start_col() == 0),
        "CF range should reference A1. Got: {:?}",
        cf.ranges
    );
}

#[test]
fn roundtrip_conditional_format_formula() {
    let mut output = make_single_sheet(
        "CF_Formula",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(5.0).unwrap()))],
    );
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-formula".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 9, 0)], // A1:A10
        range_identities: None,
        rules: vec![CFRule::Formula {
            id: "test-rule-formula".to_string(),
            formula: "A1>10".to_string(),
            style: CFStyle::default(),
            priority: 1,
            stop_if_true: None,
            text: None,
        }],
    }];

    let rt = roundtrip(&output);
    let rt_cfs = &rt.sheets[0].conditional_formats;
    assert!(!rt_cfs.is_empty(), "CF should survive round-trip");

    let has_formula_rule = rt_cfs
        .iter()
        .any(|cf| cf.rules.iter().any(|r| matches!(r, CFRule::Formula { .. })));
    assert!(
        has_formula_rule,
        "Formula CF rule should survive. Got: {:?}",
        rt_cfs
    );
}

#[test]
fn roundtrip_conditional_format_color_scale() {
    let mut output = make_single_sheet(
        "CF_ColorScale",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap())),
            cell(1, 0, CellValue::Number(FiniteF64::new(50.0).unwrap())),
            cell(2, 0, CellValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 1;
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-cs".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 2, 0)], // A1:A3
        range_identities: None,
        rules: vec![CFRule::ColorScale {
            id: "test-rule-cs".to_string(),
            priority: 1,
            stop_if_true: None,
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: CFColorPoint {
                    value: CFValueRef::Min,
                    color: "#FF0000".to_string(),
                    ..Default::default()
                },
                mid_point: Some(CFColorPoint {
                    value: CFValueRef::Percentile { value: 50.0 },
                    color: "#FFFF00".to_string(),
                    ..Default::default()
                }),
                max_point: CFColorPoint {
                    value: CFValueRef::Max,
                    color: "#00FF00".to_string(),
                    ..Default::default()
                },
            },
        }],
    }];

    let rt = roundtrip(&output);
    let rt_cfs = &rt.sheets[0].conditional_formats;
    assert!(!rt_cfs.is_empty(), "ColorScale CF should survive");

    let has_color_scale = rt_cfs.iter().any(|cf| {
        cf.rules
            .iter()
            .any(|r| matches!(r, CFRule::ColorScale { .. }))
    });
    assert!(
        has_color_scale,
        "ColorScale rule should survive. Got: {:?}",
        rt_cfs
    );

    // Verify color scale structure if the rule survived
    for cf in rt_cfs {
        for rule in &cf.rules {
            if let CFRule::ColorScale { color_scale, .. } = rule {
                // min and max always present; mid_point is optional
                assert!(
                    !color_scale.min_point.color.is_empty()
                        || !color_scale.max_point.color.is_empty(),
                    "ColorScale should have min/max points"
                );
            }
        }
    }
}

#[test]
fn roundtrip_conditional_format_data_bar() {
    let mut output = make_single_sheet(
        "CF_DataBar",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(25.0).unwrap())),
            cell(1, 0, CellValue::Number(FiniteF64::new(75.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 2;
    output.sheets[0].cols = 1;
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-db".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 1, 0)], // A1:A2
        range_identities: None,
        rules: vec![CFRule::DataBar {
            id: "test-rule-db".to_string(),
            priority: 1,
            stop_if_true: None,
            data_bar: CFDataBar {
                min_point: CFColorPoint {
                    value: CFValueRef::Min,
                    color: String::new(),
                    ..Default::default()
                },
                max_point: CFColorPoint {
                    value: CFValueRef::Max,
                    color: String::new(),
                    ..Default::default()
                },
                min_length: None,
                max_length: None,
                positive_color: "#638EC6".to_string(),
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
        }],
    }];

    let rt = roundtrip(&output);
    let rt_cfs = &rt.sheets[0].conditional_formats;
    assert!(!rt_cfs.is_empty(), "DataBar CF should survive");

    let has_data_bar = rt_cfs
        .iter()
        .any(|cf| cf.rules.iter().any(|r| matches!(r, CFRule::DataBar { .. })));
    assert!(
        has_data_bar,
        "DataBar rule should survive. Got: {:?}",
        rt_cfs
    );
}

#[test]
fn roundtrip_conditional_format_icon_set() {
    let mut output = make_single_sheet(
        "CF_IconSet",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap())),
            cell(1, 0, CellValue::Number(FiniteF64::new(50.0).unwrap())),
            cell(2, 0, CellValue::Number(FiniteF64::new(90.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 1;
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-is".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 2, 0)], // A1:A3
        range_identities: None,
        rules: vec![CFRule::IconSet {
            id: "test-rule-is".to_string(),
            priority: 1,
            stop_if_true: None,
            icon_set: CFIconSet {
                icon_set_name: IconSetType::ThreeTrafficLights1,
                reverse_order: None,
                show_icon_only: None,
                percent: None,
                thresholds: vec![
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("0".to_string()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("33".to_string()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("67".to_string()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                ],
                custom_icons: Vec::new(),
            },
        }],
    }];

    let rt = roundtrip(&output);
    let rt_cfs = &rt.sheets[0].conditional_formats;
    assert!(!rt_cfs.is_empty(), "IconSet CF should survive");

    let has_icon_set = rt_cfs
        .iter()
        .any(|cf| cf.rules.iter().any(|r| matches!(r, CFRule::IconSet { .. })));
    assert!(
        has_icon_set,
        "IconSet rule should survive. Got: {:?}",
        rt_cfs
    );
}

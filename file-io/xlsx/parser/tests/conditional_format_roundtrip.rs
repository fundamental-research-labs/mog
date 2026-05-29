//! End-to-end round-trip tests for worksheet-level `<conditionalFormatting>`.
//!
//! Typed OOXML preservation: inventory row 5.4 deleted the raw-XML sidecar
//! raw worksheet XML sidecars; the writer now
//! always reconstructs `<conditionalFormatting>` from the typed
//! `SheetData.conditional_formats` list. These tests lock the typed
//! reconstruction for the rule variants that already had lossless
//! domain coverage (CellValue with operator, ColorScale with `CFValueRef`
//! points, IconSet with typed thresholds, DataBar with typed cfvos).

use domain_types::{
    CFCellRange, CFColorPoint, CFColorScale, CFDataBar, CFIconSet, CFIconThreshold, CFRule,
    CFStyle, CFValueRef, ConditionalFormat, ParseOutput, SheetData, SheetDimensions,
};
use ooxml_types::cond_format::{CfOperator, IconSetType};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

fn make_sheet_with_cf(cf: ConditionalFormat) -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 4,
            cells: Vec::new(),
            dimensions: SheetDimensions::default(),
            conditional_formats: vec![cf],
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn cf_cell_value_rule_round_trips() {
    let cf = ConditionalFormat {
        id: "cf-cellvalue".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 9, 0)], // A1:A10
        range_identities: None,
        rules: vec![CFRule::CellValue {
            id: "rule-1".to_string(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::Value::String("50".to_string()),
            value2: None,
            style: CFStyle::default(),
            text: None,
        }],
    };

    let po = make_sheet_with_cf(cf);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    assert_eq!(&bytes[0..2], b"PK");

    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let cfs = &rt.sheets[0].conditional_formats;
    assert_eq!(
        cfs.len(),
        1,
        "expected one conditional format round-tripped"
    );
    assert_eq!(cfs[0].rules.len(), 1);
    match &cfs[0].rules[0] {
        CFRule::CellValue { operator, .. } => assert_eq!(*operator, CfOperator::GreaterThan),
        other => panic!("expected CellValue rule, got {:?}", other),
    }
}

#[test]
fn cf_formula_dxf_fill_round_trips() {
    let cf = ConditionalFormat {
        id: "cf-formula-dxf".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 9, 0)], // A1:A10
        range_identities: None,
        rules: vec![CFRule::Formula {
            id: "rule-formula".to_string(),
            priority: 1,
            stop_if_true: None,
            formula: "A1>0".to_string(),
            style: CFStyle {
                background_color: Some("#FFCCCC".to_string()),
                dxf_id: Some(0),
                ..Default::default()
            },
            text: None,
        }],
    };

    let po = make_sheet_with_cf(cf);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");

    match &rt.sheets[0].conditional_formats[0].rules[0] {
        CFRule::Formula { style, .. } => {
            assert_eq!(style.dxf_id, Some(0));
            assert_eq!(style.background_color.as_deref(), Some("#ffcccc"));
        }
        other => panic!("expected Formula rule, got {:?}", other),
    }
}

#[test]
fn cf_color_scale_rule_round_trips_with_typed_value_refs() {
    // Exercises the CFValueRef typed boundary (typed OOXML preservation 6.1) that row 5.4
    // depends on: min / percentile / max points serialize as `<cfvo>` with
    // the right `type=`/`val=` attributes and round-trip losslessly.
    let cf = ConditionalFormat {
        id: "cf-colorscale".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 1, 9, 1)], // B1:B10
        range_identities: None,
        rules: vec![CFRule::ColorScale {
            id: "rule-cs".to_string(),
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
    };

    let po = make_sheet_with_cf(cf);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");

    let cfs = &rt.sheets[0].conditional_formats;
    assert_eq!(cfs.len(), 1);
    match &cfs[0].rules[0] {
        CFRule::ColorScale { color_scale, .. } => {
            assert!(
                matches!(color_scale.min_point.value, CFValueRef::Min),
                "min point type lost",
            );
            assert!(
                matches!(
                    color_scale.mid_point.as_ref().map(|p| &p.value),
                    Some(CFValueRef::Percentile { .. })
                ),
                "mid point type lost",
            );
            assert!(
                matches!(color_scale.max_point.value, CFValueRef::Max),
                "max point type lost",
            );
        }
        other => panic!("expected ColorScale rule, got {:?}", other),
    }
}

#[test]
fn cf_icon_set_rule_round_trips() {
    let cf = ConditionalFormat {
        id: "cf-iconset".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 2, 9, 2)], // C1:C10
        range_identities: None,
        rules: vec![CFRule::IconSet {
            id: "rule-is".to_string(),
            priority: 1,
            stop_if_true: None,
            icon_set: CFIconSet {
                icon_set_name: IconSetType::ThreeArrows,
                reverse_order: Some(true),
                show_icon_only: None,
                percent: None,
                thresholds: vec![
                    CFIconThreshold {
                        value_type: ooxml_types::cond_format::CfvoType::Percent,
                        value: Some("33".into()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                    CFIconThreshold {
                        value_type: ooxml_types::cond_format::CfvoType::Percent,
                        value: Some("67".into()),
                        gte: true,
                        ext_lst_xml: None,
                    },
                ],
                custom_icons: Vec::new(),
            },
        }],
    };

    let po = make_sheet_with_cf(cf);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");

    let cfs = &rt.sheets[0].conditional_formats;
    match &cfs[0].rules[0] {
        CFRule::IconSet { icon_set, .. } => {
            assert_eq!(icon_set.icon_set_name, IconSetType::ThreeArrows);
            assert_eq!(icon_set.reverse_order, Some(true));
            assert!(icon_set.thresholds.len() >= 2, "thresholds lost");
        }
        other => panic!("expected IconSet rule, got {:?}", other),
    }
}

#[test]
fn cf_data_bar_rule_round_trips_with_typed_value_refs() {
    let cf = ConditionalFormat {
        id: "cf-databar".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 3, 9, 3)], // D1:D10
        range_identities: None,
        rules: vec![CFRule::DataBar {
            id: "rule-db".to_string(),
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
    };

    let po = make_sheet_with_cf(cf);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");

    let cfs = &rt.sheets[0].conditional_formats;
    match &cfs[0].rules[0] {
        CFRule::DataBar { data_bar, .. } => {
            assert!(matches!(data_bar.min_point.value, CFValueRef::Min));
            assert!(matches!(data_bar.max_point.value, CFValueRef::Max));
        }
        other => panic!("expected DataBar rule, got {:?}", other),
    }
}

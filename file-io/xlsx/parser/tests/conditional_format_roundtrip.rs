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
use ooxml_types::cond_format::{CfOperator, CfTimePeriod, IconSetType};
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

fn rule_matches(rules: &[CFRule], predicate: impl Fn(&CFRule) -> bool) -> bool {
    rules.iter().any(predicate)
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
fn cf_classic_rule_variants_round_trip_as_typed_subset() {
    let cf = ConditionalFormat {
        id: "cf-classic-rules".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(0, 0, 9, 0)], // A1:A10
        range_identities: None,
        rules: vec![
            CFRule::Top10 {
                id: "rule-top10".to_string(),
                priority: 1,
                stop_if_true: None,
                rank: 5,
                percent: Some(true),
                bottom: Some(true),
                style: CFStyle::default(),
            },
            CFRule::AboveAverage {
                id: "rule-above-average".to_string(),
                priority: 2,
                stop_if_true: Some(true),
                above_average: false,
                equal_average: Some(true),
                std_dev: Some(2),
                style: CFStyle::default(),
                formula: Some("A1<AVERAGE($A$1:$A$10)".to_string()),
            },
            CFRule::DuplicateValues {
                id: "rule-unique-values".to_string(),
                priority: 3,
                stop_if_true: None,
                unique: Some(true),
                style: CFStyle::default(),
            },
            CFRule::ContainsText {
                id: "rule-begins-with".to_string(),
                priority: 4,
                stop_if_true: None,
                operator: CfOperator::BeginsWith,
                text: "INV".to_string(),
                style: CFStyle::default(),
                formula: Some("LEFT(A1,3)=\"INV\"".to_string()),
            },
            CFRule::ContainsBlanks {
                id: "rule-not-blank".to_string(),
                priority: 5,
                stop_if_true: None,
                blanks: false,
                style: CFStyle::default(),
                formula: Some("LEN(TRIM(A1))>0".to_string()),
            },
            CFRule::ContainsErrors {
                id: "rule-not-error".to_string(),
                priority: 6,
                stop_if_true: None,
                errors: false,
                style: CFStyle::default(),
                formula: Some("NOT(ISERROR(A1))".to_string()),
            },
            CFRule::TimePeriod {
                id: "rule-last-week".to_string(),
                priority: 7,
                stop_if_true: None,
                time_period: CfTimePeriod::LastWeek,
                style: CFStyle::default(),
                formula: Some("AND(TODAY()-A1>=7,TODAY()-A1<14)".to_string()),
            },
        ],
    };

    let po = make_sheet_with_cf(cf);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");

    let rules = &rt.sheets[0].conditional_formats[0].rules;
    assert_eq!(rules.len(), 7, "classic CF rules should all round-trip");
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::Top10 {
            rank: 5,
            percent: Some(true),
            bottom: Some(true),
            ..
        }
    )));
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::AboveAverage {
            above_average: false,
            equal_average: Some(true),
            std_dev: Some(2),
            stop_if_true: Some(true),
            formula: Some(formula),
            ..
        } if formula == "A1<AVERAGE($A$1:$A$10)"
    )));
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::DuplicateValues {
            unique: Some(true),
            ..
        }
    )));
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::ContainsText {
            operator: CfOperator::BeginsWith,
            text,
            formula: Some(formula),
            ..
        } if text == "INV" && formula == "LEFT(A1,3)=\"INV\""
    )));
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::ContainsBlanks {
            blanks: false,
            formula: Some(formula),
            ..
        } if formula == "LEN(TRIM(A1))>0"
    )));
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::ContainsErrors {
            errors: false,
            formula: Some(formula),
            ..
        } if formula == "NOT(ISERROR(A1))"
    )));
    assert!(rule_matches(rules, |rule| matches!(
        rule,
        CFRule::TimePeriod {
            time_period: CfTimePeriod::LastWeek,
            formula: Some(formula),
            ..
        } if formula == "AND(TODAY()-A1>=7,TODAY()-A1<14)"
    )));
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

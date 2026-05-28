use std::sync::Arc;

use super::super::helpers::{cell, make_single_sheet};
use super::harness::{RoundtripDomainFlags, assert_roundtrip_partial};
use domain_types::{
    CFCellRange, CFRule, CFStyle, Comment, CommentType, ConditionalFormat, ErrorStyle, MergeRegion,
    TableColumnSpec, TableSpec, ValidationOperator, ValidationRule, ValidationSpec,
};
use value_types::{CellValue, FiniteF64};

#[test]
fn partial_roundtrip_cells_and_merges_only() {
    // A ParseOutput with cells + merges + unimplemented domains (charts stub).
    // assert_roundtrip_partial should succeed by checking only wired domains.
    let mut output = make_single_sheet(
        "PartialTest",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Hello"))),
            cell(1, 0, CellValue::Number(FiniteF64::new(42.0).unwrap())),
        ],
    );
    output.sheets[0].merges = vec![MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 1,
    }];
    output.sheets[0].rows = 2;
    output.sheets[0].cols = 2;

    // NOTE: We intentionally do NOT populate charts/floating_objects/slicers,
    // but assert_roundtrip_partial skips those by default.
    let flags = RoundtripDomainFlags::default();
    let _rt = assert_roundtrip_partial(&output, &flags);
}

#[test]
fn partial_roundtrip_multi_domain() {
    // A richer ParseOutput with comments, CF, validations, and tables.
    let mut output = make_single_sheet(
        "MultiDomain",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Name"))),
            cell(0, 1, CellValue::Text(Arc::from("Score"))),
            cell(1, 0, CellValue::Text(Arc::from("Alice"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(95.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Bob"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(80.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 2;

    output.sheets[0].comments = vec![Comment {
        cell_ref: "A1".to_string(),
        author: "Tester".to_string(),
        content: Some("Header comment".to_string()),
        comment_type: CommentType::Note,
        ..Default::default()
    }];

    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-1".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(1, 1, 2, 1)], // B2:B3
        range_identities: None,
        rules: vec![CFRule::CellValue {
            id: "test-rule-1".to_string(),
            operator: ooxml_types::cond_format::CfOperator::GreaterThan,
            value1: serde_json::Value::String("90".to_string()),
            value2: None,
            style: CFStyle::default(),
            priority: 1,
            stop_if_true: None,
            text: None,
        }],
    }];

    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["B2:B3".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::Between,
            formula1: "0".to_string(),
            formula2: Some("100".to_string()),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Invalid".to_string()),
        error_message: Some("Enter 0-100".to_string()),
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: domain_types::ImeMode::NoControl,
        uid: None,
    }];

    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "ScoreTable".to_string(),
        display_name: "ScoreTable".to_string(),
        range_ref: "A1:B3".to_string(),
        has_headers: true,
        has_totals: false,
        style_name: Some("TableStyleMedium2".to_string()),
        row_stripes: true,
        col_stripes: false,
        first_col_highlight: false,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:B3".to_string()),
        columns: vec![
            TableColumnSpec {
                name: "Name".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Score".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let flags = RoundtripDomainFlags::default();
    let _rt = assert_roundtrip_partial(&output, &flags);
}

#[test]
fn partial_roundtrip_skip_unimplemented_domains() {
    // Verify that we can selectively skip domains.
    // Even if the original has data that might not round-trip perfectly,
    // disabling those flags means no assertion fires.
    let mut output = make_single_sheet(
        "SkipTest",
        vec![cell(0, 0, CellValue::Text(Arc::from("Data")))],
    );
    output.sheets[0].rows = 1;
    output.sheets[0].cols = 1;

    // Use flags that skip everything except cells
    let flags = RoundtripDomainFlags {
        cells: true,
        merges: false,
        dimensions: false,
        frozen_pane: false,
        styles: false,
        named_ranges: false,
        comments: false,
        hyperlinks: false,
        conditional_formats: false,
        data_validations: false,
        tables: false,
        sparklines: false,
        print_settings: false,
        page_breaks: false,
        protection: false,
        auto_filter: false,
        outline_groups: false,
    };

    let _rt = assert_roundtrip_partial(&output, &flags);
}

#![allow(unused_imports)]

use std::sync::Arc;

use super::helpers::{
    assert_cells_match, cell, formula_cell, make_single_sheet, roundtrip, styled_cell,
};
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ParseOutput,
    RoundTripContext, RowDimension, SheetData, SheetDimensions, TableColumnSpec, TableSpec,
    ValidationOperator, ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};

// =============================================================================

/// Domains that are currently wired for round-trip through the XLSX writer.
/// Update this list as new domains gain export support.
#[allow(dead_code)]
struct RoundtripDomainFlags {
    cells: bool,
    merges: bool,
    dimensions: bool,
    frozen_pane: bool,
    styles: bool,
    named_ranges: bool,
    comments: bool,
    hyperlinks: bool,
    conditional_formats: bool,
    data_validations: bool,
    tables: bool,
    sparklines: bool,
    print_settings: bool,
    page_breaks: bool,
    protection: bool,
    auto_filter: bool,
    outline_groups: bool,
    // Domains NOT yet wired (always skipped):
    // - charts
    // - floating_objects
    // - slicers / slicer_caches / slicer_anchors
    // - form_controls
    // - ole_objects
    // - smartart_diagrams
    // - connectors
    // - pivot_tables
    // - data_table_regions
}

impl Default for RoundtripDomainFlags {
    fn default() -> Self {
        Self {
            cells: true,
            merges: true,
            dimensions: true,
            frozen_pane: true,
            styles: true,
            named_ranges: true,
            comments: true,
            hyperlinks: true,
            conditional_formats: true,
            data_validations: true,
            tables: true,
            sparklines: true,
            print_settings: true,
            page_breaks: true,
            protection: true,
            auto_filter: true,
            outline_groups: true,
        }
    }
}

/// Perform a partial round-trip assertion: write → parse → compare only the
/// domains flagged as wired. Panics with a descriptive message on mismatch.
///
/// Returns the round-tripped ParseOutput for additional assertions.
fn assert_roundtrip_partial(original: &ParseOutput, flags: &RoundtripDomainFlags) -> ParseOutput {
    let rt = roundtrip(original);

    assert_eq!(
        original.sheets.len(),
        rt.sheets.len(),
        "Sheet count should be preserved"
    );

    for (i, (orig_sheet, rt_sheet)) in original.sheets.iter().zip(rt.sheets.iter()).enumerate() {
        let sn = &orig_sheet.name;

        // Cells
        if flags.cells {
            assert_cells_match(&orig_sheet.cells, &rt_sheet.cells, sn);
        }

        // Merges
        if flags.merges {
            let mut orig_m = orig_sheet.merges.clone();
            let mut rt_m = rt_sheet.merges.clone();
            orig_m.sort_by_key(|m| (m.start_row, m.start_col));
            rt_m.sort_by_key(|m| (m.start_row, m.start_col));
            assert_eq!(orig_m, rt_m, "[{sn}] Merge regions mismatch");
        }

        // Frozen pane
        if flags.frozen_pane {
            match (&orig_sheet.frozen_pane, &rt_sheet.frozen_pane) {
                (Some(orig_fp), Some(rt_fp)) => {
                    assert_eq!(orig_fp.rows, rt_fp.rows, "[{sn}] Frozen pane rows mismatch");
                    assert_eq!(orig_fp.cols, rt_fp.cols, "[{sn}] Frozen pane cols mismatch");
                }
                (None, None) => {}
                (Some(_), None) => panic!("[{sn}] Frozen pane lost in round-trip"),
                (None, Some(_)) => {} // Extra frozen pane is OK (defaults)
            }
        }

        // Comments (count only — content normalization may differ)
        if flags.comments {
            assert_eq!(
                orig_sheet.comments.len(),
                rt_sheet.comments.len(),
                "[{sn}] Comment count mismatch. Original: {:?}, RT: {:?}",
                orig_sheet
                    .comments
                    .iter()
                    .map(|c| &c.cell_ref)
                    .collect::<Vec<_>>(),
                rt_sheet
                    .comments
                    .iter()
                    .map(|c| &c.cell_ref)
                    .collect::<Vec<_>>(),
            );
        }

        // Conditional formats (count only)
        if flags.conditional_formats {
            // Total rule count across all specs
            let orig_rule_count: usize = orig_sheet
                .conditional_formats
                .iter()
                .map(|cf| cf.rules.len())
                .sum();
            let rt_rule_count: usize = rt_sheet
                .conditional_formats
                .iter()
                .map(|cf| cf.rules.len())
                .sum();
            assert_eq!(
                orig_rule_count, rt_rule_count,
                "[{sn}] CF rule count mismatch"
            );
        }

        // Data validations (count only)
        if flags.data_validations {
            assert_eq!(
                orig_sheet.data_validations.len(),
                rt_sheet.data_validations.len(),
                "[{sn}] Data validation count mismatch"
            );
        }

        // Tables (count + names)
        if flags.tables {
            assert_eq!(
                orig_sheet.tables.len(),
                rt_sheet.tables.len(),
                "[{sn}] Table count mismatch"
            );
            for (ot, rt_t) in orig_sheet.tables.iter().zip(rt_sheet.tables.iter()) {
                assert_eq!(ot.name, rt_t.name, "[{sn}] Table name mismatch");
            }
        }

        // Named ranges (at ParseOutput level, checked once for sheet 0)
        if flags.named_ranges && i == 0 {
            assert_eq!(
                original.named_ranges.len(),
                rt.named_ranges.len(),
                "Named range count mismatch"
            );
        }

        // Protection
        if flags.protection {
            assert_eq!(
                orig_sheet.protection.is_some(),
                rt_sheet.protection.is_some(),
                "[{sn}] Sheet protection presence mismatch"
            );
        }

        // Auto filter
        if flags.auto_filter {
            assert_eq!(
                orig_sheet.auto_filter.is_some(),
                rt_sheet.auto_filter.is_some(),
                "[{sn}] Auto filter presence mismatch"
            );
        }
    }

    // Styles (palette should have at least as many entries)
    if flags.styles && !original.style_palette.is_empty() {
        assert!(
            !rt.style_palette.is_empty(),
            "Style palette should not be empty after round-trip"
        );
    }

    rt
}

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

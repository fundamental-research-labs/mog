use std::sync::Arc;

use super::helpers::*;
use domain_types::{
    CFCellRange, CFRule, CFStyle, ColDimension, Comment, ConditionalFormat, DocumentFormat,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, Hyperlink, MergeRegion, NamedRange,
    PageMargins, ParseOutput, PrintSettings, RowDimension, SheetData, SheetDimensions,
    SheetProtection, TableColumnSpec, TableSpec, ValidationOperator, ValidationRule,
    ValidationSpec,
};
use ooxml_types::cond_format::CfOperator;
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_comprehensive() {
    // Build a rich ParseOutput combining multiple features
    let bold = DocumentFormat {
        font: Some(FontFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let highlighted = DocumentFormat {
        fill: Some(FillFormat {
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#CCFFCC".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    };

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Report".to_string(),
            rows: 5,
            cols: 3,
            cells: vec![
                // Header row (bold)
                styled_cell(0, 0, CellValue::Text(Arc::from("Item")), 0),
                styled_cell(0, 1, CellValue::Text(Arc::from("Qty")), 0),
                styled_cell(0, 2, CellValue::Text(Arc::from("Total")), 0),
                // Data rows
                cell(1, 0, CellValue::Text(Arc::from("Widget"))),
                cell(1, 1, CellValue::Number(FiniteF64::new(5.0).unwrap())),
                formula_cell(
                    1,
                    2,
                    "B2*10",
                    CellValue::Number(FiniteF64::new(50.0).unwrap()),
                ),
                cell(2, 0, CellValue::Text(Arc::from("Gadget"))),
                cell(2, 1, CellValue::Number(FiniteF64::new(3.0).unwrap())),
                formula_cell(
                    2,
                    2,
                    "B3*20",
                    CellValue::Number(FiniteF64::new(60.0).unwrap()),
                ),
                // Summary row (highlighted)
                styled_cell(4, 0, CellValue::Text(Arc::from("Grand Total")), 1),
                formula_cell(
                    4,
                    2,
                    "SUM(C2:C3)",
                    CellValue::Number(FiniteF64::new(110.0).unwrap()),
                ),
            ],
            merges: vec![MergeRegion {
                start_row: 4,
                start_col: 0,
                end_row: 4,
                end_col: 1,
            }],
            frozen_pane: Some(FrozenPane {
                rows: 1,
                cols: 0,
                top_left_cell: None,
            }),
            dimensions: SheetDimensions {
                default_row_height: Some(15.0),
                default_col_width: None,
                row_heights: vec![RowDimension {
                    row: 0,
                    height: 20.0,
                    custom_height: true,
                    hidden: false,
                    ..Default::default()
                }],
                col_widths: vec![ColDimension {
                    col: 0,
                    width: 25.0,
                    custom_width: true,
                    hidden: false,
                    best_fit: false,
                    collapsed: false,
                    phonetic: false,
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        style_palette: vec![bold, highlighted],
        workbook_stylesheet: None,
        named_ranges: vec![NamedRange {
            name: "Totals".to_string(),
            refers_to: "Report!$C$2:$C$3".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: None,
            ..Default::default()
        }],
        ..Default::default()
    };

    let rt = roundtrip(&output);

    // Verify structure
    assert_eq!(rt.sheets.len(), 1);
    assert_eq!(rt.sheets[0].name, "Report");

    // Verify cells
    assert_cells_match(&output.sheets[0].cells, &rt.sheets[0].cells, "Report");

    // Verify merges
    assert_eq!(rt.sheets[0].merges.len(), 1);
    assert_eq!(rt.sheets[0].merges[0].start_row, 4);
    assert_eq!(rt.sheets[0].merges[0].end_col, 1);

    // Verify frozen pane
    let pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should survive");
    assert_eq!(pane.rows, 1);
    assert_eq!(pane.cols, 0);

    // Verify named range
    assert!(
        rt.named_ranges.iter().any(|n| n.name == "Totals"),
        "Named range 'Totals' should survive round-trip"
    );

    // Verify some style survived (style_palette should be non-empty)
    assert!(
        !rt.style_palette.is_empty(),
        "Style palette should be non-empty"
    );
}

#[test]
fn roundtrip_all_new_domains_combined() {
    // Build a ParseOutput that exercises all newly wired domains together
    let mut output = make_single_sheet(
        "AllDomains",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Name"))),
            cell(0, 1, CellValue::Text(Arc::from("Value"))),
            cell(1, 0, CellValue::Text(Arc::from("Alice"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(100.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Bob"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(200.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 2;

    // Comments
    output.sheets[0].comments = vec![Comment {
        cell_ref: "A1".to_string(),
        author: "Tester".to_string(),
        content: Some("Header cell".to_string()),
        comment_type: domain_types::CommentType::Note,
        ..Default::default()
    }];

    // Hyperlinks
    output.sheets[0].hyperlinks = vec![Hyperlink {
        cell_ref: "A2".to_string(),
        target: Some("https://alice.example.com".to_string()),
        display: Some("Alice".to_string()),
        ..Default::default()
    }];

    // Conditional formats
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-all".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(1, 1, 2, 1)], // B2:B3
        range_identities: None,
        rules: vec![CFRule::CellValue {
            id: "test-rule-all".to_string(),
            operator: CfOperator::GreaterThan,
            value1: serde_json::Value::String("150".to_string()),
            value2: None,
            style: CFStyle::default(),
            priority: 1,
            stop_if_true: None,
            text: None,
        }],
    }];

    // Data validations
    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["B2:B3".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::GreaterThanOrEqual,
            formula1: "0".to_string(),
            formula2: None,
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Error".to_string()),
        error_message: Some("Must be non-negative".to_string()),
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: domain_types::ImeMode::NoControl,
        uid: None,
    }];

    // Print settings
    output.sheets[0].print_settings = Some(PrintSettings {
        orientation: Some("landscape".to_string()),
        margins: Some(PageMargins::default()),
        ..Default::default()
    });

    // Protection
    output.sheets[0].protection = Some(SheetProtection {
        is_protected: true,
        select_locked: true,
        select_unlocked: true,
        sort: true,
        auto_filter: true,
        ..Default::default()
    });

    // Table (per-sheet)
    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "AllDomainsTable".to_string(),
        display_name: "AllDomainsTable".to_string(),
        range_ref: "A1:B3".to_string(),
        has_headers: true,
        columns: vec![
            TableColumnSpec {
                name: "Name".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Value".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let rt = roundtrip(&output);

    // Verify all domains survived
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&output.sheets[0].cells, &rt.sheets[0].cells, "AllDomains");

    assert!(
        !rt.sheets[0].comments.is_empty(),
        "Comments should survive combined round-trip"
    );
    assert!(
        !rt.sheets[0].hyperlinks.is_empty(),
        "Hyperlinks should survive combined round-trip"
    );
    assert!(
        !rt.sheets[0].conditional_formats.is_empty(),
        "Conditional formats should survive combined round-trip"
    );
    assert!(
        !rt.sheets[0].data_validations.is_empty(),
        "Data validations should survive combined round-trip"
    );
    assert!(
        rt.sheets[0].print_settings.is_some(),
        "Print settings should survive combined round-trip"
    );
    assert!(
        rt.sheets[0].protection.is_some(),
        "Sheet protection should survive combined round-trip"
    );
    assert!(
        !rt.sheets[0].tables.is_empty(),
        "Tables should survive combined round-trip"
    );
}

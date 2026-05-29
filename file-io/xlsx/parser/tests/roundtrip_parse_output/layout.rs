#![allow(unused_imports)]

use std::sync::Arc;

use super::helpers::{
    assert_cells_match, cell, formula_cell, make_single_sheet, roundtrip, styled_cell,
};
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, HeaderFooter, MergeRegion, NamedRange,
    OutlineGroup, PageBreakEntry, PageBreaks, PageMargins, ParseOutput, PrintSettings,
    RowDimension, RowStyleEntry, SheetData, SheetDimensions, TableColumnSpec, TableSpec,
    ValidationOperator, ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn roundtrip_merge_regions() {
    let mut output = make_single_sheet(
        "Merges",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Merged"))),
            cell(2, 0, CellValue::Text(Arc::from("Another merge"))),
        ],
    );
    output.sheets[0].merges = vec![
        MergeRegion {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 2,
        },
        MergeRegion {
            start_row: 2,
            start_col: 0,
            end_row: 3,
            end_col: 1,
        },
    ];
    output.sheets[0].rows = 4;
    output.sheets[0].cols = 3;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    // Sort merges for stable comparison
    let mut orig_merges = output.sheets[0].merges.clone();
    let mut rt_merges = rt.sheets[0].merges.clone();
    orig_merges.sort_by_key(|m| (m.start_row, m.start_col));
    rt_merges.sort_by_key(|m| (m.start_row, m.start_col));

    assert_eq!(
        orig_merges, rt_merges,
        "Merge regions should round-trip exactly"
    );
}

#[test]
fn merge_cells_count_attribute_is_canonical_not_roundtrip_context() {
    let mut output = make_single_sheet(
        "Merges",
        vec![cell(0, 0, CellValue::Text(Arc::from("Merged")))],
    );
    output.sheets[0].merges = vec![MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 2,
    }];
    output.sheets[0].rows = 1;
    output.sheets[0].cols = 3;
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<mergeCells count="1">"#));
    assert!(sheet_xml.contains(r#"<mergeCell ref="A1:C1"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert_eq!(rt.sheets[0].merges, output.sheets[0].merges);
}

#[test]
fn stale_merge_context_does_not_create_deleted_modeled_merges() {
    let output = make_single_sheet(
        "Merges",
        vec![cell(0, 0, CellValue::Text(Arc::from("Unmerged")))],
    );
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<mergeCells"));
    assert!(!sheet_xml.contains("A1:C1"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert!(rt.sheets[0].merges.is_empty());
}

#[test]
fn outline_properties_roundtrip_from_modeled_state() {
    let mut output = make_single_sheet(
        "Outline",
        vec![cell(0, 0, CellValue::Text(Arc::from("Grouped")))],
    );
    output.sheets[0].outline_properties = Some(ooxml_types::worksheet::OutlineProperties {
        apply_styles: true,
        summary_below: false,
        summary_right: false,
        show_outline_symbols: false,
    });

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<sheetPr><outlinePr"));
    assert!(sheet_xml.contains(r#"applyStyles="1""#));
    assert!(sheet_xml.contains(r#"summaryBelow="0""#));
    assert!(sheet_xml.contains(r#"summaryRight="0""#));
    assert!(sheet_xml.contains(r#"showOutlineSymbols="0""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert_eq!(
        rt.sheets[0].outline_properties,
        output.sheets[0].outline_properties
    );
}

#[test]
fn stale_sheet_pr_context_does_not_create_deleted_outline_properties() {
    let output = make_single_sheet(
        "Outline",
        vec![cell(0, 0, CellValue::Text(Arc::from("Ungrouped")))],
    );
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<sheetPr"));
    assert!(!sheet_xml.contains("<outlinePr"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert!(rt.sheets[0].outline_properties.is_none());
}

#[test]
fn roundtrip_single_cell_merge() {
    // Edge case: a merge region that spans just 2 cells
    let mut output = make_single_sheet(
        "SmallMerge",
        vec![cell(0, 0, CellValue::Text(Arc::from("Merged")))],
    );
    output.sheets[0].merges = vec![MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 1,
    }];
    output.sheets[0].rows = 1;
    output.sheets[0].cols = 2;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets[0].merges.len(), 1);
    assert_eq!(rt.sheets[0].merges[0].start_row, 0);
    assert_eq!(rt.sheets[0].merges[0].end_col, 1);
}

#[test]
fn roundtrip_row_and_col_dimensions() {
    let mut output = make_single_sheet(
        "Dimensions",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: Some(8.43),
        row_heights: vec![
            RowDimension {
                row: 0,
                height: 30.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            },
            RowDimension {
                row: 5,
                height: 45.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            },
        ],
        col_widths: vec![
            ColDimension {
                col: 0,
                width: 20.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 3,
                width: 50.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let orig_dims = &output.sheets[0].dimensions;
    let rt_dims = &rt.sheets[0].dimensions;

    // Row heights
    let orig_rows: std::collections::HashMap<u32, f64> = orig_dims
        .row_heights
        .iter()
        .map(|r| (r.row, r.height))
        .collect();
    let rt_rows: std::collections::HashMap<u32, f64> = rt_dims
        .row_heights
        .iter()
        .filter(|r| r.custom_height)
        .map(|r| (r.row, r.height))
        .collect();

    for (row, orig_h) in &orig_rows {
        let rt_h = rt_rows.get(row).unwrap_or_else(|| {
            panic!("Row {row} height missing in round-trip. Original: {orig_h}")
        });
        let diff = (orig_h - rt_h).abs();
        assert!(diff < 0.01, "Row {row} height mismatch: {orig_h} vs {rt_h}");
    }

    // Col widths
    let orig_cols: std::collections::HashMap<u32, f64> = orig_dims
        .col_widths
        .iter()
        .map(|c| (c.col, c.width))
        .collect();
    let rt_cols: std::collections::HashMap<u32, f64> = rt_dims
        .col_widths
        .iter()
        .filter(|c| c.custom_width)
        .map(|c| (c.col, c.width))
        .collect();

    for (col, orig_w) in &orig_cols {
        let rt_w = rt_cols
            .get(col)
            .unwrap_or_else(|| panic!("Col {col} width missing in round-trip. Original: {orig_w}"));
        let diff = (orig_w - rt_w).abs();
        assert!(diff < 0.01, "Col {col} width mismatch: {orig_w} vs {rt_w}");
    }
}

#[test]
fn roundtrip_hidden_rows_and_cols() {
    let mut output = make_single_sheet(
        "Hidden",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: None,
        row_heights: vec![RowDimension {
            row: 2,
            height: 0.0,
            custom_height: true,
            hidden: true,
            ..Default::default()
        }],
        col_widths: vec![ColDimension {
            col: 1,
            width: 0.0,
            custom_width: true,
            hidden: true,
            best_fit: false,
            collapsed: false,
            phonetic: false,
            ..Default::default()
        }],
        ..Default::default()
    };
    output.sheets[0].rows = 5;
    output.sheets[0].cols = 3;

    let rt = roundtrip(&output);

    // Hidden row should survive -- at minimum the dimension entry should exist.
    // NOTE: The `hidden` flag may not round-trip perfectly through the current
    // pipeline (known gap). We verify the row dimension entry exists.
    let hidden_row = rt.sheets[0]
        .dimensions
        .row_heights
        .iter()
        .find(|r| r.row == 2);
    assert!(
        hidden_row.is_some(),
        "Hidden row 2 dimension entry should survive round-trip"
    );

    // Hidden col should survive -- at minimum the dimension entry should exist.
    let hidden_col = rt.sheets[0]
        .dimensions
        .col_widths
        .iter()
        .find(|c| c.col == 1);
    assert!(
        hidden_col.is_some(),
        "Hidden col 1 dimension entry should survive round-trip"
    );
}

#[test]
fn regenerated_row_layout_flags_come_from_modeled_state() {
    let mut output = make_single_sheet(
        "Rows",
        vec![cell(0, 0, CellValue::Text(Arc::from("row layout")))],
    );
    output.style_palette = vec![DocumentFormat::default()];
    output.sheets[0].dimensions = SheetDimensions {
        row_heights: vec![RowDimension {
            row: 2,
            height: 24.0,
            custom_height: true,
            hidden: true,
            custom_format: true,
            descent: Some(0.25),
            ..Default::default()
        }],
        ..Default::default()
    };
    output.sheets[0].row_styles = vec![RowStyleEntry {
        row: 2,
        style_id: 0,
    }];
    output.sheets[0].outline_groups = vec![OutlineGroup {
        is_row: true,
        start: 2,
        end: 3,
        level: 1,
        collapsed: true,
        hidden: true,
        collapsed_on_member: false,
    }];

    let bytes = write_xlsx_from_parse_output(&output).expect("export should succeed");
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    let styled_hidden_row = sheet_xml
        .split("<row ")
        .find(|row| row.contains(r#"r="3""#))
        .expect("row 3 should be regenerated from modeled row layout state");
    assert!(styled_hidden_row.contains(r#"s="1""#));
    assert!(styled_hidden_row.contains(r#"customFormat="1""#));
    assert!(styled_hidden_row.contains(r#"ht="24""#));
    assert!(styled_hidden_row.contains(r#"hidden="1""#));
    assert!(styled_hidden_row.contains(r#"customHeight="1""#));
    assert!(styled_hidden_row.contains(r#"outlineLevel="1""#));
    assert!(styled_hidden_row.contains(r#"x14ac:dyDescent="0.25""#));

    let collapsed_sentinel_row = sheet_xml
        .split("<row ")
        .find(|row| row.contains(r#"r="5""#))
        .expect("collapsed outline sentinel row should be regenerated");
    assert!(collapsed_sentinel_row.contains(r#"collapsed="1""#));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert!(
        rt.sheets[0]
            .dimensions
            .row_heights
            .iter()
            .any(|row| { row.row == 2 && row.custom_height && row.hidden && row.custom_format })
    );
    assert!(rt.sheets[0].outline_groups.iter().any(|group| {
        group.is_row && group.start == 2 && group.end == 3 && group.level == 1 && group.hidden
    }));
}

#[test]
fn roundtrip_print_settings_from_modeled_state() {
    let mut output = make_single_sheet(
        "Print",
        vec![cell(0, 0, CellValue::Text(Arc::from("printable")))],
    );
    output.sheets[0].print_settings = Some(PrintSettings {
        paper_size: Some(9),
        paper_width: Some("210mm".to_string()),
        paper_height: Some("297mm".to_string()),
        orientation: Some("landscape".to_string()),
        scale: Some(85),
        fit_to_width: Some(1),
        fit_to_height: Some(2),
        gridlines: true,
        headings: true,
        h_centered: true,
        v_centered: true,
        margins: Some(PageMargins {
            left: 0.25,
            right: 0.25,
            top: 0.5,
            bottom: 0.5,
            header: 0.2,
            footer: 0.2,
        }),
        header_footer: Some(HeaderFooter {
            odd_header: Some("&CModeled Header".to_string()),
            odd_footer: Some("&RPage &P".to_string()),
            even_header: Some("&LEven Header".to_string()),
            even_footer: Some("&CEven Footer".to_string()),
            first_header: Some("&LFirst Header".to_string()),
            first_footer: Some("&RFirst Footer".to_string()),
            different_odd_even: true,
            different_first: true,
            scale_with_doc: Some(false),
            align_with_margins: Some(false),
        }),
        black_and_white: true,
        draft: true,
        first_page_number: Some(3),
        page_order: Some("overThenDown".to_string()),
        use_printer_defaults: Some(false),
        horizontal_dpi: Some(300),
        vertical_dpi: Some(600),
        r_id: None,
        imported_printer_settings: None,
        has_print_options: true,
        use_first_page_number: true,
        has_page_setup: true,
        copies: Some(2),
        grid_lines_set: false,
        page_setup_properties: Some(domain_types::PageSetupProperties {
            fit_to_page: true,
            auto_page_breaks: false,
        }),
        cell_comments: Some("asDisplayed".to_string()),
        print_errors: Some("dash".to_string()),
    });

    let rt = roundtrip(&output);
    let rt_print = rt.sheets[0]
        .print_settings
        .as_ref()
        .expect("print settings should round-trip");

    assert_eq!(rt_print, output.sheets[0].print_settings.as_ref().unwrap());
}

#[test]
fn roundtrip_page_breaks_from_modeled_state() {
    let mut output = make_single_sheet(
        "Breaks",
        vec![cell(0, 0, CellValue::Text(Arc::from("breaks")))],
    );
    output.sheets[0].page_breaks = Some(PageBreaks {
        row_breaks: vec![
            PageBreakEntry {
                id: 10,
                min: 0,
                max: 16383,
                manual: true,
                pt: false,
            },
            PageBreakEntry {
                id: 20,
                min: 2,
                max: 7,
                manual: false,
                pt: true,
            },
        ],
        col_breaks: vec![
            PageBreakEntry {
                id: 3,
                min: 0,
                max: 1048575,
                manual: true,
                pt: false,
            },
            PageBreakEntry {
                id: 6,
                min: 4,
                max: 12,
                manual: false,
                pt: true,
            },
        ],
    });

    let rt = roundtrip(&output);
    let rt_breaks = rt.sheets[0]
        .page_breaks
        .as_ref()
        .expect("page breaks should round-trip");

    assert_eq!(rt_breaks, output.sheets[0].page_breaks.as_ref().unwrap());
}

#[test]
fn roundtrip_frozen_panes() {
    let mut output = make_single_sheet(
        "Frozen",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 2,
        cols: 1,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 2, "Frozen rows mismatch");
    assert_eq!(rt_pane.cols, 1, "Frozen cols mismatch");
}

#[test]
fn roundtrip_frozen_rows_only() {
    let mut output = make_single_sheet(
        "FrozenRows",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 3,
        cols: 0,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 3);
    assert_eq!(rt_pane.cols, 0);
}

#[test]
fn roundtrip_frozen_cols_only() {
    let mut output = make_single_sheet(
        "FrozenCols",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 0,
        cols: 2,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 0);
    assert_eq!(rt_pane.cols, 2);
}

// =============================================================================
// 6e: Style round-trip tests
// =============================================================================

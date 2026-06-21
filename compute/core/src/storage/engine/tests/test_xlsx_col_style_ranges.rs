use super::super::*;
use super::helpers::*;
use domain_types::{
    AuthoredStyleRun, CellData, CellFormat, ColStyleEntry, ColStyleRange, DocumentFormat,
    FillFormat, FontFormat, ParseOutput, RowStyleEntry, SheetData,
};
use formula_types::StructureChange;
use value_types::{CellValue, FiniteF64};

fn style_for<'a>(
    output: &'a ParseOutput,
    style_id: Option<u32>,
    context: &str,
) -> &'a DocumentFormat {
    let style_id = style_id.unwrap_or_else(|| panic!("{context} should have a style_id"));
    output
        .style_palette
        .get(style_id as usize)
        .unwrap_or_else(|| panic!("{context} style_id {style_id} should exist in palette"))
}

fn sparse_col_range_output() -> ParseOutput {
    ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat {
                number_format: Some("0.0".to_string()),
                font: Some(FontFormat {
                    color: Some("#123456".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 6,
            cells: vec![CellData {
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(1.0)),
                ..Default::default()
            }],
            col_style_ranges: vec![ColStyleRange {
                start_col: 1,
                end_col: 3,
                style_id: 1,
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn imported_col_style_ranges_shift_with_structural_column_edits() {
    let mut engine = engine_from_parse_output_normal(&sparse_col_range_output());
    let sid = *engine
        .mirror()
        .sheet_ids()
        .next()
        .expect("hydrated sheet id");

    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 0)
            .number_format
            .as_deref(),
        None,
        "column before the imported range should use the workbook default"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 1)
            .number_format
            .as_deref(),
        Some("0.0"),
        "imported sparse range should format virtual columns"
    );

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 2,
                count: 2,
                new_col_ids: vec![],
            },
        )
        .expect("insert columns through production structural path");

    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 1)
            .number_format
            .as_deref(),
        Some("0.0"),
        "range start before the insert point should be preserved"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 5)
            .number_format
            .as_deref(),
        Some("0.0"),
        "range end should expand across inserted columns"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 6)
            .number_format
            .as_deref(),
        None,
        "column after the shifted range should fall back to default"
    );

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 2,
                count: 2,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete columns through production structural path");

    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 1)
            .number_format
            .as_deref(),
        Some("0.0"),
        "range start should survive deleting the inserted span"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 3)
            .number_format
            .as_deref(),
        Some("0.0"),
        "range end should contract after deleted columns"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 4)
            .number_format
            .as_deref(),
        None,
        "post-delete column outside the range should use default formatting"
    );
}

#[test]
fn direct_cell_row_col_and_styled_blank_formats_export_through_xlsx() {
    let input = ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat {
                number_format: Some("0.000".to_string()),
                font: Some(FontFormat {
                    bold: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            },
            DocumentFormat {
                number_format: Some("#,##0.00".to_string()),
                ..Default::default()
            },
            DocumentFormat {
                number_format: Some("0.0%".to_string()),
                ..Default::default()
            },
            DocumentFormat {
                fill: Some(FillFormat {
                    pattern_type: Some("solid".to_string()),
                    pattern_foreground_color: Some("#00CC99".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        sheets: vec![SheetData {
            name: "DirectFormats".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![CellData {
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(7.0)),
                style_id: Some(1),
                ..Default::default()
            }],
            row_styles: vec![RowStyleEntry {
                row: 1,
                style_id: 2,
            }],
            col_styles: vec![ColStyleEntry {
                col: 3,
                style_id: 3,
            }],
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 2,
                start_col: 0,
                end_row: 2,
                end_col: 1,
                style_id: 4,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.build_parse_output_from_yrs();
    assert_eq!(exported.sheets[0].cells[0].style_id, Some(1));
    assert_eq!(
        exported.sheets[0].row_styles,
        vec![RowStyleEntry {
            row: 1,
            style_id: 2,
        }]
    );
    assert_eq!(
        exported.sheets[0].col_styles,
        vec![ColStyleEntry {
            col: 3,
            style_id: 3,
        }]
    );
    assert_eq!(
        exported.sheets[0].authored_style_runs,
        input.sheets[0].authored_style_runs
    );

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("direct formats should export to XLSX");
    let (parsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&bytes).expect("exported XLSX should parse");
    let parsed_sheet = &parsed.sheets[0];

    let direct_cell = parsed_sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 0))
        .expect("directly styled A1 should round-trip as a cell");
    let cell_format = style_for(&parsed, direct_cell.style_id, "direct cell A1");
    assert_eq!(cell_format.number_format.as_deref(), Some("0.000"));
    assert_eq!(
        cell_format.font.as_ref().and_then(|font| font.bold),
        Some(true)
    );

    let row_style = parsed_sheet
        .row_styles
        .iter()
        .find(|style| style.row == 1)
        .expect("authored row style should round-trip");
    let row_format = style_for(&parsed, Some(row_style.style_id), "row 2 style");
    assert_eq!(row_format.number_format.as_deref(), Some("#,##0.00"));

    let col_style = parsed_sheet
        .col_style_ranges
        .iter()
        .find(|style| style.start_col <= 3 && style.end_col >= 3)
        .expect("authored column style should round-trip as column-default metadata");
    let col_format = style_for(&parsed, Some(col_style.style_id), "column D style");
    assert_eq!(col_format.number_format.as_deref(), Some("0.0%"));

    let blank_run = parsed_sheet
        .authored_style_runs
        .iter()
        .find(|run| {
            run.start_row <= 2 && run.end_row >= 2 && run.start_col <= 0 && run.end_col >= 1
        })
        .expect("styled blank cell run should round-trip");
    let blank_format = style_for(&parsed, Some(blank_run.style_id), "styled blank run");
    let fill = blank_format
        .fill
        .as_ref()
        .expect("styled blank run fill should round-trip");
    assert_eq!(fill.pattern_type.as_deref(), Some("solid"));
    assert!(
        fill.pattern_foreground_color.is_some() || fill.background_color.is_some(),
        "styled blank fill color should survive XLSX export/import"
    );
    assert!(
        parsed_sheet
            .cells
            .iter()
            .all(|cell| !((cell.row, cell.col) == (2, 0) && matches!(cell.value, CellValue::Null))),
        "style-only blanks should remain authored style metadata, not value cells"
    );
}

#[test]
fn imported_col_style_ranges_can_be_overridden_and_cleared_by_column() {
    let mut engine = engine_from_parse_output_normal(&sparse_col_range_output());
    let sid = *engine
        .mirror()
        .sheet_ids()
        .next()
        .expect("hydrated sheet id");

    engine
        .set_col_format(
            &sid,
            2,
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("set explicit column override");

    let explicit = engine.get_resolved_format(&sid, 0, 2);
    assert_eq!(explicit.number_format.as_deref(), Some("0.0"));
    assert_eq!(explicit.bold, Some(true));
    assert_ne!(engine.get_resolved_format(&sid, 0, 1).bold, Some(true));
    assert_ne!(engine.get_resolved_format(&sid, 0, 3).bold, Some(true));

    engine
        .clear_col_format(&sid, 2)
        .expect("clear column format");

    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 1)
            .number_format
            .as_deref(),
        Some("0.0"),
        "left neighbor should keep imported column style"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 2)
            .number_format
            .as_deref(),
        None,
        "cleared column should no longer inherit imported column style"
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 3)
            .number_format
            .as_deref(),
        Some("0.0"),
        "right neighbor should keep imported column style"
    );

    let exported = engine.build_parse_output_from_yrs();
    assert!(exported.sheets[0].col_styles.is_empty());
    let mut ranges = exported.sheets[0].col_style_ranges.clone();
    ranges.sort_by_key(|range| range.start_col);
    assert_eq!(ranges.len(), 2);
    assert_eq!((ranges[0].start_col, ranges[0].end_col), (1, 1));
    assert_eq!((ranges[1].start_col, ranges[1].end_col), (3, 3));
    assert!(ranges.iter().all(|range| range.style_id == 1));
}

#[test]
fn set_col_format_range_preserves_sparse_column_range_storage() {
    let mut engine = engine_from_parse_output_normal(&sparse_col_range_output());
    let sid = *engine
        .mirror()
        .sheet_ids()
        .next()
        .expect("hydrated sheet id");

    engine
        .set_col_format_range(
            &sid,
            1,
            3,
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("set sparse column format range");

    let resolved = engine.get_resolved_format(&sid, 0, 2);
    assert_eq!(resolved.number_format.as_deref(), Some("0.0"));
    assert_eq!(resolved.bold, Some(true));

    let exported = engine.build_parse_output_from_yrs();
    assert!(
        exported.sheets[0].col_styles.is_empty(),
        "range formatting should not materialize dense col_styles"
    );
    assert_eq!(exported.sheets[0].col_style_ranges.len(), 1);
    assert_eq!(
        (
            exported.sheets[0].col_style_ranges[0].start_col,
            exported.sheets[0].col_style_ranges[0].end_col
        ),
        (1, 3)
    );
}

use super::super::*;
use super::helpers::*;
use domain_types::{CellData, ColStyleRange, DocumentFormat, FontFormat, ParseOutput, SheetData};
use formula_types::StructureChange;
use value_types::{CellValue, FiniteF64};

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

//! Group 7: Viewport registry CRUD.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use compute_document::cell_serde::write_rich_string_to_yrs;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_CELLS;
use compute_pivot::types::{
    FieldId, PivotGrandTotals, PivotHeader, PivotRenderedBounds, PivotRow, PivotTableResult,
};
use domain_types::domain::pivot::PivotTableStyle;
use domain_types::{CellFormat, FontSize, RichSharedString, RichTextRun};
use snapshot_types::PivotTableDef;
use value_types::CellValue;
use yrs::{Map, Out, Transact};

// -------------------------------------------------------------------
// Test 23: register_viewport and get_registered_viewports
// -------------------------------------------------------------------

#[test]
fn test_register_viewport_appears_in_registry() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);

    let (id, sheet_hex, sr, sc, er, ec) = &viewports[0];
    assert_eq!(id, "main");
    assert_eq!(*sheet_hex, sid.to_uuid_string());
    assert_eq!((*sr, *sc, *er, *ec), (0, 0, 50, 20));
}

// -------------------------------------------------------------------
// Test 24: update_viewport_bounds changes bounds
// -------------------------------------------------------------------

#[test]
fn test_update_viewport_bounds() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);

    // Update bounds
    engine.update_viewport_bounds("main", 10, 5, 60, 25);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);
    let (_, _, sr, sc, er, ec) = &viewports[0];
    assert_eq!((*sr, *sc, *er, *ec), (10, 5, 60, 25));
}

// -------------------------------------------------------------------
// Test 25: update_viewport_bounds no-op for unknown ID
// -------------------------------------------------------------------

#[test]
fn test_update_viewport_bounds_unknown_id() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Should not panic; just no-op
    engine.update_viewport_bounds("nonexistent", 0, 0, 50, 20);
    assert!(engine.get_registered_viewports().is_empty());
}

// -------------------------------------------------------------------
// Test 26: unregister_viewport removes entry
// -------------------------------------------------------------------

#[test]
fn test_unregister_viewport() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);
    assert_eq!(engine.get_registered_viewports().len(), 1);

    engine.unregister_viewport("main");
    assert!(engine.get_registered_viewports().is_empty());
}

// -------------------------------------------------------------------
// Test 27: reset_sheet_viewports clears only that sheet's viewports
// -------------------------------------------------------------------

#[test]
fn test_reset_sheet_viewports_selective() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440099".to_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid1 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let sid2 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap();

    engine.register_viewport("main", &sid1, 0, 0, 50, 20);
    engine.register_viewport("split-bottom", &sid1, 50, 0, 100, 20);
    engine.register_viewport("sheet2-main", &sid2, 0, 0, 30, 10);

    assert_eq!(engine.get_registered_viewports().len(), 3);

    // Reset only sheet1 viewports
    engine.reset_sheet_viewports(&sid1);

    let remaining = engine.get_registered_viewports();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].0, "sheet2-main");
}

// -------------------------------------------------------------------
// Test 28: get_viewport_binary uses registered viewport state
// -------------------------------------------------------------------

#[test]
fn test_get_viewport_binary_updates_registry() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Calling get_viewport_binary should create a synthetic registration
    let buf = engine.get_viewport_binary(&sid, 0, 0, 50, 20, false);
    assert!(!buf.is_empty());

    // The registry should now have a synthetic entry for this sheet
    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);
    let (id, _, sr, sc, er, ec) = &viewports[0];
    assert!(id.starts_with("__sheet_"));
    assert_eq!((*sr, *sc, *er, *ec), (0, 0, 50, 20));
}

// -------------------------------------------------------------------
// Test 29: Multiple viewports for same sheet
// -------------------------------------------------------------------

#[test]
fn test_multiple_viewports_same_sheet() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("top-pane", &sid, 0, 0, 10, 20);
    engine.register_viewport("bottom-pane", &sid, 10, 0, 50, 20);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 2);

    // Both should have the same sheet_id
    let sheet_ids: Vec<&String> = viewports.iter().map(|(_, s, _, _, _, _)| s).collect();
    assert!(sheet_ids.iter().all(|s| **s == sid.to_uuid_string()));
}

// -------------------------------------------------------------------
// Test 30: Register viewport replaces existing
// -------------------------------------------------------------------

#[test]
fn test_register_viewport_replaces_existing() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);
    engine.register_viewport("main", &sid, 10, 5, 60, 25);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);
    let (_, _, sr, sc, er, ec) = &viewports[0];
    assert_eq!((*sr, *sc, *er, *ec), (10, 5, 60, 25));
}

#[test]
fn test_viewport_binary_renders_materialized_values_without_cell_ids() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let anchor_row = 0;
    let anchor_col = 4;
    let result = PivotTableResult {
        column_headers: vec![],
        rows: vec![PivotRow {
            key: "row_north".to_string(),
            headers: vec![PivotHeader {
                key: "T:north".to_string(),
                value: CellValue::from("North"),
                field_id: FieldId::from("field_0"),
                depth: 0,
                span: 1,
                is_expandable: false,
                is_expanded: true,
                is_subtotal: false,
                is_grand_total: false,
                parent_key: None,
                child_keys: None,
            }],
            values: vec![CellValue::number(250.0)],
            depth: 0,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: None,
        }],
        grand_totals: PivotGrandTotals {
            row: Some(vec![CellValue::number(250.0)]),
            column: None,
            grand: Some(vec![CellValue::number(250.0)]),
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 3,
            total_cols: 2,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 1,
        },
        source_row_count: 1,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    engine.mirror.materialize_pivot(
        &sid,
        anchor_row,
        anchor_col,
        &result,
        &["Region".to_string()],
    );

    let viewport = engine.build_viewport_render_data(&sid, 0, 0, 4, 8);

    let cell =
        |row: usize, col: usize| &viewport.cells[row * viewport.viewport_cols as usize + col];
    assert_eq!(cell(0, 4).formatted.as_deref(), Some("Region"));
    assert_eq!(cell(1, 4).formatted.as_deref(), Some("North"));
    assert_eq!(cell(1, 5).formatted.as_deref(), Some("250"));
    assert_eq!(cell(2, 4).formatted.as_deref(), Some("Grand Total"));
    assert_eq!(cell(2, 5).formatted.as_deref(), Some("250"));
}

fn write_rich_string_for_test_cell(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
    rich_string: &RichSharedString,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let sheets = engine.storage().sheets_ref();
    let mut txn = engine.storage().doc().transact_mut();
    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(map)) => map,
        other => panic!("expected sheet map, got {other:?}"),
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(map)) => map,
        other => panic!("expected cells map, got {other:?}"),
    };
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(map)) => map,
        other => panic!("expected cell map, got {other:?}"),
    };

    write_rich_string_to_yrs(&cell_map, &mut txn, rich_string);
}

#[test]
fn rich_text_viewport_format_uses_run_aggregate_font() {
    let sid = sheet_id();
    let cell_id_c1 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440004").unwrap();
    let cell_id_b2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440005").unwrap();
    let cell_id_c2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440006").unwrap();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: cell_id_a1().to_uuid_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::from("Rent Roll"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_id_b1().to_uuid_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::from("High Investment Flag (IF FCF < 0)"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_id_c1.to_uuid_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::from("Please answer each question using Excellent ratings"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_id_a2().to_uuid_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::from("Operating Expenses "),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_id_b2.to_uuid_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::from(
                        "Selected Software Transactions (Target/Acquiror)\nFinancial Sponsor Acquirors",
                    ),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_id_c2.to_uuid_string(),
                    row: 1,
                    col: 2,
                    value: CellValue::from(
                        "Total Actual and Extrapolated Unclaimed Property Due to DE",
                    ),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                font_family: Some("Arial".to_string()),
                font_size: Some(FontSize::from_points(13.0)),
                font_color: Some("#303030".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(1, 0, 1, 0)],
            &CellFormat {
                font_family: Some("Calibri".to_string()),
                font_size: Some(FontSize::from_points(14.0)),
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 1, 0, 1)],
            &CellFormat {
                font_family: Some("Calibri".to_string()),
                font_size: Some(FontSize::from_points(12.0)),
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

    write_rich_string_for_test_cell(
        &engine,
        &sid,
        &cell_id_a1(),
        &RichSharedString {
            plain_text: "Rent Roll".to_string(),
            runs: vec![RichTextRun {
                text: "Rent Roll".to_string(),
                font_name: Some("Arial".to_string()),
                font_size: Some(11.0),
                ..Default::default()
            }],
            ..Default::default()
        },
    );
    write_rich_string_for_test_cell(
        &engine,
        &sid,
        &cell_id_c1,
        &RichSharedString {
            plain_text: "Please answer each question using Excellent ratings".to_string(),
            runs: vec![
                RichTextRun {
                    text: "Please answer each question using ".to_string(),
                    ..Default::default()
                },
                RichTextRun {
                    text: "Excellent".to_string(),
                    font_name: Some("Arial".to_string()),
                    font_size: Some(8.0),
                    bold: true,
                    italic: true,
                    ..Default::default()
                },
                RichTextRun {
                    text: " ratings".to_string(),
                    font_name: Some("Arial".to_string()),
                    font_size: Some(8.0),
                    italic: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    );
    write_rich_string_for_test_cell(
        &engine,
        &sid,
        &cell_id_b1(),
        &RichSharedString {
            plain_text: "High Investment Flag (IF FCF < 0)".to_string(),
            runs: vec![
                RichTextRun {
                    text: "High Investment Flag".to_string(),
                    font_name: Some("Calibri".to_string()),
                    font_size: Some(12.0),
                    bold: true,
                    ..Default::default()
                },
                RichTextRun {
                    text: " (IF FCF < 0)".to_string(),
                    font_name: Some("Calibri".to_string()),
                    font_size: Some(12.0),
                    bold: false,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    );
    write_rich_string_for_test_cell(
        &engine,
        &sid,
        &cell_id_a2(),
        &RichSharedString {
            plain_text: "Operating Expenses ".to_string(),
            runs: vec![
                RichTextRun {
                    text: "Operating Expenses".to_string(),
                    ..Default::default()
                },
                RichTextRun {
                    text: " ".to_string(),
                    font_name: Some("Calibri".to_string()),
                    font_size: Some(12.0),
                    bold: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    );
    write_rich_string_for_test_cell(
        &engine,
        &sid,
        &cell_id_b2,
        &RichSharedString {
            plain_text:
                "Selected Software Transactions (Target/Acquiror)\nFinancial Sponsor Acquirors"
                    .to_string(),
            runs: vec![
                RichTextRun {
                    text: "Selected Software Transactions (Target/Acquiror)\n".to_string(),
                    ..Default::default()
                },
                RichTextRun {
                    text: "Financial Sponsor Acquirors".to_string(),
                    font_name: Some("Arial".to_string()),
                    font_size: Some(10.0),
                    bold: true,
                    italic: true,
                    underline_style: Some(ooxml_types::styles::UnderlineStyle::SingleAccounting),
                    underline: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    );
    write_rich_string_for_test_cell(
        &engine,
        &sid,
        &cell_id_c2,
        &RichSharedString {
            plain_text: "Total Actual and Extrapolated Unclaimed Property Due to DE".to_string(),
            runs: vec![
                RichTextRun {
                    text: "Total Actual and Extrapolated Unclaimed Property Due to ".to_string(),
                    ..Default::default()
                },
                RichTextRun {
                    text: "DE".to_string(),
                    color: Some("FFFF0000".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    );

    let viewport = engine.build_viewport_render_data(&sid, 0, 0, 2, 3);
    let cell =
        |row: usize, col: usize| &viewport.cells[row * viewport.viewport_cols as usize + col];
    let format = |row: usize, col: usize| {
        let format_idx = cell(row, col).format_idx as usize;
        &viewport.format_palette[format_idx]
    };

    assert_eq!(format(0, 0).font_size, Some(FontSize::from_points(11.0)));
    assert_eq!(format(0, 0).font_color, None);
    assert_eq!(format(0, 1).bold, None);
    assert_eq!(format(0, 2).font_family.as_deref(), Some("Arial"));
    assert_eq!(format(0, 2).font_size, Some(FontSize::from_points(8.0)));
    assert_eq!(format(0, 2).italic, Some(true));
    assert_eq!(format(0, 2).bold, None);
    assert_eq!(format(1, 0).font_size, None);
    assert_eq!(format(1, 0).bold, Some(true));
    assert_eq!(format(1, 1).font_family.as_deref(), Some("Arial"));
    assert_eq!(format(1, 1).font_size, Some(FontSize::from_points(10.0)));
    assert_eq!(format(1, 1).bold, Some(true));
    assert_ne!(format(1, 1).italic, Some(true));
    assert_eq!(
        format(1, 1).underline_type,
        Some(ooxml_types::styles::UnderlineStyle::SingleAccounting)
    );
    assert_eq!(format(1, 2).font_color, None);
}

#[test]
fn pivot_total_viewport_format_overrides_cell_xf() {
    let sid = sheet_id();
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440040").unwrap();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Pivot".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: cell_id.to_uuid_string(),
                row: 35,
                col: 3,
                value: CellValue::number(10.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![PivotTableDef {
            id: "pivot-1".to_string(),
            name: "PivotTable1".to_string(),
            sheet: sid.to_uuid_string(),
            start_row: 16,
            start_col: 2,
            end_row: 35,
            end_col: 6,
            rendered_rows: Some(20),
            rendered_cols: Some(5),
            first_data_row: 2,
            first_data_col: 1,
            data_field_names: vec![],
            cache_field_names: vec![],
            row_field_indices: vec![],
            col_field_indices: vec![],
            data_on_rows: false,
            style: Some(PivotTableStyle {
                style_name: Some("PivotStyleLight16".to_string()),
                show_row_headers: Some(true),
                show_column_headers: Some(true),
                show_row_stripes: Some(false),
                show_column_stripes: Some(false),
                show_last_column: Some(true),
            }),
            show_row_grand_totals: Some(true),
            show_column_grand_totals: Some(true),
        }],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_cell_format(
            &sid,
            &cell_id,
            &CellFormat {
                number_format: Some(
                    "_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)".to_string(),
                ),
                pattern_type: Some(ooxml_types::styles::PatternType::None),
                ..Default::default()
            },
        )
        .unwrap();

    let viewport = engine.build_viewport_render_data(&sid, 35, 3, 36, 4);
    let cell = &viewport.cells[0];
    let format = &viewport.format_palette[cell.format_idx as usize];

    assert_eq!(cell.formatted.as_deref(), Some("10"));
    assert_eq!(format.number_format.as_deref(), Some("General"));
    assert_eq!(
        format.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
    assert_eq!(format.background_color.as_deref(), Some("#d9e1f2"));
    assert_eq!(format.bold, Some(true));
}

#[test]
fn projection_member_viewport_format_prefers_allocated_member_cell_style() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: cell_id_a1().to_uuid_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Null,
                    formula: Some("=SEQUENCE(3,1)".to_string()),
                    identity_formula: None,
                    array_ref: Some("A1:A3".to_string()),
                },
                CellData {
                    cell_id: cell_id_a2().to_uuid_string(),
                    row: 1,
                    col: 0,
                    value: num(0.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(1, 0, 1, 0)],
            &CellFormat {
                number_format: Some("0%".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    let viewport = engine.build_viewport_render_data(&sid, 0, 0, 3, 1);
    let cell =
        |row: usize, col: usize| &viewport.cells[row * viewport.viewport_cols as usize + col];
    let number_format = |row: usize, col: usize| {
        let format_idx = cell(row, col).format_idx as usize;
        viewport.format_palette[format_idx].number_format.as_deref()
    };

    assert_eq!(cell(0, 0).formatted.as_deref(), Some("$1.00"));
    assert_eq!(number_format(0, 0), Some("$#,##0.00"));

    assert_eq!(cell(1, 0).formatted.as_deref(), Some("200%"));
    assert_eq!(number_format(1, 0), Some("0%"));

    assert_eq!(cell(2, 0).formatted.as_deref(), Some("$3.00"));
    assert_eq!(number_format(2, 0), Some("$#,##0.00"));
}

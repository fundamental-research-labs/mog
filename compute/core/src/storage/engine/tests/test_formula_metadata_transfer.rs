use std::sync::Arc;

use super::super::YrsComputeEngine;
use super::helpers::{cell_id_a1, sheet_id, simple_snapshot};
use crate::snapshot::{CellData as SnapshotCellData, SheetSnapshot, WorkbookSnapshot};
use crate::storage::infra::grid_helpers::get_cells_map;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_ARRAY_REF, KEY_FORMULA_METADATA};
use domain_types::{CellData, ParseOutput, SheetData};
use formula_types::CellRef;
use ooxml_types::worksheet::{CellFormula, CellFormulaType};
use snapshot_types::DataTableRegionDef;
use value_types::{CellValue, FiniteF64};
use yrs::{Any, Map, Out, Transact};

fn assert_cell_id_at(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
    expected: Option<&str>,
) {
    let actual = engine
        .get_cell_id_at(sheet_id, row, col)
        .and_then(|raw| cell_types::CellId::from_uuid_str(&raw).ok());
    let expected = expected.map(|raw| cell_types::CellId::from_uuid_str(raw).unwrap());
    assert_eq!(actual, expected);
}

fn metadata_present(engine: &YrsComputeEngine, sheet_id: &cell_types::SheetId) -> bool {
    let txn = engine.stores.storage.doc().transact();
    let cells = get_cells_map(
        &txn,
        &engine.stores.storage.sheets_ref(),
        &id_to_hex(sheet_id.as_u128()),
    )
    .expect("sheet cells map");
    let cell = match cells.get(&txn, &id_to_hex(cell_id_a1().as_u128())) {
        Some(Out::YMap(cell)) => cell,
        _ => return false,
    };
    cell.get(&txn, KEY_FORMULA_METADATA).is_some() && cell.get(&txn, KEY_ARRAY_REF).is_some()
}

fn write_metadata(engine: &mut YrsComputeEngine, sheet_id: &cell_types::SheetId) {
    let mut txn = engine.stores.storage.doc().transact_mut();
    let cells = get_cells_map(
        &txn,
        &engine.stores.storage.sheets_ref(),
        &id_to_hex(sheet_id.as_u128()),
    )
    .expect("sheet cells map");
    let cell = match cells.get(&txn, &id_to_hex(cell_id_a1().as_u128())) {
        Some(Out::YMap(cell)) => cell,
        _ => panic!("A1 cell map"),
    };
    cell.insert(
        &mut txn,
        KEY_FORMULA_METADATA,
        Any::String(Arc::from(r#"{"t":"normal","text":"","ca":true}"#)),
    );
    cell.insert(&mut txn, KEY_ARRAY_REF, Any::String(Arc::from("A1:A1")));
}

#[test]
fn direct_edit_clears_imported_metadata_and_undo_restores_it() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    write_metadata(&mut engine, &sid);
    // The metadata setup is fixture state, not an undoable user operation.
    engine.mutation.undo_manager.clear();
    assert!(metadata_present(&engine, &sid));

    engine
        .set_cell_value_parsed(&sid, 0, 0, "17")
        .expect("edit A1");
    assert!(!metadata_present(&engine, &sid));

    engine.undo().expect("undo edit");
    assert!(metadata_present(&engine, &sid));
}

#[test]
fn relocation_moves_metadata_and_undo_restores_the_source_entry() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let cell_id = cell_id_a1().to_uuid_string();
    write_metadata(&mut engine, &sid);
    engine.mutation.undo_manager.clear();

    engine
        .relocate_cells_yrs(&sid, 0, 0, 0, 0, &sid, 0, 2)
        .expect("relocate A1 to C1");
    assert_eq!(
        engine.get_cell_id_at(&sid, 0, 2).as_deref(),
        Some(cell_id.as_str())
    );

    let txn = engine.stores.storage.doc().transact();
    let cells = get_cells_map(
        &txn,
        &engine.stores.storage.sheets_ref(),
        &id_to_hex(sid.as_u128()),
    )
    .expect("sheet cells map");
    let cell = match cells.get(&txn, &id_to_hex(cell_id_a1().as_u128())) {
        Some(Out::YMap(cell)) => cell,
        _ => panic!("moved A1 cell map"),
    };
    assert!(cell.get(&txn, KEY_FORMULA_METADATA).is_some());
    assert!(cell.get(&txn, KEY_ARRAY_REF).is_some());
    drop(txn);

    engine.undo().expect("undo relocation");
    assert_eq!(
        engine.get_cell_id_at(&sid, 0, 0).as_deref(),
        Some(cell_id.as_str())
    );
    assert!(metadata_present(&engine, &sid));
}

fn assert_compaction_does_not_replay_stale_range_metadata(cell_formula: CellFormula) {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 1,
            cells: vec![
                CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text("A".into()),
                    ..Default::default()
                },
                CellData {
                    row: 1,
                    col: 0,
                    value: CellValue::Text("A".into()),
                    ..Default::default()
                },
                CellData {
                    row: 2,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(7.0)),
                    formula: Some("SUM(A1)".to_string()),
                    array_ref: (cell_formula.t == CellFormulaType::Array)
                        .then(|| "A3:A3".to_string()),
                    cell_formula: Some(cell_formula),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut engine = super::helpers::engine_from_parse_output_normal(&output);
    let sheet_id = engine.stores.storage.sheet_order()[0];
    engine
        .remove_duplicates(&sheet_id, 0, 0, 2, 0, vec![], false)
        .expect("remove duplicates should compact the formula cell");

    let xlsx = engine
        .export_to_xlsx_bytes()
        .expect("compacted workbook should export");
    let sheet_xml = super::helpers::archive_text(&xlsx, "xl/worksheets/sheet1.xml")
        .expect("worksheet XML should exist");
    assert!(
        sheet_xml.contains("<f>SUM(A1)</f>"),
        "formula should survive: {sheet_xml}"
    );
    assert!(
        !sheet_xml.contains("t=\"shared\""),
        "stale shared marker replayed: {sheet_xml}"
    );
    assert!(
        !sheet_xml.contains("t=\"array\""),
        "stale array marker replayed: {sheet_xml}"
    );
    assert!(
        !sheet_xml.contains("t=\"dataTable\""),
        "stale data-table marker replayed: {sheet_xml}"
    );
    assert!(
        !sheet_xml.contains("ref=\"A3:A3\""),
        "stale range replayed: {sheet_xml}"
    );
}

#[test]
fn remove_duplicates_does_not_replay_stale_shared_formula_geometry() {
    assert_compaction_does_not_replay_stale_range_metadata(CellFormula {
        t: CellFormulaType::Shared,
        si: Some(8),
        r#ref: Some("A3:A3".to_string()),
        text: "SUM(A1)".to_string(),
        ..Default::default()
    });
}

#[test]
fn remove_duplicates_does_not_replay_stale_array_formula_geometry() {
    assert_compaction_does_not_replay_stale_range_metadata(CellFormula {
        t: CellFormulaType::Array,
        r#ref: Some("A3:A3".to_string()),
        text: "SUM(A1)".to_string(),
        aca: true,
        ..Default::default()
    });
}

#[test]
fn remove_duplicates_does_not_replay_stale_data_table_geometry() {
    assert_compaction_does_not_replay_stale_range_metadata(CellFormula {
        t: CellFormulaType::DataTable,
        r#ref: Some("A3:A3".to_string()),
        text: "SUM(A1)".to_string(),
        dt2d: true,
        ..Default::default()
    });
}

#[test]
fn cross_sheet_data_table_region_exports_and_undoes_with_the_cell_move() {
    const SOURCE_SHEET: &str = "00000000-0000-0000-0000-000000010001";
    const TARGET_SHEET: &str = "00000000-0000-0000-0000-000000010002";
    const BODY_IDS: [&str; 4] = [
        "00000000-0000-0000-0000-000000011001",
        "00000000-0000-0000-0000-000000011002",
        "00000000-0000-0000-0000-000000011003",
        "00000000-0000-0000-0000-000000011004",
    ];

    let source = cell_types::SheetId::from_uuid_str(SOURCE_SHEET).unwrap();
    let target = cell_types::SheetId::from_uuid_str(TARGET_SHEET).unwrap();
    let body_cells = BODY_IDS
        .into_iter()
        .zip([(2, 2), (2, 3), (3, 2), (3, 3)])
        .map(|(cell_id, (row, col))| SnapshotCellData {
            cell_id: cell_id.to_string(),
            row,
            col,
            value: CellValue::Number(FiniteF64::must(1.0)),
            formula: Some("=TABLE(A1,B1)".to_string()),
            identity_formula: None,
            array_ref: None,
        })
        .collect();
    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SOURCE_SHEET.to_string(),
                name: "Source".to_string(),
                rows: 16,
                cols: 16,
                cells: body_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: TARGET_SHEET.to_string(),
                name: "Target".to_string(),
                rows: 16,
                cols: 16,
                cells: vec![],
                ranges: vec![],
            },
        ],
        data_table_regions: vec![DataTableRegionDef {
            sheet: SOURCE_SHEET.to_string(),
            start_row: 2,
            start_col: 2,
            end_row: 3,
            end_col: 3,
            row_input_ref: Some(CellRef::Positional {
                sheet: source,
                row: 2,
                col: 2,
            }),
            col_input_ref: Some(CellRef::Positional {
                sheet: source,
                row: 3,
                col: 3,
            }),
            ooxml_flags: None,
        }],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    engine.mutation.undo_manager.clear();

    engine
        .relocate_cells_yrs(&source, 2, 2, 3, 3, &target, 8, 9)
        .expect("cross-sheet data-table relocation");
    let moved_region = &engine.mirror().all_data_table_regions()[0];
    assert_eq!(moved_region.sheet, TARGET_SHEET);
    assert_eq!((moved_region.start_row, moved_region.start_col), (8, 9));
    assert_eq!((moved_region.end_row, moved_region.end_col), (9, 10));
    assert_eq!(
        moved_region.row_input_ref,
        Some(CellRef::Positional {
            sheet: target,
            row: 8,
            col: 9,
        })
    );

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("export moved data table");
    let target_xml = super::helpers::archive_text(&exported, "xl/worksheets/sheet2.xml")
        .expect("target worksheet XML");
    assert!(
        target_xml.contains("t=\"dataTable\""),
        "moved data-table marker missing: {target_xml}"
    );

    engine
        .undo()
        .expect("undo cross-sheet data-table relocation");
    let restored_region = &engine.mirror().all_data_table_regions()[0];
    assert_eq!(restored_region.sheet, SOURCE_SHEET);
    assert_eq!(
        (restored_region.start_row, restored_region.start_col),
        (2, 2)
    );
    assert_cell_id_at(&engine, &source, 2, 2, Some(BODY_IDS[0]));

    engine
        .redo()
        .expect("redo cross-sheet data-table relocation");
    let redone_region = &engine.mirror().all_data_table_regions()[0];
    assert_eq!(redone_region.sheet, TARGET_SHEET);
    assert_eq!((redone_region.start_row, redone_region.start_col), (8, 9));
}

#[test]
fn cross_sheet_normal_cell_move_persists_identity_for_undo_and_redo() {
    const SOURCE_SHEET: &str = "00000000-0000-0000-0000-000000020001";
    const TARGET_SHEET: &str = "00000000-0000-0000-0000-000000020002";
    const CELL_ID: &str = "00000000-0000-0000-0000-000000022001";

    let source = cell_types::SheetId::from_uuid_str(SOURCE_SHEET).unwrap();
    let target = cell_types::SheetId::from_uuid_str(TARGET_SHEET).unwrap();
    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SOURCE_SHEET.to_string(),
                name: "Source".to_string(),
                rows: 16,
                cols: 16,
                cells: vec![SnapshotCellData {
                    cell_id: CELL_ID.to_string(),
                    row: 2,
                    col: 2,
                    value: CellValue::Text(Arc::from("move me")),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            },
            SheetSnapshot {
                id: TARGET_SHEET.to_string(),
                name: "Target".to_string(),
                rows: 16,
                cols: 16,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    engine.mutation.undo_manager.clear();

    engine
        .relocate_cells_yrs(&source, 2, 2, 2, 2, &target, 8, 9)
        .expect("cross-sheet normal-cell relocation");
    assert_cell_id_at(&engine, &source, 2, 2, None);
    assert_cell_id_at(&engine, &target, 8, 9, Some(CELL_ID));

    engine
        .undo()
        .expect("undo cross-sheet normal-cell relocation");
    assert_cell_id_at(&engine, &source, 2, 2, Some(CELL_ID));
    assert_cell_id_at(&engine, &target, 8, 9, None);

    engine
        .redo()
        .expect("redo cross-sheet normal-cell relocation");
    assert_cell_id_at(&engine, &source, 2, 2, None);
    assert_cell_id_at(&engine, &target, 8, 9, Some(CELL_ID));
}

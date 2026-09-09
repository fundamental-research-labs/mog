use std::sync::Arc;

use super::super::ComputeEngine;
use super::helpers::{cell_id_a1, sheet_id, simple_snapshot};
use crate::snapshot::{CellData as SnapshotCellData, SheetSnapshot, WorkbookSnapshot};
use domain_types::{CellData, ParseOutput, SheetData};
use formula_types::CellRef;
use ooxml_types::worksheet::{CellFormula, CellFormulaType};
use snapshot_types::DataTableRegionDef;
use value_types::{CellValue, FiniteF64};

fn assert_cell_id_at(
    engine: &ComputeEngine,
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

fn metadata_present(engine: &ComputeEngine, sheet_id: &cell_types::SheetId) -> bool {
    engine
        .stores
        .storage
        .cell_metadata
        .get(&cell_id_a1())
        .is_some_and(|metadata| {
            engine.mirror.sheet_for_cell(&cell_id_a1()) == Some(*sheet_id)
                && metadata.formula.is_some()
                && metadata.array_ref.is_some()
        })
}

fn write_metadata(engine: &mut ComputeEngine, _sheet_id: &cell_types::SheetId) {
    engine.stores.storage.cell_metadata.insert(
        cell_id_a1(),
        crate::storage::CellMetadata {
            formula: Some(crate::storage::FormulaMetadata::from(&CellFormula {
                ca: true,
                ..Default::default()
            })),
            array_ref: Some("A1:A1".into()),
            ..Default::default()
        },
    );
}

#[test]
fn direct_edit_clears_imported_metadata_and_undo_restores_it() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    write_metadata(&mut engine, &sid);
    // The metadata setup is fixture state, not an undoable user operation.
    engine.clear_history();
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
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let cell_id = cell_id_a1().to_uuid_string();
    write_metadata(&mut engine, &sid);
    engine.clear_history();

    engine
        .relocate_cells(&sid, 0, 0, 0, 0, &sid, 0, 2)
        .expect("relocate A1 to C1");
    assert_cell_id_at(&engine, &sid, 0, 2, Some(cell_id.as_str()));

    assert!(metadata_present(&engine, &sid));

    engine.undo().expect("undo relocation");
    assert_cell_id_at(&engine, &sid, 0, 0, Some(cell_id.as_str()));
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
                identities: vec![],
                row_axis: None,
                col_axis: None,
                id: SOURCE_SHEET.to_string(),
                name: "Source".to_string(),
                rows: 16,
                cols: 16,
                cells: body_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                identities: vec![],
                row_axis: None,
                col_axis: None,
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

    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    engine.clear_history();

    engine
        .relocate_cells(&source, 2, 2, 3, 3, &target, 8, 9)
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
                identities: vec![],
                row_axis: None,
                col_axis: None,
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
                identities: vec![],
                row_axis: None,
                col_axis: None,
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

    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    engine.clear_history();

    engine
        .relocate_cells(&source, 2, 2, 2, 2, &target, 8, 9)
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

#[test]
fn partial_data_table_move_undo_restores_orphan_formulas_and_cached_values() {
    let sid = sheet_id();
    let mut snapshot = simple_snapshot();
    let mut cells = Vec::new();
    for (row, col, value, formula) in [
        (0, 0, 0.0, None),
        (1, 0, 0.0, None),
        (1, 1, 0.0, Some("=A1+A2")),
        (1, 2, 10.0, None),
        (1, 3, 20.0, None),
        (2, 1, 1.0, None),
        (3, 1, 2.0, None),
        (2, 2, 11.0, Some("=TABLE(A1,A2)")),
        (2, 3, 21.0, Some("=TABLE(A1,A2)")),
        (3, 2, 12.0, Some("=TABLE(A1,A2)")),
        (3, 3, 22.0, Some("=TABLE(A1,A2)")),
    ] {
        cells.push(SnapshotCellData {
            cell_id: cell_types::CellId::from_raw(0x33000 + cells.len() as u128).to_uuid_string(),
            row,
            col,
            value: CellValue::number(value),
            formula: formula.map(str::to_string),
            identity_formula: None,
            array_ref: None,
        });
    }
    let body_ids: Vec<_> = cells[7..]
        .iter()
        .map(|cell| cell_types::CellId::from_uuid_str(&cell.cell_id).unwrap())
        .collect();
    snapshot.sheets[0].rows = 16;
    snapshot.sheets[0].cols = 16;
    snapshot.sheets[0].cells = cells;
    let region = DataTableRegionDef {
        sheet: sid.to_uuid_string(),
        start_row: 2,
        start_col: 2,
        end_row: 3,
        end_col: 3,
        row_input_ref: Some(CellRef::Positional {
            sheet: sid,
            row: 0,
            col: 0,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: sid,
            row: 1,
            col: 0,
        }),
        ooxml_flags: None,
    };
    snapshot.data_table_regions = vec![region.clone()];
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let original_values: Vec<_> = body_ids
        .iter()
        .map(|id| {
            assert!(
                engine
                    .compute()
                    .get_formula(id)
                    .unwrap()
                    .starts_with("=TABLE(")
            );
            let value = engine.mirror().get_cell_value_raw(id).unwrap().clone();
            assert!(
                matches!(value, CellValue::Number(_)),
                "table must have numeric results: {value:?}"
            );
            value
        })
        .collect();
    engine.clear_history();

    engine.relocate_cells(&sid, 2, 2, 2, 2, &sid, 8, 9).unwrap();
    assert!(engine.mirror().all_data_table_regions().is_empty());
    for (id, value) in body_ids.iter().zip(&original_values) {
        assert_eq!(engine.compute().get_formula(id), None);
        assert_eq!(engine.mirror().get_cell_value_raw(id), Some(value));
    }
    for (index, (row, col)) in [(8, 9), (2, 3), (3, 2), (3, 3)].into_iter().enumerate() {
        assert_cell_id_at(
            &engine,
            &sid,
            row,
            col,
            Some(&body_ids[index].to_uuid_string()),
        );
    }

    engine.undo().unwrap();
    assert_eq!(engine.mirror().all_data_table_regions(), &[region]);
    for (index, (row, col)) in [(2, 2), (2, 3), (3, 2), (3, 3)].into_iter().enumerate() {
        let id = body_ids[index];
        assert_cell_id_at(&engine, &sid, row, col, Some(&id.to_uuid_string()));
        assert!(
            engine
                .compute()
                .get_formula(&id)
                .unwrap()
                .starts_with("=TABLE("),
            "undo must restore formulas outside the moved rectangle"
        );
        assert_eq!(
            engine.mirror().get_cell_value_raw(&id),
            Some(&original_values[index])
        );
    }

    engine.redo().unwrap();
    assert!(engine.mirror().all_data_table_regions().is_empty());
    assert_cell_id_at(&engine, &sid, 8, 9, Some(&body_ids[0].to_uuid_string()));
    for (id, value) in body_ids.iter().zip(&original_values) {
        assert_eq!(engine.compute().get_formula(id), None);
        assert_eq!(engine.mirror().get_cell_value_raw(id), Some(value));
    }
}

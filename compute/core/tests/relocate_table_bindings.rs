//! Regression tests for table metadata attached to `relocate_cells_yrs`.
//!
//! The production cut-paste primitive must move table bindings with any
//! relocated range that fully contains the table. The table keeps its id and is
//! persisted under the id-keyed workbook catalog entry; it must not be
//! synthesized by a later TypeScript resize/create fallback.

use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::table::Table;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};
use yrs::{Map, Out, Transact};

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot_single_sheet() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![
                number_cell(100, 0, 0, 10.0),
                number_cell(101, 0, 1, 20.0),
                number_cell(102, 1, 0, 30.0),
                number_cell(103, 1, 1, 40.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn snapshot_two_sheets() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet_id_str(1),
                name: "S1".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![
                    number_cell(100, 0, 0, 10.0),
                    number_cell(101, 0, 1, 20.0),
                    number_cell(102, 1, 0, 30.0),
                    number_cell(103, 1, 1, 40.0),
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet_id_str(2),
                name: "S2".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn table_catalog_table_by_key(engine: &YrsComputeEngine, key: &str) -> Option<Table> {
    let txn = engine.storage().doc().transact();
    match engine
        .storage()
        .workbook_map()
        .get(&txn, compute_document::schema::KEY_TABLES)
    {
        Some(Out::YMap(tables_map)) => match tables_map.get(&txn, key) {
            Some(Out::YMap(table_map)) => {
                domain_types::yrs_schema::table::from_yrs_map_to_table(&table_map, &txn)
            }
            _ => None,
        },
        _ => None,
    }
}

#[test]
fn relocate_whole_table_moves_table_binding() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_single_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

    engine
        .create_table_lifecycle(
            &sid,
            Some("Table1".to_string()),
            0,
            0,
            2,
            1,
            vec!["Region".to_string(), "Revenue".to_string()],
            true,
            None,
        )
        .expect("create table");
    let table_id = engine
        .get_table_by_name("Table1")
        .expect("table after create")
        .id;

    let (_patches, result) = engine
        .relocate_cells_yrs(&sid, 0, 0, 2, 1, &sid, 0, 3)
        .expect("relocate_cells_yrs");

    let table = engine
        .get_table_by_name("Table1")
        .expect("table should still exist after cut-paste");
    assert_eq!(table.range.start_row(), 0);
    assert_eq!(table.range.start_col(), 3);
    assert_eq!(table.range.end_row(), 2);
    assert_eq!(table.range.end_col(), 4);
    assert_eq!(table.id, table_id);
    assert!(
        table_catalog_table_by_key(&engine, "Table1").is_none(),
        "relocate must not recreate a name-keyed catalog entry"
    );
    let catalog = table_catalog_table_by_key(&engine, &table_id)
        .expect("id-keyed catalog table should move with whole-table relocate");
    assert_eq!(catalog.range.start_col(), 3);
    assert_eq!(catalog.range.end_col(), 4);
    assert!(
        result
            .table_changes
            .iter()
            .any(|change| change.name == "Table1" && change.sheet_id == sid.to_uuid_string()),
        "relocate should report a table change for viewport/object refresh"
    );

    engine.undo().expect("undo relocate");
    let undone = engine
        .get_table_by_name("Table1")
        .expect("table should still exist after undoing relocate");
    assert_eq!(undone.id, table_id);
    assert_eq!(undone.range.start_col(), 0);
    assert_eq!(undone.range.end_col(), 1);
    let undone_catalog = table_catalog_table_by_key(&engine, &table_id)
        .expect("id-keyed catalog table should undo with whole-table relocate");
    assert_eq!(undone_catalog.range.start_col(), 0);
    assert_eq!(undone_catalog.range.end_col(), 1);
}

#[test]
fn relocate_containing_range_moves_embedded_table_binding() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_single_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

    engine
        .create_table_lifecycle(
            &sid,
            Some("Table1".to_string()),
            1,
            1,
            3,
            2,
            vec!["Region".to_string(), "Revenue".to_string()],
            true,
            None,
        )
        .expect("create table");

    let (_patches, result) = engine
        .relocate_cells_yrs(&sid, 0, 0, 4, 3, &sid, 0, 5)
        .expect("relocate_cells_yrs");

    let table = engine
        .get_table_by_name("Table1")
        .expect("embedded table should still exist after containing-range cut-paste");
    assert_eq!(table.range.start_row(), 1);
    assert_eq!(table.range.start_col(), 6);
    assert_eq!(table.range.end_row(), 3);
    assert_eq!(table.range.end_col(), 7);
    assert!(
        result
            .table_changes
            .iter()
            .any(|change| change.name == "Table1" && change.sheet_id == sid.to_uuid_string()),
        "containing-range relocate should report embedded table change"
    );
}

#[test]
fn relocate_cross_sheet_containing_range_moves_embedded_table_binding() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_two_sheets()).expect("from_snapshot");
    let s1 = engine.mirror().sheet_by_name("S1").expect("S1");
    let s2 = engine.mirror().sheet_by_name("S2").expect("S2");

    engine
        .create_table_lifecycle(
            &s1,
            Some("Table1".to_string()),
            1,
            1,
            3,
            2,
            vec!["Region".to_string(), "Revenue".to_string()],
            true,
            None,
        )
        .expect("create table");
    let table_id = engine
        .get_table_by_name("Table1")
        .expect("table after create")
        .id;

    let (_patches, result) = engine
        .relocate_cells_yrs(&s1, 0, 0, 4, 3, &s2, 0, 5)
        .expect("relocate_cells_yrs");

    assert!(
        engine.get_all_tables_in_sheet(&s1).is_empty(),
        "cross-sheet relocate should remove the table from the source sheet"
    );
    let target_tables = engine.get_all_tables_in_sheet(&s2);
    assert_eq!(target_tables.len(), 1);
    let table = engine
        .get_table_by_name("Table1")
        .expect("embedded table should still exist after cross-sheet cut-paste");
    assert_eq!(table.id, table_id);
    assert_eq!(table.sheet_id, s2.to_uuid_string());
    assert_eq!(table.range.start_row(), 1);
    assert_eq!(table.range.start_col(), 6);
    assert_eq!(table.range.end_row(), 3);
    assert_eq!(table.range.end_col(), 7);
    let catalog = table_catalog_table_by_key(&engine, &table_id)
        .expect("id-keyed catalog table should move cross-sheet");
    assert_eq!(catalog.sheet_id, s2.to_uuid_string());
    assert_eq!(catalog.range.start_col(), 6);
    assert!(
        result
            .table_changes
            .iter()
            .any(|change| change.name == "Table1" && change.sheet_id == s2.to_uuid_string()),
        "cross-sheet containing-range relocate should report target-sheet table change"
    );

    engine.undo().expect("undo cross-sheet relocate");
    let undone = engine
        .get_table_by_name("Table1")
        .expect("table should still exist after undoing cross-sheet relocate");
    assert_eq!(undone.id, table_id);
    assert_eq!(undone.sheet_id, s1.to_uuid_string());
    assert_eq!(undone.range.start_col(), 1);
    assert_eq!(undone.range.end_col(), 2);
    assert_eq!(engine.get_all_tables_in_sheet(&s1).len(), 1);
    assert!(engine.get_all_tables_in_sheet(&s2).is_empty());
}

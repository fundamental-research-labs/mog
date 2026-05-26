//! Row/col insert/delete dimension parity on
//! XLSX-hydrated sheets.
//!
//! Assert: pre-count + delta == post-count for each structural op.
//! Exercises whatever internal counter tracks sheet dimensions after
//! structural changes.

use compute_core::storage::engine::YrsComputeEngine;
use formula_types::StructureChange;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn fixture() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Dim".to_string(),
            rows: 20,
            cols: 10,
            cells: vec![
                value_cell(1, 0, 0, 1.0),
                value_cell(2, 5, 5, 2.0),
                value_cell(3, 19, 9, 3.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn xlsx_bytes_for(snapshot: WorkbookSnapshot) -> Vec<u8> {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes")
}

fn sheet_dims(engine: &YrsComputeEngine, sid: &cell_types::SheetId) -> (u32, u32) {
    let sm = engine.mirror().get_sheet(sid).expect("SheetMirror");
    (sm.rows, sm.cols)
}

#[test]
fn xlsx_insert_row_grows_row_count_by_delta() {
    let bytes = xlsx_bytes_for(fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    let (pre_rows, pre_cols) = sheet_dims(&engine, &sid);
    let delta: u32 = 3;
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 0,
                count: delta,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert rows");

    let (post_rows, post_cols) = sheet_dims(&engine, &sid);
    assert_eq!(
        post_rows,
        pre_rows + delta,
        "row count should grow by delta={}; pre={}, post={}",
        delta,
        pre_rows,
        post_rows
    );
    assert_eq!(
        post_cols, pre_cols,
        "col count must not change on insert_row"
    );
}

#[test]
fn xlsx_delete_row_shrinks_row_count_by_delta() {
    let bytes = xlsx_bytes_for(fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    let (pre_rows, pre_cols) = sheet_dims(&engine, &sid);
    let delta: u32 = 2;
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 0,
                count: delta,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete rows");

    let (post_rows, post_cols) = sheet_dims(&engine, &sid);
    assert_eq!(
        post_rows,
        pre_rows - delta,
        "row count should shrink by delta={}; pre={}, post={}",
        delta,
        pre_rows,
        post_rows
    );
    assert_eq!(
        post_cols, pre_cols,
        "col count must not change on delete_row"
    );
}

#[test]
fn xlsx_insert_col_grows_col_count_by_delta() {
    let bytes = xlsx_bytes_for(fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    let (pre_rows, pre_cols) = sheet_dims(&engine, &sid);
    let delta: u32 = 4;
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 0,
                count: delta,
                new_col_ids: Vec::new(),
            },
        )
        .expect("insert cols");

    let (post_rows, post_cols) = sheet_dims(&engine, &sid);
    assert_eq!(
        post_cols,
        pre_cols + delta,
        "col count should grow by delta={}; pre={}, post={}",
        delta,
        pre_cols,
        post_cols
    );
    assert_eq!(
        post_rows, pre_rows,
        "row count must not change on insert_col"
    );
}

#[test]
fn xlsx_delete_col_shrinks_col_count_by_delta() {
    let bytes = xlsx_bytes_for(fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    let (pre_rows, pre_cols) = sheet_dims(&engine, &sid);
    let delta: u32 = 1;
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 0,
                count: delta,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete cols");

    let (post_rows, post_cols) = sheet_dims(&engine, &sid);
    assert_eq!(
        post_cols,
        pre_cols - delta,
        "col count should shrink by delta={}; pre={}, post={}",
        delta,
        pre_cols,
        post_cols
    );
    assert_eq!(
        post_rows, pre_rows,
        "row count must not change on delete_col"
    );
}

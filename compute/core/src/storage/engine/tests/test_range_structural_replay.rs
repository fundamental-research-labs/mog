//! Structural observer replay coverage for Range-backed sheets.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{RangeData, SheetSnapshot};
use cell_types::{
    AxisIdentityRef, AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, ColId,
    PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetPos,
};
use formula_types::StructureChange;
use snapshot_types::WorkbookSnapshot;
use std::sync::Arc;
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "a0000000-0000-4000-8000-000000000001";
const RANGE_UUID: &str = "b0000000-0000-4000-8000-000000000001";

fn yrs_row_id(i: usize) -> RowId {
    RowId::from_raw((i + 1) as u128)
}

fn yrs_col_id(sheet_rows: usize, i: usize) -> ColId {
    ColId::from_raw((sheet_rows + i + 1) as u128)
}

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn test_range_id() -> RangeId {
    RangeId::from_uuid_str(RANGE_UUID).unwrap()
}

fn range_backed_snapshot() -> WorkbookSnapshot {
    const SHEET_ROWS: usize = 10;
    const SHEET_COLS: usize = 5;
    const RANGE_ROWS: usize = 5;
    const RANGE_COLS: usize = 2;

    let mut payload = Vec::new();
    for row_vals in &[
        [1.0_f64, 10.0],
        [2.0, 20.0],
        [3.0, 30.0],
        [4.0, 40.0],
        [5.0, 50.0],
    ] {
        for &v in row_vals {
            payload.extend_from_slice(&v.to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..RANGE_ROWS).map(yrs_row_id).collect();
    let col_ids: Vec<ColId> = (0..RANGE_COLS).map(|i| yrs_col_id(SHEET_ROWS, i)).collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS as u32,
            cols: SHEET_COLS as u32,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[RANGE_ROWS - 1],
                    start_col: col_ids[0],
                    end_col: col_ids[RANGE_COLS - 1],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids,
                col_ids,
            }],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn as_f64(val: Option<&CellValue>) -> Option<f64> {
    match val {
        Some(CellValue::Number(n)) => Some(f64::from(*n)),
        _ => None,
    }
}

fn patch_display_text_at(mutation: &[u8], row: u32, col: u32) -> Option<String> {
    let positions = extract_patch_positions(mutation);
    let patch_index = positions.iter().position(|pos| *pos == (row, col))?;
    decode_patch_display_text(mutation, patch_index)
}

fn rewrite_range_fixture_to_compact_axes(
    engine: &YrsComputeEngine,
    sheet_id: SheetId,
) -> (Vec<RowId>, Vec<ColId>) {
    use compute_document::hex::id_to_hex;
    use compute_document::range::RangeMetadata;
    use compute_document::schema::{
        KEY_COL_ORDER, KEY_GRID_INDEX, KEY_RANGES, KEY_ROW_ORDER, write_grid_col_axis,
        write_grid_row_axis,
    };
    use yrs::{Any, Map, Out, Transact};

    let row_run = AxisRunId::from_raw(0xA001);
    let col_run = AxisRunId::from_raw(0xA002);
    let row_store = AxisIdentityStore::<RowId>::from_runs([AxisIdentityRun::new(
        row_run,
        AxisIdentitySeed::from_raw(0xB001),
        0,
        10,
    )]);
    let col_store = AxisIdentityStore::<ColId>::from_runs([AxisIdentityRun::new(
        col_run,
        AxisIdentitySeed::from_raw(0xB002),
        0,
        5,
    )]);
    let row_ids: Vec<RowId> = row_store.identities_in(sheet_id, 0, 5).collect();
    let col_ids: Vec<ColId> = col_store.identities_in(sheet_id, 0, 2).collect();

    let mut txn = engine.storage().doc().transact_mut();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let Out::YMap(sheet_map) = engine
        .storage()
        .sheets()
        .get(&txn, &sheet_hex)
        .expect("sheet map")
    else {
        panic!("sheet map should be present");
    };
    let Out::YMap(grid_index_map) = sheet_map.get(&txn, KEY_GRID_INDEX).expect("gridIndex map")
    else {
        panic!("gridIndex map should be present");
    };

    write_grid_row_axis(&mut txn, &grid_index_map, &row_store).expect("write compact row axis");
    write_grid_col_axis(&mut txn, &grid_index_map, &col_store).expect("write compact col axis");
    sheet_map.remove(&mut txn, KEY_ROW_ORDER);
    sheet_map.remove(&mut txn, KEY_COL_ORDER);

    let Out::YMap(ranges_map) = sheet_map.get(&txn, KEY_RANGES).expect("ranges map") else {
        panic!("ranges map should be present");
    };
    let range_hex = id_to_hex(test_range_id().as_u128());
    let existing_json = match ranges_map.get(&txn, &range_hex).expect("range metadata") {
        Out::Any(Any::String(json)) => json.to_string(),
        _ => panic!("range metadata should be JSON"),
    };
    let mut metadata: RangeMetadata =
        serde_json::from_str(&existing_json).expect("parse range metadata");
    metadata.row_axis = Some(AxisIdentityRef::StoreRun {
        run_id: row_run,
        start_offset: 0,
        len: 5,
    });
    metadata.col_axis = Some(AxisIdentityRef::StoreRun {
        run_id: col_run,
        start_offset: 0,
        len: 2,
    });
    metadata.row_ids.clear();
    metadata.col_ids.clear();
    metadata.anchor = RangeAnchor::Elastic {
        start_row: row_ids[0],
        end_row: row_ids[4],
        start_col: col_ids[0],
        end_col: col_ids[1],
    };
    let updated_json = serde_json::to_string(&metadata).expect("serialize range metadata");
    ranges_map.insert(&mut txn, &*range_hex, Any::String(Arc::from(updated_json)));

    (row_ids, col_ids)
}

#[test]
fn range_backed_values_survive_structural_row_insert_undo_replay() {
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 5, 2)
        .expect("register viewport");

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 2,
                count: 1,
                new_row_ids: vec![RowId::from_raw(0xE100)],
            },
        )
        .unwrap();

    let (patches, _result) = engine.undo().expect("undo row insert");

    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0),
        "range-backed A1 should survive structural undo replay"
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(50.0),
        "range-backed B5 should survive structural undo replay"
    );

    let mutation = extract_first_viewport_mutation(&patches).expect("undo viewport mutation");
    let positions = extract_patch_positions(&mutation);
    assert!(
        positions.contains(&(0, 0)),
        "undo viewport patches must expose restored range-backed A1; got {positions:?}"
    );
    assert_eq!(
        patch_display_text_at(&mutation, 0, 0).as_deref(),
        Some("1"),
        "undo viewport patch for restored range-backed A1 must carry the rendered value"
    );
}

#[test]
fn range_backed_values_survive_structural_row_insert_redo_replay() {
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 2,
                count: 1,
                new_row_ids: vec![RowId::from_raw(0xE101)],
            },
        )
        .unwrap();
    engine.undo().expect("undo row insert");
    engine.redo().expect("redo row insert");

    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0),
        "range-backed A1 should survive structural redo replay"
    );
    assert!(
        engine
            .mirror()
            .get_cell_value_at(&sid, SheetPos::new(2, 0))
            .is_none_or(CellValue::is_null),
        "inserted row should remain blank after redo"
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(3.0),
        "range-backed A3 payload should shift below the inserted row after redo"
    );
}

#[test]
fn range_backed_values_survive_structural_column_insert_undo_redo_replay() {
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 1,
                count: 1,
                new_col_ids: vec![ColId::from_raw(0xE200)],
            },
        )
        .unwrap();

    engine.undo().expect("undo column insert");
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0),
        "range-backed B1 should survive column structural undo replay"
    );

    engine.redo().expect("redo column insert");
    assert!(
        engine
            .mirror()
            .get_cell_value_at(&sid, SheetPos::new(0, 1))
            .is_none_or(CellValue::is_null),
        "inserted column should be blank after redo"
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 2))),
        Some(10.0),
        "range-backed B1 payload should shift to C1 after redo"
    );
}

#[test]
fn yrs_rebuild_resolves_compact_axes_with_absent_dense_arrays() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();
    let (row_ids, col_ids) = rewrite_range_fixture_to_compact_axes(&engine, sid);

    let sheet_snapshot =
        crate::storage::engine::construction::build_sheet_snapshot_from_yrs(engine.storage(), &sid)
            .expect("compact snapshot rebuild should succeed")
            .expect("sheet should exist");
    assert_eq!(sheet_snapshot.rows, 10);
    assert_eq!(sheet_snapshot.cols, 5);
    assert_eq!(sheet_snapshot.ranges[0].row_ids, row_ids);
    assert_eq!(sheet_snapshot.ranges[0].col_ids, col_ids);

    let grid = crate::storage::engine::build_grid_from_yrs_for_sheet(
        engine.storage(),
        sid,
        &sheet_snapshot,
        engine.stores.grid_id_alloc.clone(),
    )
    .expect("compact GridIndex rebuild should succeed");
    assert!(
        grid.row_ids_dense().is_empty(),
        "compact-axis rebuild must not depend on dense row ids"
    );
    assert_eq!(grid.row_count(), 10);
    assert_eq!(grid.col_count(), 5);

    let full_state = compute_collab::encode_full_state(engine.storage().doc());
    let (reloaded, _recalc) =
        YrsComputeEngine::from_yrs_state(&full_state).expect("from compact Yrs state");
    assert_eq!(
        as_f64(
            reloaded
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(0, 0))
        ),
        Some(1.0),
        "compact-axis full rebuild should hydrate range-backed A1"
    );
    assert_eq!(
        as_f64(
            reloaded
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(4, 1))
        ),
        Some(50.0),
        "compact-axis full rebuild should hydrate range-backed B5"
    );
}

#[test]
fn yrs_rebuild_rejects_asymmetric_compact_axes() {
    use compute_document::hex::id_to_hex;
    use compute_document::schema::{KEY_GRID_INDEX, write_grid_row_axis};
    use yrs::{Map, Out, Transact};

    let (engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();
    let row_store = AxisIdentityStore::<RowId>::from_runs([AxisIdentityRun::new(
        AxisRunId::from_raw(0xA011),
        AxisIdentitySeed::from_raw(0xB011),
        0,
        10,
    )]);

    {
        let mut txn = engine.storage().doc().transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let Out::YMap(sheet_map) = engine
            .storage()
            .sheets()
            .get(&txn, &sheet_hex)
            .expect("sheet map")
        else {
            panic!("sheet map should be present");
        };
        let Out::YMap(grid_index_map) = sheet_map.get(&txn, KEY_GRID_INDEX).expect("gridIndex map")
        else {
            panic!("gridIndex map should be present");
        };
        write_grid_row_axis(&mut txn, &grid_index_map, &row_store)
            .expect("write row axis without matching column axis");
    }

    let full_state = compute_collab::encode_full_state(engine.storage().doc());
    let err = YrsComputeEngine::from_yrs_state(&full_state)
        .expect_err("asymmetric compact axes should be rejected");
    assert!(
        err.to_string().contains("asymmetric compact grid axes"),
        "expected asymmetric compact-axis error, got {err}"
    );
}

#[test]
fn yrs_rebuild_rejects_malformed_compact_axis_payload() {
    use compute_document::hex::id_to_hex;
    use compute_document::schema::{KEY_GRID_INDEX, KEY_GRID_ROW_AXIS};
    use yrs::{Any, Map, Out, Transact};

    let (engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();

    {
        let mut txn = engine.storage().doc().transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let Out::YMap(sheet_map) = engine
            .storage()
            .sheets()
            .get(&txn, &sheet_hex)
            .expect("sheet map")
        else {
            panic!("sheet map should be present");
        };
        let Out::YMap(grid_index_map) = sheet_map.get(&txn, KEY_GRID_INDEX).expect("gridIndex map")
        else {
            panic!("gridIndex map should be present");
        };
        grid_index_map.insert(
            &mut txn,
            KEY_GRID_ROW_AXIS,
            Any::String(Arc::from("{not-valid-json")),
        );
    }

    let full_state = compute_collab::encode_full_state(engine.storage().doc());
    let err = YrsComputeEngine::from_yrs_state(&full_state)
        .expect_err("malformed compact axis should be rejected");
    assert!(
        err.to_string()
            .contains("malformed row compact axis payload"),
        "expected malformed compact-axis error, got {err}"
    );
}

#[test]
fn yrs_rebuild_rejects_unresolved_compact_range_axis_ref() {
    use compute_document::hex::id_to_hex;
    use compute_document::range::RangeMetadata;
    use compute_document::schema::{
        KEY_GRID_INDEX, KEY_RANGES, write_grid_col_axis, write_grid_row_axis,
    };
    use yrs::{Any, Map, Out, Transact};

    let (engine, _recalc) = YrsComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();
    let row_run = AxisRunId::from_raw(0xA021);
    let col_run = AxisRunId::from_raw(0xA022);
    let row_store = AxisIdentityStore::<RowId>::from_runs([AxisIdentityRun::new(
        row_run,
        AxisIdentitySeed::from_raw(0xB021),
        0,
        4,
    )]);
    let col_store = AxisIdentityStore::<ColId>::from_runs([AxisIdentityRun::new(
        col_run,
        AxisIdentitySeed::from_raw(0xB022),
        0,
        2,
    )]);
    let row_ids: Vec<RowId> = row_store.identities_in(sid, 0, 4).collect();
    let col_ids: Vec<ColId> = col_store.identities_in(sid, 0, 2).collect();

    {
        let mut txn = engine.storage().doc().transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let Out::YMap(sheet_map) = engine
            .storage()
            .sheets()
            .get(&txn, &sheet_hex)
            .expect("sheet map")
        else {
            panic!("sheet map should be present");
        };
        let Out::YMap(grid_index_map) = sheet_map.get(&txn, KEY_GRID_INDEX).expect("gridIndex map")
        else {
            panic!("gridIndex map should be present");
        };
        write_grid_row_axis(&mut txn, &grid_index_map, &row_store).expect("write compact row axis");
        write_grid_col_axis(&mut txn, &grid_index_map, &col_store).expect("write compact col axis");

        let Out::YMap(ranges_map) = sheet_map.get(&txn, KEY_RANGES).expect("ranges map") else {
            panic!("ranges map should be present");
        };
        let range_hex = id_to_hex(test_range_id().as_u128());
        let existing_json = match ranges_map.get(&txn, &range_hex).expect("range metadata") {
            Out::Any(Any::String(json)) => json.to_string(),
            _ => panic!("range metadata should be JSON"),
        };
        let mut metadata: RangeMetadata =
            serde_json::from_str(&existing_json).expect("parse range metadata");
        metadata.row_axis = Some(AxisIdentityRef::StoreRun {
            run_id: row_run,
            start_offset: 0,
            len: 5,
        });
        metadata.col_axis = Some(AxisIdentityRef::StoreRun {
            run_id: col_run,
            start_offset: 0,
            len: 2,
        });
        metadata.row_ids.clear();
        metadata.col_ids.clear();
        metadata.anchor = RangeAnchor::Elastic {
            start_row: row_ids[0],
            end_row: row_ids[3],
            start_col: col_ids[0],
            end_col: col_ids[1],
        };
        let updated_json = serde_json::to_string(&metadata).expect("serialize range metadata");
        ranges_map.insert(&mut txn, &*range_hex, Any::String(Arc::from(updated_json)));
    }

    let full_state = compute_collab::encode_full_state(engine.storage().doc());
    let err = YrsComputeEngine::from_yrs_state(&full_state)
        .expect_err("unresolved compact range axis ref should be rejected");
    assert!(
        err.to_string().contains("row axis ref does not resolve"),
        "expected unresolved compact range axis error, got {err}"
    );
}

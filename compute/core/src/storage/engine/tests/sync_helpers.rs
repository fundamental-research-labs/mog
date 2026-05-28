//! Sync-specific helpers for storage engine tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{RangeData, SheetSnapshot};
use snapshot_types::{ChangeKind, SheetChangeField, WorkbookSnapshot};

pub(super) const RANGE_REPLAY_SHEET_UUID: &str = "a0000000-0000-4000-8000-000000000101";
pub(super) const RANGE_REPLAY_RANGE_UUID: &str = "b0000000-0000-4000-8000-000000000101";

pub(super) fn replay_row_id(i: usize) -> cell_types::RowId {
    cell_types::RowId::from_raw((i + 1) as u128)
}

pub(super) fn replay_col_id(sheet_rows: usize, i: usize) -> cell_types::ColId {
    cell_types::ColId::from_raw((sheet_rows + i + 1) as u128)
}

pub(super) fn provider_replay_range_backed_snapshot() -> WorkbookSnapshot {
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

    let row_ids: Vec<_> = (0..RANGE_ROWS).map(replay_row_id).collect();
    let col_ids: Vec<_> = (0..RANGE_COLS)
        .map(|i| replay_col_id(SHEET_ROWS, i))
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: RANGE_REPLAY_SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS as u32,
            cols: SHEET_COLS as u32,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: cell_types::RangeId::from_uuid_str(RANGE_REPLAY_RANGE_UUID).unwrap(),
                kind: cell_types::RangeKind::Data,
                anchor: cell_types::RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[RANGE_ROWS - 1],
                    start_col: col_ids[0],
                    end_col: col_ids[RANGE_COLS - 1],
                },
                encoding: cell_types::PayloadEncoding::F64Le,
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
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub(super) fn sync_a_to_b_diff(
    engine_a: &YrsComputeEngine,
    engine_b: &mut YrsComputeEngine,
) -> MutationResult {
    let b_sv = compute_collab::encode_state_vector(engine_b.storage().doc());
    let a_diff = compute_collab::encode_diff(engine_a.storage().doc(), &b_sv).unwrap();
    let (_, result) = engine_b.apply_sync_update(&a_diff).unwrap();
    result
}

pub(super) fn sync_bidirectional(engine_a: &mut YrsComputeEngine, engine_b: &mut YrsComputeEngine) {
    let _ = sync_a_to_b_diff(engine_a, engine_b);
    let _ = sync_a_to_b_diff(engine_b, engine_a);
}

pub(super) fn assert_sheet_change(
    result: &MutationResult,
    sheet_id: &SheetId,
    field: SheetChangeField,
    kind: ChangeKind,
) {
    assert!(
        result.sheet_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.field == field
                && change.kind == kind
        }),
        "expected sheet change ({field:?}, {kind:?}) for {}; got {:?}",
        sheet_id.to_uuid_string(),
        result.sheet_changes,
    );
}

pub(super) fn assert_cell_is_42(engine: &YrsComputeEngine, sheet_id: &SheetId) {
    let value = engine.get_cell_value(sheet_id, 0, 0);
    assert!(
        matches!(&value, value_types::CellValue::Number(n) if n.get() == 42.0)
            || matches!(&value, value_types::CellValue::Text(s) if s.as_ref() == "42"),
        "engine must read 42 from A1; got {value:?}",
    );
}

pub(super) fn sync_a_to_b(
    mutate_a: fn(&mut YrsComputeEngine, &SheetId),
) -> (YrsComputeEngine, SheetId, MutationResult) {
    let (room_state, sheet_id) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    mutate_a(&mut engine_a, &sheet_id);

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    (engine_b, sheet_id, result)
}

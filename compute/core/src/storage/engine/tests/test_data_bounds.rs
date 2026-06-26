//! Regression tests for `get_data_bounds`.
//!
//! Bug: on a merge-receiving engine, the bounds query did not include the
//! merge footprint. Originator and receiver disagreed on `getUsedRange`
//! even though they held identical CRDT state.
//!
//! Fix: `get_data_bounds` now unions in the bounding box of every merge
//! region on the sheet (via `merges::iter_merge_bounds`), so the result is
//! a pure function of Yrs CRDT state.

use super::super::*;
use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
use domain_types::CellFormat;

const SHEET_UUID: &str = "aa111111111111111111111111111001";

fn empty_snapshot() -> WorkbookSnapshot {
    // Empty sheet: no pre-populated cells, so `col_data` is empty and step 2
    // of `get_data_bounds` (sheet-extent expansion) is skipped — letting us
    // observe the contribution of merges in isolation.
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

/// Fork a second engine from the first engine's Yrs state so both share the
/// same document history (client-id partitioning is handled by
/// `from_yrs_state`). This is how real collaboration is set up — two engines
/// created from independent `from_snapshot` calls would each have their own
/// sheet map and never reconcile via CRDT sync.
fn fork_engine(source: &YrsComputeEngine) -> YrsComputeEngine {
    let state_bytes = compute_collab::encode_full_state(source.storage().doc());
    let (engine, _) = YrsComputeEngine::from_yrs_state(&state_bytes).expect("from_yrs_state fork");
    engine
}

/// Apply the delta from `source` onto `target` so `target` catches up to
/// `source`'s CRDT state.
fn sync_into(source: &YrsComputeEngine, target: &mut YrsComputeEngine) {
    let sv = target.encode_state_vector();
    let update = source.encode_diff(&sv).expect("encode_diff");
    target
        .apply_sync_update_legacy(&update)
        .expect("apply_sync_update");
}

// -------------------------------------------------------------------
// Test 1: Bounds include merge footprint (originator path).
// -------------------------------------------------------------------

/// On a fresh sheet with no cell writes, applying a merge A1:B2 must cause
/// `get_data_bounds` to return A1:B2. Before the fix this already held on
/// the originator (by accident — `merge_range` allocates corner CellIds which
/// trips `expand_extent`). We keep the assertion so the behaviour is
/// anchored regardless of whether the originator keeps allocating those
/// placeholder corners.
#[test]
fn test_get_data_bounds_includes_merge_footprint() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();

    // Precondition: empty sheet has no bounds.
    assert!(
        engine.get_data_bounds(&sid).is_none(),
        "fresh empty sheet should report no data bounds",
    );

    // Merge A1:B2.
    engine.merge_range(&sid, 0, 0, 1, 1).expect("merge_range");

    let bounds = engine
        .get_data_bounds(&sid)
        .expect("merge alone must establish bounds");
    assert_eq!(bounds.min_row, 0, "min_row should be 0 (row A)");
    assert_eq!(bounds.min_col, 0, "min_col should be 0 (col A)");
    assert_eq!(bounds.max_row, 1, "max_row should be 1 (row 2)");
    assert_eq!(bounds.max_col, 1, "max_col should be 1 (col B)");
}

#[test]
fn absent_far_clear_does_not_grow_empty_sheet() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();

    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);
    assert!(engine.get_data_bounds(&sid).is_none());

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                99_999,
                9_999,
                crate::storage::engine::mutation::CellInput::Clear,
            )],
            true,
        )
        .unwrap();

    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);
    assert!(engine.get_cell_id_at(&sid, 99_999, 9_999).is_none());
    assert!(engine.get_data_bounds(&sid).is_none());
    assert!(
        !engine.can_undo(),
        "no-op absent clear should not create an undo item",
    );
}

#[test]
fn clearing_far_written_footprint_shrinks_bounds_to_empty() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine
        .set_cell_value_parsed(&sid, 0, 0, "anchor")
        .expect("write A1");
    engine
        .set_cell_value_parsed(&sid, 0, 2, "=ZZ2")
        .expect("write C1 formula");
    engine
        .set_cell_value_parsed(&sid, 0, 2, "formula overwritten")
        .expect("overwrite C1 formula");
    engine
        .set_cell_value_parsed(&sid, 20, 701, "temporary far value")
        .expect("write ZZ21");

    let bounds = engine.get_data_bounds(&sid).expect("bounds before clear");
    assert_eq!(bounds.min_row, 0);
    assert_eq!(bounds.min_col, 0);
    assert_eq!(bounds.max_row, 20);
    assert_eq!(bounds.max_col, 701);

    engine
        .clear_range_by_position(sid, 0, 0, 20, 701)
        .expect("clear used footprint");

    assert!(
        engine.get_data_bounds(&sid).is_none(),
        "cleared null-only dense storage must not keep stale used bounds",
    );
}

#[test]
fn format_only_cells_do_not_establish_data_bounds() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    engine
        .set_format_for_ranges(&sid, &[(0, 16_383, 0, 16_383)], &format)
        .expect("format XFD1");

    assert!(
        engine.get_data_bounds(&sid).is_none(),
        "formatting XFD1 alone must not make the sheet's used/data range reach XFD",
    );
}

#[test]
fn format_only_cells_do_not_expand_existing_data_bounds() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    engine
        .set_cell_value_parsed(&sid, 144, 108, "last data cell")
        .expect("write DE145");
    engine
        .set_format_for_ranges(&sid, &[(144, 16_383, 144, 16_383)], &format)
        .expect("format XFD145");

    let bounds = engine
        .get_data_bounds(&sid)
        .expect("real data should establish bounds");
    assert_eq!(bounds.min_row, 144);
    assert_eq!(bounds.min_col, 108);
    assert_eq!(bounds.max_row, 144);
    assert_eq!(
        bounds.max_col, 108,
        "format-only XFD145 must not expand data bounds beyond DE145",
    );

    let explicit_format_cell = engine.query_range(&sid, 144, 16_383, 144, 16_383);
    assert_eq!(
        explicit_format_cell.cells.len(),
        1,
        "explicit range queries should still expose the format-only cell",
    );
}

// -------------------------------------------------------------------
// Test 2: Originator vs apply-via-update symmetry.
// -------------------------------------------------------------------

/// Two engines fork from the same Yrs state; engine1 runs `merge_range`, the
/// resulting CRDT update is applied to engine2 via `apply_sync_update`. Both
/// engines hold identical CRDT state, therefore `get_data_bounds` must return
/// the same answer on both —
/// including bounds that cover the merge footprint.
#[test]
fn test_get_data_bounds_merge_sync_symmetry() {
    let (mut engine1, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let mut engine2 = fork_engine(&engine1);
    let sid = test_sheet_id();

    // engine1: originator.
    engine1.merge_range(&sid, 0, 0, 1, 1).expect("merge_range");

    // Sync engine1 → engine2.
    sync_into(&engine1, &mut engine2);

    let b1 = engine1.get_data_bounds(&sid).expect("engine1 bounds");
    let b2 = engine2.get_data_bounds(&sid).expect("engine2 bounds");

    assert_eq!(
        b1, b2,
        "originator and merge-receiver must agree on get_data_bounds; \
         got {:?} vs {:?}",
        b1, b2,
    );
    // And the bounds must actually be the merge footprint, not 0x0.
    assert_eq!(b1.min_row, 0);
    assert_eq!(b1.min_col, 0);
    assert_eq!(b1.max_row, 1);
    assert_eq!(b1.max_col, 1);
}

// -------------------------------------------------------------------
// Test 3: Merge + write extends further, on both originator and receiver.
// -------------------------------------------------------------------

/// After a merge A1:B2 synced to both engines, a write at C1 on the
/// receiver (then synced back) must push both engines' bounds out to
/// A1:C2. Verifies that the merge-union step composes with the other
/// sources of bounds (cells, sheet extent) instead of masking them.
#[test]
fn test_get_data_bounds_merge_plus_write_symmetric() {
    let (mut engine1, _) = YrsComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let mut engine2 = fork_engine(&engine1);
    let sid = test_sheet_id();

    // engine1 merges A1:B2.
    engine1.merge_range(&sid, 0, 0, 1, 1).expect("merge_range");

    // Sync engine1 → engine2.
    sync_into(&engine1, &mut engine2);

    // Receiver writes C1.
    engine2
        .set_cell_value_parsed(&sid, 0, 2, "side-value")
        .expect("set_cell_value_parsed");

    // Sync engine2 → engine1.
    sync_into(&engine2, &mut engine1);

    let b1 = engine1.get_data_bounds(&sid).expect("engine1 bounds");
    let b2 = engine2.get_data_bounds(&sid).expect("engine2 bounds");

    assert_eq!(
        b1, b2,
        "after merge+C1 write and round-trip sync, both engines must agree; \
         got {:?} vs {:?}",
        b1, b2,
    );
    assert_eq!(b1.min_row, 0, "min_row should be 0");
    assert_eq!(b1.min_col, 0, "min_col should be 0");
    assert_eq!(
        b1.max_row, 1,
        "max_row should reach row 1 (bottom of merge A1:B2)",
    );
    assert_eq!(
        b1.max_col, 2,
        "max_col should reach col C (the post-merge write)",
    );
}

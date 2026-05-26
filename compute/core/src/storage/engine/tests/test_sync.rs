//! Group 4: Sync / state vector.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{RangeData, SheetSnapshot};
use domain_types::domain::comment::CommentType;
use snapshot_types::{Axis, ChangeKind, SheetChangeField, StructureChangeType, WorkbookSnapshot};

const RANGE_REPLAY_SHEET_UUID: &str = "a0000000-0000-4000-8000-000000000101";
const RANGE_REPLAY_RANGE_UUID: &str = "b0000000-0000-4000-8000-000000000101";

fn replay_row_id(i: usize) -> cell_types::RowId {
    cell_types::RowId::from_raw((i + 1) as u128)
}

fn replay_col_id(sheet_rows: usize, i: usize) -> cell_types::ColId {
    cell_types::ColId::from_raw((sheet_rows + i + 1) as u128)
}

fn provider_replay_range_backed_snapshot() -> WorkbookSnapshot {
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

// -------------------------------------------------------------------
// Test 6: Sync state vector encode/decode round-trip
// -------------------------------------------------------------------

#[test]
fn test_sync_state_vector_roundtrip() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Encode state vector
    let sv = engine.encode_state_vector();
    assert!(!sv.is_empty());

    // Encoding a diff against our own state vector should produce
    // a minimal (effectively empty) update.
    let diff = engine.encode_diff(&sv);
    assert!(diff.is_ok());

    // The diff should be small (no actual changes to send).
    let diff_bytes = diff.unwrap();
    assert!(!diff_bytes.is_empty()); // yrs always produces at least a header
}

// -------------------------------------------------------------------
// Test 11: Sync update round-trip between two engines
// -------------------------------------------------------------------

#[test]
fn test_sync_between_two_engines() {
    let snap = simple_snapshot();
    let (engine1, _) = YrsComputeEngine::from_snapshot(snap.clone()).unwrap();
    let (engine2, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Both engines start with the same snapshot.
    // Encode engine1's full state and verify engine2 can compute a diff.
    let sv1 = engine1.encode_state_vector();
    let sv2 = engine2.encode_state_vector();

    // Both should have non-empty state vectors
    assert!(!sv1.is_empty());
    assert!(!sv2.is_empty());

    // Each engine can encode a diff for the other
    let diff_1_to_2 = engine1.encode_diff(&sv2);
    assert!(diff_1_to_2.is_ok());

    let diff_2_to_1 = engine2.encode_diff(&sv1);
    assert!(diff_2_to_1.is_ok());
}

// -------------------------------------------------------------------
// Provider Protocol regression: cross-session refresh replay.
//
// Scenario (mirroring `dev/app-eval/scenarios/lifecycle/refresh-persistence/
// refresh-after-edit-restores`):
//
//   Session A: blank engine boots, default-sheet bootstrap creates "Sheet1",
//     user edits a cell, full-state encode → IDB.
//
//   Session B (post-reload): NEW blank engine, NO default-sheet bootstrap
//     yet (per the §4 ordering — Provider attach runs BEFORE default-sheet
//     creation). Apply session A's encoded bytes via `apply_sync_update`.
//     Then, mirroring `executeAttachProviders`, ask `get_all_sheet_ids()`.
//
//   Expected: session B reports session A's sheet — the doc converged.
//
//   Pre-fix bug: session B reports zero sheets, lifecycle proceeds to
//   `createDefaultSheet('Sheet1')` and creates a NEW empty sheet on top.
//   User sees blank doc (issue #112).
//
// This is the exact production path that
// `compute_apply_sync_update` flows through. If this test fails, the bug
// is reproduced at the engine boundary; the fix lands in `YrsComputeEngine`
// or its dependencies.
// -------------------------------------------------------------------

#[test]
fn provider_refresh_replay_round_trip_through_engine() {
    // -------------------------------------------------
    // Session A: blank → default-sheet bootstrap → edit
    // -------------------------------------------------
    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();

    // Lifecycle's `executeStartBridge` historically created the default
    // sheet here. The Provider attach path now owns that bootstrap (post-
    // attach), but on a FIRST boot (no Provider replay) the same call
    // runs. Mirror it: the engine sees "Sheet1" as the doc's sole sheet.
    let (sheet_a_hex, _) = engine_a
        .create_default_sheet("Sheet1")
        .expect("session A default sheet");
    assert_eq!(
        engine_a.get_all_sheet_ids().len(),
        1,
        "session A must have exactly one sheet after bootstrap",
    );

    // The "user edit": a single cell. This is exactly the kind of mutation
    // the harness's `setCellValue` interaction performs.
    let sheet_id_a =
        cell_types::SheetId::from_uuid_str(&sheet_a_hex).expect("session A sheet hex should parse");
    engine_a
        .set_cell_value_as_text(&sheet_id_a, 0, 0, "hello")
        .expect("session A set cell A1");

    // Session A persists: `compute_collab::encode_full_state`.
    let persisted_bytes = compute_collab::encode_full_state(engine_a.storage().doc());
    assert!(
        !persisted_bytes.is_empty(),
        "session A produced empty bytes"
    );

    // -------------------------------------------------
    // Session B: blank → apply_sync_update (Provider replay) → check sheets
    // -------------------------------------------------
    let (mut engine_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();

    // Pre-attach: session B has NO sheets yet. This matches the §4
    // ordering — `executeAttachProviders` defers default-sheet creation
    // until after replay.
    assert_eq!(
        engine_b.get_all_sheet_ids().len(),
        0,
        "session B pre-replay: no sheets yet (default-sheet bootstrap deferred)",
    );

    // Apply session A's full-state bytes — this is the EXACT call
    // `bridge.syncApply` makes through to Rust during Provider replay.
    engine_b
        .apply_sync_update(&persisted_bytes)
        .expect("session B apply_sync_update must succeed");

    // Post-attach: lifecycle reads `get_all_sheet_ids()` to decide
    // whether to create the default sheet. THIS is the assertion that
    // captures the bug. If session A's sheet didn't propagate through
    // replay, lifecycle creates a NEW Sheet1 on top — silent data loss.
    let session_b_sheets = engine_b.get_all_sheet_ids();
    assert_eq!(
        session_b_sheets.len(),
        1,
        "session B must see session A's sheet after Provider replay; \
         got {} sheets — lifecycle would create a duplicate Sheet1 over \
         the original. Bytes={} bytes, sv_after={} bytes.",
        session_b_sheets.len(),
        persisted_bytes.len(),
        engine_b.encode_state_vector().len(),
    );

    // The replayed sheet id MUST match session A's — proving the doc
    // converged, not just "any sheet exists somehow".
    assert_eq!(
        session_b_sheets[0], sheet_a_hex,
        "session B's sheet id must match session A's replayed id",
    );

    // And the cell value must be recoverable through session B's read
    // path. (If we can read it, the user's edit is restored.)
    let sheet_id_b = cell_types::SheetId::from_uuid_str(&session_b_sheets[0])
        .expect("session B sheet hex should parse");
    let value = engine_b.get_cell_value(&sheet_id_b, 0, 0);
    assert!(
        matches!(value, value_types::CellValue::Text(ref s) if s.as_ref() == "hello"),
        "session B must read 'hello' from A1 after replay; got {:?}",
        engine_b.get_cell_value(&sheet_id_b, 0, 0),
    );
}

#[test]
fn provider_refresh_replay_materializes_range_backed_values() {
    let (engine_a, _) =
        YrsComputeEngine::from_snapshot(provider_replay_range_backed_snapshot()).unwrap();
    let sheet_a = cell_types::SheetId::from_uuid_str(RANGE_REPLAY_SHEET_UUID).unwrap();

    assert!(
        matches!(
            engine_a.get_cell_value(&sheet_a, 0, 1),
            value_types::CellValue::Number(n) if n.get() == 10.0
        ),
        "session A must read the range-backed B1 value before persistence",
    );

    let persisted_bytes = compute_collab::encode_full_state(engine_a.storage().doc());

    let (mut engine_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine_b
        .apply_sync_update(&persisted_bytes)
        .expect("session B apply_sync_update must accept range-backed full state");

    let sheet_b = cell_types::SheetId::from_uuid_str(
        engine_b
            .get_all_sheet_ids()
            .first()
            .expect("session B should replay the persisted sheet"),
    )
    .unwrap();
    let value = engine_b.get_cell_value(&sheet_b, 0, 1);
    assert!(
        matches!(value, value_types::CellValue::Number(n) if n.get() == 10.0),
        "Provider replay must rebuild mirror row/col indexes and finalize Range hydration; got {value:?}",
    );

    match engine_b.mirror().cell_render_at(&sheet_b, 0, 1) {
        crate::projection::CellRender::Plain(view) => assert!(
            matches!(view.value, value_types::CellValue::Number(n) if n.get() == 10.0),
            "Provider replay must make range-backed values visible through viewport rendering too; got {:?}",
            view.value,
        ),
        other => panic!(
            "Provider replay must make range-backed values visible through viewport rendering too; got {other:?}",
        ),
    }
}

// -------------------------------------------------------------------
// Provider Protocol — incremental update replay path
//
// The IndexedDBProvider stores updates as (snapshot_bytes, [update_bytes…])
// and replays them in the same order on attach. Mirror that: instead of one
// big full-state blob, session A makes its edit AFTER bootstrap and we
// capture incremental update bytes via `subscribe_update_v1`. Session B
// applies them in order — which is what `IndexedDBProvider.attach`'s loop
// does.
// -------------------------------------------------------------------

#[test]
fn provider_refresh_replay_incremental_updates_through_engine() {
    use std::sync::{Arc, Mutex};

    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let engine_a_snapshot = compute_collab::encode_full_state(engine_a.storage().doc());

    // Subscribe BEFORE the bootstrap so we capture every update from
    // session A — including the default-sheet creation. The IDB Provider
    // sees these in identical order after its initial snapshot checkpoint.
    let captured: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_for_cb = Arc::clone(&captured);
    let _sub = compute_collab::subscribe_update_v1(engine_a.storage().doc(), move |bytes| {
        captured_for_cb.lock().unwrap().push(bytes.to_vec());
    });

    let (sheet_a_hex, _) = engine_a
        .create_default_sheet("Sheet1")
        .expect("session A default sheet");
    let sheet_id_a = cell_types::SheetId::from_uuid_str(&sheet_a_hex).unwrap();
    engine_a
        .set_cell_value_as_text(&sheet_id_a, 0, 0, "hello")
        .expect("session A set cell A1");

    let updates = captured.lock().unwrap().clone();
    assert!(
        !updates.is_empty(),
        "session A must produce at least one update_v1 payload",
    );

    // Session B: replay each update in order, mirroring the IDB Provider's
    // attach loop: first the initial full-state checkpoint, then every
    // incremental update entry in Provider order.
    let (mut engine_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine_b
        .apply_sync_update(&engine_a_snapshot)
        .expect("session B apply_sync_update (snapshot) must succeed");
    for update in &updates {
        engine_b
            .apply_sync_update(update)
            .expect("session B apply_sync_update (incremental) must succeed");
    }

    // Same assertions as the full-state variant — the user's sheet must
    // be visible and readable.
    let session_b_sheets = engine_b.get_all_sheet_ids();
    assert_eq!(
        session_b_sheets.len(),
        1,
        "session B must see exactly one sheet after replaying {} updates; \
         got {}. update lengths = {:?}",
        updates.len(),
        session_b_sheets.len(),
        updates.iter().map(|u| u.len()).collect::<Vec<_>>(),
    );
    assert_eq!(session_b_sheets[0], sheet_a_hex);

    let sheet_id_b = cell_types::SheetId::from_uuid_str(&session_b_sheets[0]).unwrap();
    let value = engine_b.get_cell_value(&sheet_id_b, 0, 0);
    assert!(
        matches!(value, value_types::CellValue::Text(ref s) if s.as_ref() == "hello"),
        "session B must read 'hello' from A1 after replay; got {:?}",
        engine_b.get_cell_value(&sheet_id_b, 0, 0),
    );
}

#[test]
fn provider_refresh_replay_does_not_require_empty_session_baseline_before_later_client_updates() {
    use std::sync::{Arc, Mutex};

    // Session A persists the original document: schema snapshot first, then
    // default-sheet creation in the update log. This mirrors IndexedDB's
    // snapshot+updates replay shape.
    let (mut session_a, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let session_a_snapshot = compute_collab::encode_full_state(session_a.storage().doc());

    let session_a_updates: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let session_a_updates_for_cb = Arc::clone(&session_a_updates);
    let _session_a_sub =
        compute_collab::subscribe_update_v1(session_a.storage().doc(), move |bytes| {
            session_a_updates_for_cb
                .lock()
                .unwrap()
                .push(bytes.to_vec());
        });
    let (sheet_hex, _) = session_a
        .create_default_sheet("Sheet1")
        .expect("session A default sheet");
    let session_a_updates = session_a_updates.lock().unwrap().clone();
    assert!(
        !session_a_updates.is_empty(),
        "session A default-sheet bootstrap must produce Provider updates",
    );

    // Session B opens the existing doc. `from_snapshot(default)` intentionally
    // writes no workbook children for an empty snapshot: provider attach must
    // replay persisted bytes before any default-sheet bootstrap. Because there
    // is no session-local empty baseline, later edits from this client must be
    // replayable without first applying `session_b_baseline`.
    let (mut session_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let session_b_baseline = compute_collab::encode_full_state(session_b.storage().doc());
    session_b
        .apply_sync_update(&session_a_snapshot)
        .expect("session B replay snapshot");
    for update in &session_a_updates {
        session_b
            .apply_sync_update(update)
            .expect("session B replay update");
    }

    let edit_updates: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let edit_updates_for_cb = Arc::clone(&edit_updates);
    let _edit_sub = compute_collab::subscribe_update_v1(session_b.storage().doc(), move |bytes| {
        edit_updates_for_cb.lock().unwrap().push(bytes.to_vec());
    });
    let sheet_id = cell_types::SheetId::from_uuid_str(&sheet_hex).unwrap();
    session_b
        .set_cell_value_as_text(&sheet_id, 0, 0, "second")
        .expect("session B edit A1");
    let edit_updates = edit_updates.lock().unwrap().clone();
    assert!(
        !edit_updates.is_empty(),
        "session B edit must produce at least one Provider update",
    );

    // Empty-session bootstraps must not create a causal dependency that makes
    // later Provider updates unreplayable. Replaying Session A's persisted
    // snapshot/update log and Session B's edit updates is sufficient.
    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update(&session_a_snapshot)
        .expect("replay snapshot");
    for update in &session_a_updates {
        replayed.apply_sync_update(update).expect("replay seed");
    }
    for update in &edit_updates {
        replayed
            .apply_sync_update(update)
            .expect("replay edit without empty baseline");
    }
    let value = replayed.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(value, value_types::CellValue::Text(ref s) if s.as_ref() == "second"),
        "empty session baseline must not be required for later client updates; got {value:?}",
    );

    replayed
        .apply_sync_update(&session_b_baseline)
        .expect("replay empty session B baseline");
    let value = replayed.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(value, value_types::CellValue::Text(ref s) if s.as_ref() == "second"),
        "empty session baseline replay must be a no-op over materialized edits; got {value:?}",
    );
}

fn sync_a_to_b_diff(
    engine_a: &YrsComputeEngine,
    engine_b: &mut YrsComputeEngine,
) -> MutationResult {
    let b_sv = compute_collab::encode_state_vector(engine_b.storage().doc());
    let a_diff = compute_collab::encode_diff(engine_a.storage().doc(), &b_sv).unwrap();
    let (_, result) = engine_b.apply_sync_update(&a_diff).unwrap();
    result
}

fn sync_bidirectional(engine_a: &mut YrsComputeEngine, engine_b: &mut YrsComputeEngine) {
    let _ = sync_a_to_b_diff(engine_a, engine_b);
    let _ = sync_a_to_b_diff(engine_b, engine_a);
}

fn assert_sheet_change(
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

fn assert_cell_is_42(engine: &YrsComputeEngine, sheet_id: &SheetId) {
    let value = engine.get_cell_value(sheet_id, 0, 0);
    assert!(
        matches!(&value, value_types::CellValue::Number(n) if n.get() == 42.0)
            || matches!(&value, value_types::CellValue::Text(s) if s.as_ref() == "42"),
        "engine must read 42 from A1; got {value:?}",
    );
}

// -------------------------------------------------------------------
// Collaboration bootstrap contracts
// -------------------------------------------------------------------

#[test]
fn sync_forked_engines_share_default_sheet_history() {
    let (room_state, sheet_id) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    assert_eq!(
        engine_a.get_all_sheet_ids(),
        vec![sheet_id.to_uuid_string()],
        "engine A must hydrate the canonical default sheet",
    );
    assert_eq!(
        engine_b.get_all_sheet_ids(),
        vec![sheet_id.to_uuid_string()],
        "engine B must hydrate the canonical default sheet",
    );

    engine_a
        .set_cell_value_as_text(&sheet_id, 0, 0, "42")
        .expect("engine A set A1");
    assert_cell_is_42(&engine_a, &sheet_id);

    let _ = sync_a_to_b_diff(&engine_a, &mut engine_b);
    assert_cell_is_42(&engine_b, &sheet_id);
}

#[test]
fn sync_independent_default_sheet_bootstraps_are_not_deep_merged() {
    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let (sheet_hex_a, _) = engine_a
        .create_default_sheet("Sheet1")
        .expect("engine A default sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_hex_a).unwrap();

    let (mut engine_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let (sheet_hex_b, _) = engine_b
        .create_default_sheet("Sheet1")
        .expect("engine B default sheet");
    assert_eq!(
        sheet_hex_a, sheet_hex_b,
        "deterministic default SheetIds can still refer to different Yrs map objects",
    );

    engine_a
        .set_cell_value_as_text(&sheet_id, 0, 0, "from-a")
        .expect("engine A set A1");
    engine_b
        .set_cell_value_as_text(&sheet_id, 0, 1, "from-b")
        .expect("engine B set B1");

    // This invalid setup independently creates sheetOrder, the sheet map,
    // grid index, row/column arrays, and child maps under the same workbook
    // keys. State-vector exchange converges the CRDT document, but it cannot
    // deep-merge two separately-created nested sheet maps into one sheet.
    for _ in 0..3 {
        sync_bidirectional(&mut engine_a, &mut engine_b);
    }

    let a_visible = (
        engine_a.get_cell_value(&sheet_id, 0, 0),
        engine_a.get_cell_value(&sheet_id, 0, 1),
    );
    let b_visible = (
        engine_b.get_cell_value(&sheet_id, 0, 0),
        engine_b.get_cell_value(&sheet_id, 0, 1),
    );
    assert_eq!(
        a_visible, b_visible,
        "independent bootstrap peers must converge to the same visible state",
    );

    let has_a_marker =
        matches!(&b_visible.0, value_types::CellValue::Text(s) if s.as_ref() == "from-a");
    let has_b_marker =
        matches!(&b_visible.1, value_types::CellValue::Text(s) if s.as_ref() == "from-b");
    assert!(
        !(has_a_marker && has_b_marker),
        "independent default-sheet bootstraps must not be treated as a deep merge; visible state was {b_visible:?}",
    );
}

// ===================================================================
// Sync MutationResult propagation tests
//
// These tests verify that `rebuild_from_yrs_after_sync` populates the
// expected MutationResult fields when a remote peer's changes are applied
// via `apply_sync_update`. Collaboration-shaped tests use the two-engine
// pattern:
//   1. Engines A and B fork from one authoritative Yrs baseline
//   2. Engine A performs a mutation
//   3. Encode A→B diff via state vectors
//   4. Engine B applies the sync update
//   5. Assert the returned MutationResult contains the expected change shape
// ===================================================================

/// Helper: fork two engines from the same authoritative default sheet, sync A→B,
/// and return (engine_b, sheet_id, mutation_result).
fn sync_a_to_b<F>(mutate_a: F) -> (YrsComputeEngine, SheetId, MutationResult)
where
    F: FnOnce(&mut YrsComputeEngine, &SheetId),
{
    let (room_state, sheet_id) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    // Engine A performs the mutation
    mutate_a(&mut engine_a, &sheet_id);

    // Encode A→B diff and apply
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    (engine_b, sheet_id, result)
}

// -------------------------------------------------------------------
// Category 1: Sheet create
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_create() {
    let (room_state, _) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    // Engine A creates a second sheet
    let (new_sheet_hex, _) = engine_a.create_sheet("Sheet2").unwrap();
    let new_sheet_id = SheetId::from_uuid_str(&new_sheet_hex).unwrap();

    // Sync A→B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_sheet_change(
        &result,
        &new_sheet_id,
        SheetChangeField::Sheet,
        ChangeKind::Set,
    );
    // Verify the new sheet is actually visible
    let all_sheets = engine_b.get_all_sheet_ids();
    assert_eq!(all_sheets.len(), 2, "engine B must see 2 sheets after sync");
    assert!(
        all_sheets.contains(&new_sheet_hex),
        "engine B must see the new sheet ID"
    );
}

// -------------------------------------------------------------------
// Category 2: Sheet delete
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_delete() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let (_, _) = baseline.create_sheet("Sheet2").unwrap();
    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    assert_eq!(engine_b.get_all_sheet_ids().len(), 2);

    // Engine A deletes Sheet1
    engine_a.delete_sheet(&sheet_id).unwrap();

    // Sync A→B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::Sheet,
        ChangeKind::Removed,
    );
    assert_eq!(
        engine_b.get_all_sheet_ids().len(),
        1,
        "engine B must have 1 sheet after sync delete"
    );
}

// -------------------------------------------------------------------
// Category 3: Sheet rename
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_rename() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .rename_compute_sheet(sheet_id, "RenamedSheet")
            .unwrap();
    });

    assert_sheet_change(&result, &sheet_id, SheetChangeField::Name, ChangeKind::Set);
}

// -------------------------------------------------------------------
// Category 4: Sheet reorder
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_reorder() {
    let (room_state, sheet1_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let (sheet2_hex, _) = baseline.create_sheet("Sheet2").unwrap();
    let sheet1_hex = sheet1_id.to_uuid_string();
    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    // Engine A reorders sheets
    engine_a
        .reorder_sheets(vec![sheet2_hex.clone(), sheet1_hex.clone()])
        .unwrap();

    // Sync A→B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        result.sheet_changes.iter().any(|change| change.field == SheetChangeField::Order && change.kind == ChangeKind::Set),
        "sync must propagate sheet_reorder in MutationResult.sheet_changes; got {:?}",
        result.sheet_changes,
    );
}

// -------------------------------------------------------------------
// Category 6: Sheet hide/unhide
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_hidden() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_sheet_hidden(sheet_id, true).unwrap();
    });

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::Visibility,
        ChangeKind::Set,
    );
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == sheet_id.to_uuid_string()
                && change.hidden == Some(true)),
        "sheet hidden payload must be true; got {:?}",
        result.sheet_changes,
    );
}

// -------------------------------------------------------------------
// Category 7: Sheet tab color
// -------------------------------------------------------------------

#[test]
fn sync_propagates_tab_color() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .set_tab_color(sheet_id, Some("#FF0000".to_string()))
            .unwrap();
    });

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::TabColor,
        ChangeKind::Set,
    );
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == sheet_id.to_uuid_string()
                && change.color.as_deref() == Some("#FF0000")),
        "tab color payload must be #FF0000; got {:?}",
        result.sheet_changes,
    );
}

// -------------------------------------------------------------------
// Category 8: Freeze panes
// -------------------------------------------------------------------

#[test]
fn sync_propagates_freeze_panes() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_frozen_panes(sheet_id, 2, 1).unwrap();
    });

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::Frozen,
        ChangeKind::Set,
    );
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == sheet_id.to_uuid_string()
                && change.frozen_rows == Some(2)
                && change.frozen_cols == Some(1)),
        "freeze panes payload must be rows=2 cols=1; got {:?}",
        result.sheet_changes,
    );
}

// -------------------------------------------------------------------
// Category 11: Row height
// -------------------------------------------------------------------

#[test]
fn sync_propagates_row_height() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_row_height(sheet_id, 0, 40.0).unwrap();
    });

    assert!(
        result.dimension_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Row
                && change.index == 0
                && change.kind == ChangeKind::Set
                && change.size.is_some()
        }),
        "sync must propagate set_row_height in MutationResult.dimension_changes; got {:?}",
        result.dimension_changes,
    );
}

// -------------------------------------------------------------------
// Category 12: Column width
// -------------------------------------------------------------------

#[test]
fn sync_propagates_col_width() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_col_width(sheet_id, 0, 120.0).unwrap();
    });

    assert!(
        result.dimension_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Col
                && change.index == 0
                && change.kind == ChangeKind::Set
                && change.size.is_some()
        }),
        "sync must propagate set_col_width in MutationResult.dimension_changes; got {:?}",
        result.dimension_changes,
    );
}

// -------------------------------------------------------------------
// Category 13: Row insert (structure change)
// -------------------------------------------------------------------

#[test]
fn sync_propagates_row_insert() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .structure_change(
                sheet_id,
                &formula_types::StructureChange::InsertRows {
                    at: 0,
                    count: 2,
                    new_row_ids: vec![],
                },
            )
            .unwrap();
    });

    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::InsertRows)
                && change.count == 2
        }),
        "sync must propagate row insert in MutationResult.structure_changes; got {:?}",
        result.structure_changes,
    );
}

// -------------------------------------------------------------------
// Category 14: Column delete (structure change)
// -------------------------------------------------------------------

#[test]
fn sync_propagates_col_delete() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .structure_change(
                sheet_id,
                &formula_types::StructureChange::DeleteCols {
                    at: 0,
                    count: 1,
                    deleted_cell_ids: vec![],
                },
            )
            .unwrap();
    });

    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::DeleteCols)
                && change.count == 1
        }),
        "sync must propagate col delete in MutationResult.structure_changes; got {:?}",
        result.structure_changes,
    );
}

// -------------------------------------------------------------------
// Category 15: Hide rows
// -------------------------------------------------------------------

#[test]
fn sync_propagates_hide_rows() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.hide_rows(sheet_id, &[0, 1]).unwrap();
    });

    assert!(
        result.visibility_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Row
                && change.index == 0
                && change.hidden
        }),
        "sync must propagate hide_rows in MutationResult.visibility_changes; got {:?}",
        result.visibility_changes,
    );
}

// -------------------------------------------------------------------
// Category 16: Hide columns
// -------------------------------------------------------------------

#[test]
fn sync_propagates_hide_columns() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.hide_columns(sheet_id, &[0]).unwrap();
    });

    assert!(
        result.visibility_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Col
                && change.index == 0
                && change.hidden
        }),
        "sync must propagate hide_columns in MutationResult.visibility_changes; got {:?}",
        result.visibility_changes,
    );
}

// -------------------------------------------------------------------
// Category 17: Merge cells
// -------------------------------------------------------------------

#[test]
fn sync_propagates_merge() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.merge_range(sheet_id, 0, 0, 1, 1).unwrap();
    });

    assert!(
        result.merge_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.kind == ChangeKind::Set
                && change.start_row == 0
                && change.start_col == 0
                && change.end_row == 1
                && change.end_col == 1
        }),
        "sync must propagate merge_range in MutationResult.merge_changes; got {:?}",
        result.merge_changes,
    );
}

// -------------------------------------------------------------------
// Category 18: Unmerge cells
// -------------------------------------------------------------------

#[test]
fn sync_propagates_unmerge() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    baseline.merge_range(&sheet_id, 0, 0, 1, 1).unwrap();
    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    // Now unmerge on A
    engine_a.unmerge_range(&sheet_id, 0, 0, 1, 1).unwrap();

    // Sync unmerge A→B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        result.merge_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.kind == ChangeKind::Removed
                && change.start_row == 0
                && change.start_col == 0
                && change.end_row == 1
                && change.end_col == 1
        }),
        "sync must propagate unmerge_range in MutationResult.merge_changes; got {:?}",
        result.merge_changes,
    );
}

// -------------------------------------------------------------------
// Category 19: Comments
// -------------------------------------------------------------------

#[test]
fn sync_propagates_comment() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .add_comment_by_position(
                sheet_id,
                0,
                0,
                "Hello from peer",
                "Alice",
                None,
                None,
                CommentType::Note,
            )
            .unwrap();
    });

    assert!(
        result.comment_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.kind == ChangeKind::Set
                && matches!(&change.position, Some(pos) if pos.row == 0 && pos.col == 0)
        }),
        "sync must propagate add_comment in MutationResult.comment_changes; got {:?}",
        result.comment_changes,
    );
}

// -------------------------------------------------------------------
// Category 29: Sheet settings
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_settings() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .set_sheet_setting(sheet_id, "showGridLines", "false")
            .unwrap();
    });

    assert!(
        result.settings_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string() && change.kind == ChangeKind::Set
        }),
        "sync must propagate set_sheet_setting in MutationResult.settings_changes; got {:?}",
        result.settings_changes,
    );
}

// -------------------------------------------------------------------
// Category 30: Workbook settings
// -------------------------------------------------------------------

#[test]
fn sync_propagates_workbook_settings() {
    let (room_state, _) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    // Engine A changes a workbook setting
    engine_a
        .set_workbook_setting("iterativeCalc", serde_json::json!(true))
        .unwrap();

    // Sync A→B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        result
            .workbook_settings_changes
            .iter()
            .any(|change| change.kind == ChangeKind::Set && !change.changed_keys.is_empty()),
        "sync must propagate set_workbook_setting in MutationResult.workbook_settings_changes; got {:?}",
        result.workbook_settings_changes,
    );
}

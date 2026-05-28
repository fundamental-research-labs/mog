//! Provider replay regression coverage for sync updates.

use super::super::*;
use super::sync_helpers::*;
use snapshot_types::WorkbookSnapshot;

#[test]
fn provider_refresh_replay_round_trip_through_engine() {
    // -------------------------------------------------
    // Session A: blank -> default-sheet bootstrap -> edit
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
    // Session B: blank -> apply_sync_update (Provider replay) -> check sheets
    // -------------------------------------------------
    let (mut engine_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();

    // Pre-attach: session B has NO sheets yet. This matches the ordering
    // where Provider attach defers default-sheet creation until after replay.
    assert_eq!(
        engine_b.get_all_sheet_ids().len(),
        0,
        "session B pre-replay: no sheets yet (default-sheet bootstrap deferred)",
    );

    // Apply session A's full-state bytes through the production sync path.
    engine_b
        .apply_sync_update(&persisted_bytes)
        .expect("session B apply_sync_update must succeed");

    // Post-attach: lifecycle reads `get_all_sheet_ids()` to decide
    // whether to create the default sheet.
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

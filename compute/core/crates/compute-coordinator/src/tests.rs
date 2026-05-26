use crate::{LockError, LockScope, PushError, SyncCoordinator, SyncError};
use cell_types::SheetId;
use std::time::Duration;
use uuid::Uuid;
use yrs::{Array, Doc, Map, MapRef, Transact};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a coordinator and join a participant, returning both.
fn join(coord: &mut SyncCoordinator, name: &str) -> crate::JoinResult {
    coord.join(name.to_string())
}

/// Create a client Doc hydrated from a JoinResult.
fn client_doc_from_join(jr: &crate::JoinResult) -> Doc {
    let doc = Doc::new();
    compute_collab::apply_update(&doc, &jr.full_state).unwrap();
    doc
}

/// Insert a key-value pair into a named map on the given doc.
fn insert_into_map(doc: &Doc, map_name: &str, key: &str, value: &str) {
    let map: MapRef = doc.get_or_insert_map(map_name);
    let mut txn = doc.transact_mut();
    map.insert(&mut txn, key, value);
}

/// Read a key from a named map on the given doc.
fn read_map_key(doc: &Doc, map_name: &str, key: &str) -> Option<String> {
    let map: MapRef = doc.get_or_insert_map(map_name);
    let txn = doc.transact();
    map.get(&txn, key).map(|v| v.to_string(&txn))
}

/// Push a client doc's changes to the coordinator.
/// Returns the PushResult on success.
fn do_push(
    coord: &mut SyncCoordinator,
    participant: &str,
    client_doc: &Doc,
    touched_sheets: &[SheetId],
) -> Result<crate::PushResult, PushError> {
    let sv = compute_collab::encode_state_vector(client_doc);
    let server_sv = coord.state_vector();
    let diff = compute_collab::encode_diff(client_doc, &server_sv).unwrap();
    coord.push(&participant.to_string(), &diff, touched_sheets, &sv)
}

/// Pull from the coordinator into a client doc.
fn do_pull(coord: &SyncCoordinator, participant: &str, client_doc: &Doc) {
    let sv = compute_collab::encode_state_vector(client_doc);
    let diff = coord.pull(&participant.to_string(), &sv).unwrap();
    compute_collab::apply_update(client_doc, &diff).unwrap();
}

// ===========================================================================
// Participant lifecycle
// ===========================================================================

#[test]
fn join_returns_empty_state() {
    let mut coord = SyncCoordinator::new();
    let jr = join(&mut coord, "alice");

    // full_state should be valid (can be applied to a fresh doc without error)
    let doc = Doc::new();
    compute_collab::apply_update(&doc, &jr.full_state).unwrap();

    assert!(jr.active_locks.is_empty());
    assert_eq!(jr.participant_count, 1);
}

#[test]
fn join_returns_existing_state() {
    let mut coord = SyncCoordinator::new();

    // Alice joins and makes edits
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    insert_into_map(&doc_a, "data", "greeting", "hello");
    let push_result = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &push_result.server_diff).unwrap();

    // Bob joins and should see Alice's edits
    let jr_b = join(&mut coord, "bob");
    assert_eq!(jr_b.participant_count, 2);

    let doc_b = client_doc_from_join(&jr_b);
    assert_eq!(
        read_map_key(&doc_b, "data", "greeting").as_deref(),
        Some("hello")
    );
}

#[test]
fn leave_removes_participant() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    assert_eq!(coord.participant_count(), 1);

    coord.leave(&"alice".to_string());
    assert_eq!(coord.participant_count(), 0);
}

#[test]
fn leave_releases_locks() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();
    assert_eq!(coord.active_locks().len(), 1);

    coord.leave(&"alice".to_string());
    assert_eq!(coord.active_locks().len(), 0);
}

// ===========================================================================
// Bidirectional sync
// ===========================================================================

#[test]
fn two_participants_sync() {
    let mut coord = SyncCoordinator::new();

    // Alice joins, edits, pushes
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    insert_into_map(&doc_a, "sheet", "A1", "42");
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob joins, pulls
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Bob should already have Alice's data from the join full_state
    assert_eq!(read_map_key(&doc_b, "sheet", "A1").as_deref(), Some("42"));
}

#[test]
fn bidirectional_sync() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Alice edits and pushes
    insert_into_map(&doc_a, "sheet", "A1", "alice_val");
    let pr_a = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr_a.server_diff).unwrap();

    // Bob edits and pushes
    insert_into_map(&doc_b, "sheet", "B1", "bob_val");
    let pr_b = do_push(&mut coord, "bob", &doc_b, &[]).unwrap();
    compute_collab::apply_update(&doc_b, &pr_b.server_diff).unwrap();

    // Alice pulls to get Bob's changes
    do_pull(&coord, "alice", &doc_a);

    // Both should see both values
    assert_eq!(
        read_map_key(&doc_a, "sheet", "A1").as_deref(),
        Some("alice_val")
    );
    assert_eq!(
        read_map_key(&doc_a, "sheet", "B1").as_deref(),
        Some("bob_val")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("alice_val")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "B1").as_deref(),
        Some("bob_val")
    );
}

#[test]
fn three_way_convergence() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);
    let jr_c = join(&mut coord, "carol");
    let doc_c = client_doc_from_join(&jr_c);

    // Each participant edits a different key
    insert_into_map(&doc_a, "sheet", "A1", "from_alice");
    insert_into_map(&doc_b, "sheet", "B1", "from_bob");
    insert_into_map(&doc_c, "sheet", "C1", "from_carol");

    // All push
    let pr_a = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr_a.server_diff).unwrap();
    let pr_b = do_push(&mut coord, "bob", &doc_b, &[]).unwrap();
    compute_collab::apply_update(&doc_b, &pr_b.server_diff).unwrap();
    let pr_c = do_push(&mut coord, "carol", &doc_c, &[]).unwrap();
    compute_collab::apply_update(&doc_c, &pr_c.server_diff).unwrap();

    // All pull to converge
    do_pull(&coord, "alice", &doc_a);
    do_pull(&coord, "bob", &doc_b);
    do_pull(&coord, "carol", &doc_c);

    // Verify convergence: all three see all three values
    for (name, doc) in [("alice", &doc_a), ("bob", &doc_b), ("carol", &doc_c)] {
        assert_eq!(
            read_map_key(doc, "sheet", "A1").as_deref(),
            Some("from_alice"),
            "{name} missing A1"
        );
        assert_eq!(
            read_map_key(doc, "sheet", "B1").as_deref(),
            Some("from_bob"),
            "{name} missing B1"
        );
        assert_eq!(
            read_map_key(doc, "sheet", "C1").as_deref(),
            Some("from_carol"),
            "{name} missing C1"
        );
    }
}

#[test]
fn push_returns_server_diff() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Alice pushes first
    insert_into_map(&doc_a, "sheet", "A1", "alice_data");
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob pushes -- the server_diff should contain Alice's changes
    insert_into_map(&doc_b, "sheet", "B1", "bob_data");
    let pr_b = do_push(&mut coord, "bob", &doc_b, &[]).unwrap();

    // Apply server_diff to Bob's doc
    compute_collab::apply_update(&doc_b, &pr_b.server_diff).unwrap();

    // Bob should now see Alice's data via the server_diff
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("alice_data")
    );
}

// ===========================================================================
// Lock enforcement
// ===========================================================================

#[test]
fn lock_acquire_release() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    let lock_id = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    assert_eq!(coord.active_locks().len(), 1);
    assert_eq!(coord.active_locks()[0].id, lock_id);

    coord.release_lock(&"alice".to_string(), &lock_id).unwrap();
    assert_eq!(coord.active_locks().len(), 0);
}

#[test]
fn lock_prevents_push() {
    let mut coord = SyncCoordinator::new();

    join(&mut coord, "alice");
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    let sheet1 = SheetId::from_raw(1);

    // Alice locks sheet1
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    // Bob tries to push touching sheet1 -> should fail
    insert_into_map(&doc_b, "sheet", "A1", "blocked");
    let result = do_push(&mut coord, "bob", &doc_b, &[sheet1]);
    assert!(
        matches!(result, Err(PushError::LockViolation(_))),
        "expected LockViolation, got: {result:?}"
    );
}

#[test]
fn lock_allows_owner() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    let sheet1 = SheetId::from_raw(1);
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    // Alice pushes to her own locked sheet -> should succeed
    insert_into_map(&doc_a, "sheet", "A1", "allowed");
    let result = do_push(&mut coord, "alice", &doc_a, &[sheet1]);
    assert!(result.is_ok(), "owner should be able to push to own lock");
}

#[test]
fn lock_different_sheets() {
    let mut coord = SyncCoordinator::new();

    join(&mut coord, "alice");
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    let sheet1 = SheetId::from_raw(1);
    let sheet2 = SheetId::from_raw(2);

    // Alice locks sheet1
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    // Bob edits sheet2 -> should succeed
    insert_into_map(&doc_b, "sheet2", "A1", "ok");
    let result = do_push(&mut coord, "bob", &doc_b, &[sheet2]);
    assert!(
        result.is_ok(),
        "editing a different sheet should succeed: {result:?}"
    );
}

#[test]
fn workbook_lock_blocks_all() {
    let mut coord = SyncCoordinator::new();

    join(&mut coord, "alice");
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Alice acquires workbook lock
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Workbook,
            Duration::from_secs(60),
        )
        .unwrap();

    let sheet2 = SheetId::from_raw(2);

    // Bob tries to push anything -> blocked
    insert_into_map(&doc_b, "sheet", "A1", "blocked");
    let result = do_push(&mut coord, "bob", &doc_b, &[sheet2]);
    assert!(
        matches!(result, Err(PushError::LockViolation(_))),
        "workbook lock should block all other participants"
    );
}

#[test]
fn lock_conflict_on_acquire() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    join(&mut coord, "bob");

    let sheet1 = SheetId::from_raw(1);

    // Alice locks sheet1
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    // Bob tries to lock same sheet -> conflict
    let result = coord.acquire_lock(
        &"bob".to_string(),
        LockScope::Sheet { sheet_id: sheet1 },
        Duration::from_secs(60),
    );
    assert!(
        matches!(result, Err(LockError::LockConflict(_))),
        "expected LockConflict, got: {result:?}"
    );
}

#[test]
fn lock_expiry() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);

    // Acquire with zero TTL (already expired by the time we check)
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_millis(0),
        )
        .unwrap();
    assert_eq!(coord.active_locks().len(), 1);

    // Small sleep to ensure the instant has passed
    std::thread::sleep(Duration::from_millis(5));

    let expired = coord.expire_locks();
    assert_eq!(expired.len(), 1);
    assert_eq!(coord.active_locks().len(), 0);
}

// ===========================================================================
// Error handling
// ===========================================================================

#[test]
fn push_unknown_participant() {
    let mut coord = SyncCoordinator::new();
    let doc = Doc::new();

    let result = do_push(&mut coord, "ghost", &doc, &[]);
    assert!(
        matches!(result, Err(PushError::UnknownParticipant)),
        "expected UnknownParticipant, got: {result:?}"
    );
}

#[test]
fn pull_unknown_participant() {
    let coord = SyncCoordinator::new();
    let doc = Doc::new();
    let sv = compute_collab::encode_state_vector(&doc);

    let result = coord.pull(&"ghost".to_string(), &sv);
    assert!(
        matches!(result, Err(SyncError::UnknownParticipant)),
        "expected UnknownParticipant, got: {result:?}"
    );
}

#[test]
fn lock_unknown_participant() {
    let mut coord = SyncCoordinator::new();
    let sheet1 = SheetId::from_raw(1);

    let result = coord.acquire_lock(
        &"ghost".to_string(),
        LockScope::Sheet { sheet_id: sheet1 },
        Duration::from_secs(60),
    );
    assert!(
        matches!(result, Err(LockError::UnknownParticipant)),
        "expected UnknownParticipant, got: {result:?}"
    );
}

// ===========================================================================
// Structural locks
// ===========================================================================

#[test]
fn structural_lock_acquire_release() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    let lock_id = coord
        .acquire_structural_lock(&"alice".to_string(), sheet1, Duration::from_secs(60))
        .unwrap();

    assert_eq!(coord.active_locks().len(), 1);

    coord
        .release_structural_lock(&"alice".to_string(), &lock_id)
        .unwrap();
    assert_eq!(coord.active_locks().len(), 0);
}

#[test]
fn structural_lock_conflicts_same_sheet() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    join(&mut coord, "bob");

    let sheet1 = SheetId::from_raw(1);

    // Alice acquires structural lock
    coord
        .acquire_structural_lock(&"alice".to_string(), sheet1, Duration::from_secs(60))
        .unwrap();

    // Bob tries to acquire structural lock on same sheet -> conflict
    let result = coord.acquire_structural_lock(&"bob".to_string(), sheet1, Duration::from_secs(60));
    assert!(
        matches!(result, Err(LockError::LockConflict(_))),
        "expected LockConflict, got: {result:?}"
    );
}

#[test]
fn structural_lock_different_sheets_ok() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    join(&mut coord, "bob");

    let sheet1 = SheetId::from_raw(1);
    let sheet2 = SheetId::from_raw(2);

    // Alice locks sheet1 structurally
    coord
        .acquire_structural_lock(&"alice".to_string(), sheet1, Duration::from_secs(60))
        .unwrap();

    // Bob locks sheet2 structurally -> should succeed
    let result = coord.acquire_structural_lock(&"bob".to_string(), sheet2, Duration::from_secs(60));
    assert!(result.is_ok(), "different sheets should not conflict");
}

#[test]
fn structural_lock_does_not_block_push() {
    let mut coord = SyncCoordinator::new();

    join(&mut coord, "alice");
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    let sheet1 = SheetId::from_raw(1);

    // Alice holds a structural lock on sheet1
    coord
        .acquire_structural_lock(&"alice".to_string(), sheet1, Duration::from_secs(60))
        .unwrap();

    // Bob pushes normal cell edits touching sheet1 -> should succeed
    // (structural locks only serialize structural ops, not normal edits)
    insert_into_map(&doc_b, "sheet", "A1", "bob_edit");
    let result = do_push(&mut coord, "bob", &doc_b, &[sheet1]);
    assert!(
        result.is_ok(),
        "structural lock should not block normal cell edits: {result:?}"
    );
}

#[test]
fn structural_lock_does_not_conflict_with_sheet_lock() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    join(&mut coord, "bob");

    let sheet1 = SheetId::from_raw(1);

    // Alice holds a sheet lock
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    // Bob acquires a structural lock on the same sheet -> should succeed
    // (they are orthogonal lock types)
    let result = coord.acquire_structural_lock(&"bob".to_string(), sheet1, Duration::from_secs(60));
    assert!(
        result.is_ok(),
        "structural lock should not conflict with sheet lock: {result:?}"
    );
}

#[test]
fn structural_lock_released_on_leave() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    coord
        .acquire_structural_lock(&"alice".to_string(), sheet1, Duration::from_secs(60))
        .unwrap();
    assert_eq!(coord.active_locks().len(), 1);

    coord.leave(&"alice".to_string());
    assert_eq!(coord.active_locks().len(), 0);
}

// ===========================================================================
// State persistence
// ===========================================================================

#[test]
fn from_state_roundtrip() {
    // Create coordinator, make edits via push
    let mut coord1 = SyncCoordinator::new();
    let jr = join(&mut coord1, "alice");
    let doc_a = client_doc_from_join(&jr);
    insert_into_map(&doc_a, "data", "key1", "value1");
    insert_into_map(&doc_a, "data", "key2", "value2");
    let pr = do_push(&mut coord1, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr.server_diff).unwrap();

    // Encode full state and create new coordinator from it
    let state = coord1.full_state();
    let mut coord2 = SyncCoordinator::from_state(&state).unwrap();

    // Bob joins the new coordinator and should see the data
    let jr_b = join(&mut coord2, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    assert_eq!(
        read_map_key(&doc_b, "data", "key1").as_deref(),
        Some("value1")
    );
    assert_eq!(
        read_map_key(&doc_b, "data", "key2").as_deref(),
        Some("value2")
    );
}

// ===========================================================================
// Release lock error paths
// ===========================================================================

#[test]
fn release_lock_not_found() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let fake_id = Uuid::new_v4();
    let result = coord.release_lock(&"alice".to_string(), &fake_id);
    assert!(
        matches!(result, Err(LockError::LockNotFound)),
        "expected LockNotFound, got: {result:?}"
    );
}

#[test]
fn release_lock_not_owner() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    join(&mut coord, "bob");

    let sheet1 = SheetId::from_raw(1);
    let lock_id = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    let result = coord.release_lock(&"bob".to_string(), &lock_id);
    assert!(
        matches!(result, Err(LockError::NotOwner)),
        "expected NotOwner, got: {result:?}"
    );
}

#[test]
fn release_lock_unknown_participant() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    let lock_id = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    let result = coord.release_lock(&"ghost".to_string(), &lock_id);
    assert!(
        matches!(result, Err(LockError::UnknownParticipant)),
        "expected UnknownParticipant, got: {result:?}"
    );
}

// ===========================================================================
// Double join behavior
// ===========================================================================

#[test]
fn double_join_resets_state() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();
    assert_eq!(coord.active_locks().len(), 1);

    // Alice joins again — her prior locks should be released
    let jr = join(&mut coord, "alice");
    assert_eq!(
        coord.active_locks().len(),
        0,
        "double join should release prior locks"
    );
    assert_eq!(
        jr.participant_count, 1,
        "double join should not create a second participant"
    );
}

#[test]
fn double_join_preserves_document() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    insert_into_map(&doc_a, "data", "key", "value");
    let pr = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr.server_diff).unwrap();

    // Alice re-joins — the document state should still contain her data
    let jr2 = join(&mut coord, "alice");
    let doc_a2 = client_doc_from_join(&jr2);
    assert_eq!(
        read_map_key(&doc_a2, "data", "key").as_deref(),
        Some("value"),
        "double join should preserve previously pushed document data"
    );
}

// ===========================================================================
// Workbook lock semantics
// ===========================================================================

#[test]
fn workbook_lock_owner_can_push() {
    let mut coord = SyncCoordinator::new();
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Workbook,
            Duration::from_secs(60),
        )
        .unwrap();

    let sheet1 = SheetId::from_raw(1);
    insert_into_map(&doc_a, "sheet", "A1", "data");
    let result = do_push(&mut coord, "alice", &doc_a, &[sheet1]);
    assert!(
        result.is_ok(),
        "workbook lock owner should be able to push: {result:?}"
    );
}

#[test]
fn workbook_lock_blocks_empty_touched_sheets() {
    // From first principles: a push with no touched_sheets means no sheet
    // modifications. A workbook lock should only block sheet-modifying pushes
    // from non-owners, so an empty touched_sheets push should pass.
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Workbook,
            Duration::from_secs(60),
        )
        .unwrap();

    // Bob pushes with empty touched_sheets — should succeed since no sheets are modified
    insert_into_map(&doc_b, "meta", "cursor", "B1");
    let result = do_push(&mut coord, "bob", &doc_b, &[]);
    assert!(
        result.is_ok(),
        "push with empty touched_sheets should not be blocked by workbook lock: {result:?}"
    );
}

#[test]
fn sheet_lock_after_workbook_lock_fails() {
    // Workbook lock is exclusive — even the same owner should not be able to
    // also acquire a sheet lock (it would be redundant and the workbook lock
    // conflicts with everything).
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Workbook,
            Duration::from_secs(60),
        )
        .unwrap();

    let sheet1 = SheetId::from_raw(1);
    let result = coord.acquire_lock(
        &"alice".to_string(),
        LockScope::Sheet { sheet_id: sheet1 },
        Duration::from_secs(60),
    );
    assert!(
        matches!(result, Err(LockError::LockConflict(_))),
        "sheet lock after workbook lock should conflict, got: {result:?}"
    );
}

#[test]
fn workbook_lock_after_sheet_lock_fails() {
    // If any lock exists, a workbook lock should conflict.
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();

    let result = coord.acquire_lock(
        &"alice".to_string(),
        LockScope::Workbook,
        Duration::from_secs(60),
    );
    assert!(
        matches!(result, Err(LockError::LockConflict(_))),
        "workbook lock after sheet lock should conflict, got: {result:?}"
    );
}

// ===========================================================================
// Lock count accuracy
// ===========================================================================

#[test]
fn lock_count_after_acquire_and_release() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let s1 = SheetId::from_raw(1);
    let s2 = SheetId::from_raw(2);
    let s3 = SheetId::from_raw(3);

    let id1 = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: s1 },
            Duration::from_secs(60),
        )
        .unwrap();
    let _id2 = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: s2 },
            Duration::from_secs(60),
        )
        .unwrap();
    let _id3 = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: s3 },
            Duration::from_secs(60),
        )
        .unwrap();
    assert_eq!(coord.active_locks().len(), 3);

    coord.release_lock(&"alice".to_string(), &id1).unwrap();
    assert_eq!(coord.active_locks().len(), 2);

    coord.release_all_locks(&"alice".to_string());
    assert_eq!(coord.active_locks().len(), 0);
}

#[test]
fn lock_count_after_expire() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_millis(0),
        )
        .unwrap();
    assert_eq!(coord.active_locks().len(), 1);

    std::thread::sleep(Duration::from_millis(5));

    coord.expire_locks();
    assert_eq!(
        coord.active_locks().len(),
        0,
        "expired lock should be removed"
    );
}

// ===========================================================================
// Same-owner lock behavior
// ===========================================================================

#[test]
fn same_owner_multiple_sheets() {
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let s1 = SheetId::from_raw(1);
    let s2 = SheetId::from_raw(2);

    let r1 = coord.acquire_lock(
        &"alice".to_string(),
        LockScope::Sheet { sheet_id: s1 },
        Duration::from_secs(60),
    );
    assert!(r1.is_ok(), "alice should be able to lock sheet1");

    let r2 = coord.acquire_lock(
        &"alice".to_string(),
        LockScope::Sheet { sheet_id: s2 },
        Duration::from_secs(60),
    );
    assert!(
        r2.is_ok(),
        "alice should be able to lock sheet2 while holding sheet1"
    );
    assert_eq!(coord.active_locks().len(), 2);
}

#[test]
fn same_owner_same_sheet_is_idempotent() {
    // Acquiring the same lock twice should be idempotent: returns the existing
    // lock ID and refreshes the TTL. This makes retries safe and doubles as
    // lock renewal — the same pattern used by Redlock, etcd, and Chubby.
    let mut coord = SyncCoordinator::new();
    join(&mut coord, "alice");

    let sheet1 = SheetId::from_raw(1);
    let id1 = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(10),
        )
        .unwrap();

    // Re-acquire same scope with a longer TTL (renewal)
    let id2 = coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(120),
        )
        .unwrap();

    assert_eq!(id1, id2, "idempotent acquire should return same lock ID");
    assert_eq!(
        coord.active_locks().len(),
        1,
        "should not create duplicate lock"
    );
}

// ===========================================================================
// Push/pull edge cases
// ===========================================================================

#[test]
fn pull_when_up_to_date() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    insert_into_map(&doc_a, "sheet", "A1", "data");
    let pr = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr.server_diff).unwrap();

    // Pull when already up to date — applying the diff should not change data
    let sv = compute_collab::encode_state_vector(&doc_a);
    let diff = coord.pull(&"alice".to_string(), &sv).unwrap();
    let doc_before = client_doc_from_join(&jr_a);
    compute_collab::apply_update(&doc_before, &pr.server_diff).unwrap();

    // Apply the "empty" diff
    compute_collab::apply_update(&doc_a, &diff).unwrap();

    // Data should be unchanged
    assert_eq!(
        read_map_key(&doc_a, "sheet", "A1").as_deref(),
        Some("data"),
        "pulling when up to date should not change data"
    );
}

#[test]
fn push_empty_update() {
    let mut coord = SyncCoordinator::new();
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    // Push without making any changes — empty updates are valid in Yrs
    let result = do_push(&mut coord, "alice", &doc_a, &[]);
    assert!(
        result.is_ok(),
        "pushing an empty update should succeed: {result:?}"
    );
}

#[test]
fn multiple_sequential_pushes() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Push 1
    insert_into_map(&doc_a, "sheet", "A1", "first");
    let pr1 = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr1.server_diff).unwrap();
    do_pull(&coord, "bob", &doc_b);
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("first")
    );

    // Push 2
    insert_into_map(&doc_a, "sheet", "A2", "second");
    let pr2 = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr2.server_diff).unwrap();
    do_pull(&coord, "bob", &doc_b);
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("first")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A2").as_deref(),
        Some("second")
    );

    // Push 3
    insert_into_map(&doc_a, "sheet", "A3", "third");
    let pr3 = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr3.server_diff).unwrap();
    do_pull(&coord, "bob", &doc_b);
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("first")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A2").as_deref(),
        Some("second")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A3").as_deref(),
        Some("third")
    );
}

// ===========================================================================
// Leave edge cases
// ===========================================================================

#[test]
fn leave_when_not_joined() {
    let mut coord = SyncCoordinator::new();
    // Should be a no-op, not panic
    coord.leave(&"ghost".to_string());
    assert_eq!(coord.participant_count(), 0);
}

#[test]
fn leave_then_push_rejected() {
    let mut coord = SyncCoordinator::new();
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    coord.leave(&"alice".to_string());

    insert_into_map(&doc_a, "sheet", "A1", "late");
    let result = do_push(&mut coord, "alice", &doc_a, &[]);
    assert!(
        matches!(result, Err(PushError::UnknownParticipant)),
        "push after leave should return UnknownParticipant, got: {result:?}"
    );
}

// ===========================================================================
// Lock expiry unblocking
// ===========================================================================

#[test]
fn expired_lock_unblocks_after_expire_call() {
    let mut coord = SyncCoordinator::new();

    join(&mut coord, "alice");
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    let sheet1 = SheetId::from_raw(1);

    // Alice locks with 0ms TTL
    coord
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_millis(0),
        )
        .unwrap();

    std::thread::sleep(Duration::from_millis(5));

    // Bob tries to push to sheet1 — should still be blocked (expire not called yet)
    insert_into_map(&doc_b, "sheet", "A1", "blocked");
    let result1 = do_push(&mut coord, "bob", &doc_b, &[sheet1]);
    assert!(
        matches!(result1, Err(PushError::LockViolation(_))),
        "expired but not yet reaped lock should still block: {result1:?}"
    );

    // Now expire locks
    let expired = coord.expire_locks();
    assert_eq!(expired.len(), 1);

    // Bob pushes again — should succeed now
    let result2 = do_push(&mut coord, "bob", &doc_b, &[sheet1]);
    assert!(
        result2.is_ok(),
        "push should succeed after expired lock is reaped: {result2:?}"
    );
}

// ===========================================================================
// State persistence edge cases
// ===========================================================================

#[test]
fn from_state_does_not_preserve_locks() {
    let mut coord1 = SyncCoordinator::new();
    join(&mut coord1, "alice");

    let sheet1 = SheetId::from_raw(1);
    coord1
        .acquire_lock(
            &"alice".to_string(),
            LockScope::Sheet { sheet_id: sheet1 },
            Duration::from_secs(60),
        )
        .unwrap();
    assert_eq!(coord1.active_locks().len(), 1);

    // Create new coordinator from state — locks are session-scoped and should not survive
    let state = coord1.full_state();
    let coord2 = SyncCoordinator::from_state(&state).unwrap();
    assert_eq!(
        coord2.active_locks().len(),
        0,
        "locks should not survive from_state (they are session-scoped)"
    );
}

#[test]
fn from_state_does_not_preserve_participants() {
    let mut coord1 = SyncCoordinator::new();
    join(&mut coord1, "alice");
    join(&mut coord1, "bob");
    assert_eq!(coord1.participant_count(), 2);

    let state = coord1.full_state();
    let coord2 = SyncCoordinator::from_state(&state).unwrap();
    assert_eq!(
        coord2.participant_count(),
        0,
        "participants should not survive from_state (they are session-scoped)"
    );
}

// ===========================================================================
// YArray push_back sync (colOrder expansion bug)
// ===========================================================================

/// Helper: create a canonical schema on a client doc (simulates client-side init_canonical_schema).
/// Creates a sheets map with a single "Sheet1" containing a colOrder YArray with `num_cols` entries.
fn create_client_schema(doc: &Doc, num_cols: u32) {
    use yrs::ArrayPrelim;
    let sheets: MapRef = doc.get_or_insert_map("sheets");
    let mut txn = doc.transact_mut();
    let sheet_map = sheets.insert(&mut txn, "Sheet1", yrs::MapPrelim::default());
    let col_order = sheet_map.insert(&mut txn, "colOrder", ArrayPrelim::default());
    for i in 0..num_cols {
        col_order.push_back(&mut txn, format!("col_{}", i));
    }
}

/// Helper: get the coordinator's doc as a fresh Doc (since coord.doc is private).
fn coord_state_as_doc(coord: &SyncCoordinator) -> Doc {
    let doc = Doc::new();
    compute_collab::apply_update(&doc, &coord.full_state()).unwrap();
    doc
}

/// Helper: read the colOrder YArray length for the first sheet in a doc.
fn read_col_order_len(doc: &Doc) -> u32 {
    let sheets: MapRef = doc.get_or_insert_map("sheets");
    let txn = doc.transact();
    // Find the first sheet key
    for (key, value) in sheets.iter(&txn) {
        if let yrs::Out::YMap(sheet_map) = value {
            if let Some(yrs::Out::YArray(arr)) = sheet_map.get(&txn, "colOrder") {
                return arr.len(&txn);
            }
        }
        let _ = key; // use the first sheet
        break;
    }
    0
}

/// Helper: push_back a value to the colOrder YArray of the first sheet in a doc.
fn push_col_order(doc: &Doc, value: &str) {
    let sheets: MapRef = doc.get_or_insert_map("sheets");
    let mut txn = doc.transact_mut();
    for (_key, val) in sheets.iter(&txn) {
        if let yrs::Out::YMap(sheet_map) = val {
            if let Some(yrs::Out::YArray(arr)) = sheet_map.get(&txn, "colOrder") {
                arr.push_back(&mut txn, value);
                return;
            }
        }
        break;
    }
}

#[test]
fn col_order_push_back_syncs_to_coordinator() {
    // This test reproduces the AA+ column sync bug:
    // When an engine auto-expands colOrder (push_back to YArray),
    // does the expansion survive a push→pull cycle?
    //
    // The coordinator starts empty — the first client seeds the schema
    // (this matches production: init_canonical_schema runs client-side).

    let mut coord = SyncCoordinator::empty();

    // Coordinator starts empty — no schema pre-initialized
    let coord_doc_initial = coord_state_as_doc(&coord);
    let coord_cols_initial = read_col_order_len(&coord_doc_initial);
    assert_eq!(
        coord_cols_initial, 0,
        "coordinator should start empty (no pre-initialized schema)"
    );

    // Alice joins and gets the (empty) full state, then creates schema client-side
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    create_client_schema(&doc_a, 26);
    assert_eq!(
        read_col_order_len(&doc_a),
        26,
        "alice should start with 26 cols after client-side schema init"
    );

    // Alice pushes her schema to the coordinator (first client seeds it)
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Alice pushes back 2 new entries to colOrder (simulating auto-expansion to col 28)
    push_col_order(&doc_a, "new_col_26");
    push_col_order(&doc_a, "new_col_27");
    assert_eq!(
        read_col_order_len(&doc_a),
        28,
        "alice should now have 28 cols locally"
    );

    // Alice pushes to coordinator
    let push_result = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    assert!(
        push_result.server_diff.len() <= 2,
        "no server diff expected (alice is first)"
    );

    // Check coordinator's colOrder length (via full_state → fresh doc)
    let coord_doc_after = coord_state_as_doc(&coord);
    let coord_cols_after = read_col_order_len(&coord_doc_after);
    assert_eq!(
        coord_cols_after, 28,
        "coordinator should have 28 colOrder entries after alice's push, but got {}",
        coord_cols_after
    );

    // Bob joins and should see 28 columns
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);
    assert_eq!(
        read_col_order_len(&doc_b),
        28,
        "bob should see 28 cols after joining"
    );
}

#[test]
fn col_order_push_back_syncs_via_pull() {
    // Variant: alice pushes colOrder expansion, bob pulls it.
    // Coordinator starts empty — first client seeds schema.

    let mut coord = SyncCoordinator::empty();

    // Alice joins, creates schema client-side, and pushes to seed coordinator
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    create_client_schema(&doc_a, 26);
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob joins and gets the seeded schema from coordinator
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Both have 26 cols
    assert_eq!(read_col_order_len(&doc_a), 26);
    assert_eq!(read_col_order_len(&doc_b), 26);

    // Alice expands colOrder to 28
    push_col_order(&doc_a, "col_26");
    push_col_order(&doc_a, "col_27");
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob pulls
    do_pull(&coord, "bob", &doc_b);

    assert_eq!(
        read_col_order_len(&doc_b),
        28,
        "bob should have 28 cols after pulling alice's expansion"
    );
}

/// Minimal pure-Yrs test: push_back to a nested YArray, sync via diff.
/// No coordinator, no schema — just raw Yrs operations.
#[test]
fn yrs_nested_yarray_push_back_syncs() {
    use yrs::{ArrayPrelim, Map};

    // Doc A: create a map containing a YArray with 3 entries
    let doc_a = Doc::new();
    let root = doc_a.get_or_insert_map("root");
    {
        let mut txn = doc_a.transact_mut();
        let arr = root.insert(&mut txn, "arr", ArrayPrelim::default());
        arr.push_back(&mut txn, "a");
        arr.push_back(&mut txn, "b");
        arr.push_back(&mut txn, "c");
    }

    // Doc B: created from Doc A's state
    let sv_a = compute_collab::encode_full_state(&doc_a);
    let doc_b = Doc::new();
    compute_collab::apply_update(&doc_b, &sv_a).unwrap();

    // Verify Doc B has 3 entries
    {
        let root_b = doc_b.get_or_insert_map("root");
        let txn = doc_b.transact();
        let arr = root_b.get(&txn, "arr").unwrap();
        if let yrs::Out::YArray(arr) = arr {
            assert_eq!(arr.len(&txn), 3, "doc_b should have 3 entries");
        } else {
            panic!("expected YArray");
        }
    }

    // Doc B pushes back 2 new entries
    {
        let root_b = doc_b.get_or_insert_map("root");
        let mut txn = doc_b.transact_mut();
        let arr = root_b.get(&txn, "arr").unwrap();
        if let yrs::Out::YArray(arr) = arr {
            arr.push_back(&mut txn, "d");
            arr.push_back(&mut txn, "e");
        }
    }

    // Encode diff from Doc B vs Doc A's state vector
    let sv_a_vec = compute_collab::encode_state_vector(&doc_a);
    let diff = compute_collab::encode_diff(&doc_b, &sv_a_vec).unwrap();
    assert!(
        diff.len() > 2,
        "diff should be non-trivial: {} bytes",
        diff.len()
    );

    // Apply diff to Doc A
    compute_collab::apply_update(&doc_a, &diff).unwrap();

    // Doc A should now have 5 entries
    {
        let txn = doc_a.transact();
        let arr = root.get(&txn, "arr").unwrap();
        if let yrs::Out::YArray(arr) = arr {
            assert_eq!(
                arr.len(&txn),
                5,
                "doc_a should have 5 entries after applying doc_b's diff, got {}",
                arr.len(&txn)
            );
        }
    }
}

use super::fixtures::*;
use crate::{LockScope, PushError, SyncCoordinator};
use cell_types::SheetId;
use std::time::Duration;
use yrs::Doc;

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

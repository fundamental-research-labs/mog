use super::fixtures::*;
use crate::{LockScope, SyncCoordinator};
use cell_types::SheetId;
use std::time::Duration;

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

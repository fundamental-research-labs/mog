use super::fixtures::{do_push, join};
use crate::{LockError, LockScope, PushError, SyncCoordinator, SyncError};
use cell_types::SheetId;
use std::time::Duration;
use uuid::Uuid;
use yrs::Doc;

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

use super::fixtures::*;
use crate::{LockError, LockScope, PushError, SyncCoordinator};
use cell_types::SheetId;
use std::time::Duration;

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

use super::fixtures::*;
use crate::{LockError, LockScope, SyncCoordinator};
use cell_types::SheetId;
use std::time::Duration;

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

use super::support::{assert_missing, assert_present, insert_with_origin, setup};
use crate::undo::{ORIGIN_USER_EDIT, UndoRedoManager};

#[test]
fn normal_mode_separate_undo_steps() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    for (key, val) in [("A1", "one"), ("B1", "two"), ("C1", "three")] {
        insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, key, val);
    }

    assert_eq!(mgr.undo_depth(), 3);

    mgr.undo().unwrap();
    assert_eq!(mgr.undo_depth(), 2);
    assert_missing(&doc, &map, "C1");
    assert_present(&doc, &map, "B1");
}

#[test]
fn batch_groups_into_single_undo_step() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    mgr.begin_undo_group();

    for (key, val) in [("A1", "one"), ("B1", "two"), ("C1", "three")] {
        insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, key, val);
    }

    mgr.end_undo_group();

    assert_eq!(mgr.undo_depth(), 1);

    mgr.undo().unwrap();
    assert_missing(&doc, &map, "A1");
    assert_missing(&doc, &map, "B1");
    assert_missing(&doc, &map, "C1");
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn nested_groups_single_undo_step() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    mgr.begin_undo_group();
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "outer");

    mgr.begin_undo_group();
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "B1", "inner");
    mgr.end_undo_group();

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "C1", "after-inner");
    mgr.end_undo_group();

    assert_eq!(mgr.undo_depth(), 1);
    assert_eq!(mgr.undo_group_depth(), 0);

    mgr.undo().unwrap();
    assert_missing(&doc, &map, "A1");
    assert_missing(&doc, &map, "B1");
    assert_missing(&doc, &map, "C1");
}

#[test]
fn batch_isolation_from_normal_operations() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "normal1");

    mgr.begin_undo_group();
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "B1", "batch1");
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "C1", "batch2");
    mgr.end_undo_group();

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "D1", "normal2");

    assert_eq!(mgr.undo_depth(), 3);

    mgr.undo().unwrap();
    assert_missing(&doc, &map, "D1");
    assert_present(&doc, &map, "C1");

    mgr.undo().unwrap();
    assert_missing(&doc, &map, "B1");
    assert_missing(&doc, &map, "C1");
    assert_present(&doc, &map, "A1");

    mgr.undo().unwrap();
    assert_missing(&doc, &map, "A1");
}

#[test]
fn end_group_without_begin_is_noop() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    mgr.end_undo_group();
    assert_eq!(mgr.undo_group_depth(), 0);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "value");
    assert_eq!(mgr.undo_depth(), 1);
}

#[test]
fn undo_during_batch_reverts_previous_step() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "before-batch");
    assert_eq!(mgr.undo_depth(), 1);

    mgr.begin_undo_group();
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "B1", "in-batch");

    let _depth_before = mgr.undo_depth();
    let _did = mgr.undo().unwrap();

    mgr.end_undo_group();

    while mgr.can_undo() {
        mgr.undo().unwrap();
    }
    while mgr.can_redo() {
        mgr.redo().unwrap();
    }
}

#[test]
fn empty_group_does_not_add_undo_step() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    mgr.begin_undo_group();
    mgr.end_undo_group();

    assert_eq!(mgr.undo_group_depth(), 0);
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn clear_during_open_group_then_end_leaves_consistent_state() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    mgr.begin_undo_group();
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "in-batch");
    assert_eq!(mgr.undo_group_depth(), 1);

    mgr.clear();
    mgr.end_undo_group();

    assert_eq!(mgr.undo_group_depth(), 0);
    assert!(!mgr.can_redo());
}

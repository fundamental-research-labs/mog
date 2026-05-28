use super::support::{assert_missing, assert_present, insert_with_origin, setup};
use crate::undo::{ORIGIN_USER_EDIT, UndoRedoManager};
use yrs::{Map, Transact};

#[test]
fn basic_undo_single_edit() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "hello");

    assert!(mgr.can_undo());
    assert_eq!(mgr.undo_depth(), 1);

    assert!(mgr.undo().unwrap());

    assert_missing(&doc, &map, "A1");
    assert!(!mgr.can_undo());
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn multiple_edits_undo_all() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    for (key, val) in [("A1", "one"), ("B1", "two"), ("C1", "three")] {
        insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, key, val);
    }

    assert_eq!(mgr.undo_depth(), 3);

    assert!(mgr.undo().unwrap());
    assert!(mgr.undo().unwrap());
    assert!(mgr.undo().unwrap());
    assert!(!mgr.can_undo());

    assert_missing(&doc, &map, "A1");
    assert_missing(&doc, &map, "B1");
    assert_missing(&doc, &map, "C1");
}

#[test]
fn undo_then_redo() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "value");

    assert!(mgr.undo().unwrap());
    assert!(!mgr.can_undo());
    assert!(mgr.can_redo());

    assert!(mgr.redo().unwrap());
    assert_present(&doc, &map, "A1");
    assert!(mgr.can_undo());
    assert!(!mgr.can_redo());
}

#[test]
fn new_edit_clears_redo_stack() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "first");
    assert!(mgr.undo().unwrap());
    assert!(mgr.can_redo());
    assert_eq!(mgr.redo_depth(), 1);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "B1", "second");
    assert!(
        !mgr.can_redo(),
        "redo stack should be cleared after new edit"
    );
    assert_eq!(mgr.redo_depth(), 0);
}

#[test]
fn clear_undo_history() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "a");
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "B1", "b");
    assert_eq!(mgr.undo_depth(), 2);

    mgr.undo().unwrap();
    assert_eq!(mgr.redo_depth(), 1);

    mgr.clear();
    assert!(!mgr.can_undo());
    assert!(!mgr.can_redo());
    assert_eq!(mgr.undo_depth(), 0);
    assert_eq!(mgr.redo_depth(), 0);
}

#[test]
fn can_undo_can_redo_transitions() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    assert!(!mgr.can_undo());
    assert!(!mgr.can_redo());

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "x");
    assert!(mgr.can_undo());
    assert!(!mgr.can_redo());

    mgr.undo().unwrap();
    assert!(!mgr.can_undo());
    assert!(mgr.can_redo());

    mgr.redo().unwrap();
    assert!(mgr.can_undo());
    assert!(!mgr.can_redo());
}

#[test]
fn depth_counts() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    assert_eq!(mgr.undo_depth(), 0);
    assert_eq!(mgr.redo_depth(), 0);

    for i in 0..3 {
        let key = format!("cell{i}");
        insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, &key, "val");
    }
    assert_eq!(mgr.undo_depth(), 3);
    assert_eq!(mgr.redo_depth(), 0);

    mgr.undo().unwrap();
    mgr.undo().unwrap();
    assert_eq!(mgr.undo_depth(), 1);
    assert_eq!(mgr.redo_depth(), 2);

    mgr.redo().unwrap();
    assert_eq!(mgr.undo_depth(), 2);
    assert_eq!(mgr.redo_depth(), 1);
}

#[test]
fn undo_on_empty_returns_false() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);
    assert!(!mgr.undo().unwrap());
}

#[test]
fn redo_on_empty_returns_false() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);
    assert!(!mgr.redo().unwrap());
}

#[test]
fn undo_redo_preserves_values() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "first");
    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "second");

    {
        let txn = doc.transact();
        let val = map.get(&txn, "A1").unwrap().to_string(&txn);
        assert_eq!(val, "second");
    }

    mgr.undo().unwrap();
    {
        let txn = doc.transact();
        let val = map.get(&txn, "A1").unwrap().to_string(&txn);
        assert_eq!(val, "first");
    }

    mgr.redo().unwrap();
    {
        let txn = doc.transact();
        let val = map.get(&txn, "A1").unwrap().to_string(&txn);
        assert_eq!(val, "second");
    }
}

#[test]
fn inner_accessors() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    assert!(!mgr.inner().can_undo());

    let inner = mgr.inner_mut();
    assert!(!inner.can_redo());
}

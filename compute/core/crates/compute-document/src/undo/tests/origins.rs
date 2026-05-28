use super::support::{assert_missing, assert_present, insert_with_origin, setup};
use crate::undo::{
    ORIGIN_BOOTSTRAP, ORIGIN_FORMULA_RESULT, ORIGIN_REMOTE, ORIGIN_STRUCTURAL, ORIGIN_UI_STATE,
    ORIGIN_USER_EDIT, UndoRedoManager,
};

#[test]
fn formula_results_not_undoable() {
    let (doc, map) = setup();
    let mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(
        &doc,
        &map,
        ORIGIN_FORMULA_RESULT,
        "A1",
        "=SUM(B1:B10) result: 42",
    );

    assert_present(&doc, &map, "A1");
    assert!(!mgr.can_undo(), "formula results should not be undoable");
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn bootstrap_mutations_not_undoable() {
    let (doc, map) = setup();
    let mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_BOOTSTRAP, "Sheet1", "default");

    assert_present(&doc, &map, "Sheet1");
    assert!(
        !mgr.can_undo(),
        "bootstrap mutations must not enter the undo stack"
    );
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn remote_changes_not_undoable() {
    let (doc, map) = setup();
    let mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_REMOTE, "A1", "remote value");

    assert_present(&doc, &map, "A1");
    assert!(!mgr.can_undo(), "remote changes should not be undoable");
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn ui_state_mutations_not_undoable() {
    let (doc, map) = setup();
    let mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_UI_STATE, "selected_sheet", "sheet-2");

    assert_present(&doc, &map, "selected_sheet");
    assert!(!mgr.can_undo(), "UI state should not be undoable");
    assert_eq!(mgr.undo_depth(), 0);
}

#[test]
fn structural_changes_are_undoable() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_STRUCTURAL, "sheet1:row_count", "101");

    assert!(mgr.can_undo(), "structural changes should be undoable");
    assert_eq!(mgr.undo_depth(), 1);

    assert!(mgr.undo().unwrap());
    assert_missing(&doc, &map, "sheet1:row_count");
}

#[test]
fn mixed_origins_only_tracked_in_undo() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "user");
    insert_with_origin(&doc, &map, ORIGIN_FORMULA_RESULT, "B1", "formula");
    insert_with_origin(&doc, &map, ORIGIN_REMOTE, "C1", "remote");
    insert_with_origin(&doc, &map, ORIGIN_STRUCTURAL, "D1", "structural");

    assert_eq!(mgr.undo_depth(), 2);

    mgr.undo().unwrap();
    mgr.undo().unwrap();

    assert_missing(&doc, &map, "A1");
    assert_present(&doc, &map, "B1");
    assert_present(&doc, &map, "C1");
    assert_missing(&doc, &map, "D1");
}

#[test]
fn untracked_mutation_after_undo_does_not_clear_redo_stack() {
    let (doc, map) = setup();
    let mut mgr = UndoRedoManager::new(&doc, &map);

    insert_with_origin(&doc, &map, ORIGIN_USER_EDIT, "A1", "user");
    assert!(mgr.undo().unwrap());
    assert_eq!(mgr.redo_depth(), 1);

    insert_with_origin(&doc, &map, ORIGIN_UI_STATE, "viewport", "scrolled");

    assert!(mgr.can_redo(), "UI state must not clear redo");
    assert_eq!(mgr.redo_depth(), 1);

    assert!(mgr.redo().unwrap());
    assert_present(&doc, &map, "A1");
    assert_present(&doc, &map, "viewport");
}

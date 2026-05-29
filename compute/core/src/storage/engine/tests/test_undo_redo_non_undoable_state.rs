//! Undo stack behavior for bootstrap and UI state writes.

use super::super::*;
use super::helpers::*;

#[test]
fn create_default_sheet_does_not_enter_undo_stack() {
    use snapshot_types::WorkbookSnapshot;

    // Boot from an empty snapshot, mirroring the lifecycle's "blank
    // workbook" path before the implicit Sheet1 is created.
    let (mut engine, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    assert!(!engine.can_undo(), "fresh empty engine has nothing to undo");

    // The bootstrap path used by `executeStartBridge`.
    let (_hex, _result) = engine
        .create_default_sheet("Sheet1")
        .expect("default-sheet bootstrap should succeed");

    assert!(
        !engine.can_undo(),
        "bootstrap default-sheet creation must NOT land on the undo stack - \
         a fresh workbook must report canUndo == false"
    );

    // Sanity: a regular user-initiated sheet creation IS undoable, so
    // we know the test isn't accidentally suppressing all sheet ops.
    let (_hex, _result) = engine
        .create_sheet("UserSheet")
        .expect("user-facing create_sheet should succeed");
    assert!(
        engine.can_undo(),
        "user-initiated create_sheet should land on the undo stack"
    );
}

#[test]
fn selected_sheet_ids_do_not_clear_redo_stack() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo(), "cell edit should be redoable after undo");

    let mut settings = engine.get_workbook_settings();
    settings.selected_sheet_ids = Some(vec![sheet_id().to_uuid_string()]);
    engine
        .set_workbook_settings(settings)
        .expect("selected sheet state write should succeed");

    assert!(
        engine.can_redo(),
        "selected sheet UI state must not clear the redo stack"
    );
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(42.0));
}

#[test]
fn scroll_position_does_not_clear_redo_stack() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo(), "cell edit should be redoable after undo");

    engine
        .set_scroll_position(&sheet_id(), 12, 7)
        .expect("scroll position write should succeed");

    assert!(
        engine.can_redo(),
        "scroll/view UI state must not clear the redo stack"
    );
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(42.0));
}

#[test]
fn custom_settings_do_not_clear_redo_stack() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo(), "cell edit should be redoable after undo");

    engine
        .set_custom_setting("mog.activeSheetId", Some(sheet_id().to_uuid_string()))
        .expect("custom setting state write should succeed");

    assert!(
        engine.can_redo(),
        "custom metadata state must not clear the redo stack"
    );
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(42.0));
}

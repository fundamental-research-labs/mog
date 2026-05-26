//! Sheet lifecycle runtime hint contract tests.

use super::super::*;
use super::helpers::*;
use snapshot_types::{SheetLifecycleRuntimeHint, SheetSnapshot, WorkbookSnapshot};

fn two_sheet_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440099".to_string(),
                name: "Sheet2".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn second_sheet_id() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap()
}

fn sheet_id_from_hex(hex: &str) -> SheetId {
    SheetId::from_raw(compute_document::hex::hex_to_id(hex).expect("sheet id hex"))
}

fn assert_focus(hint: Option<&SheetLifecycleRuntimeHint>, sheet_id: SheetId) {
    let hint = hint.expect("expected sheet lifecycle runtime hint");
    assert_eq!(hint.active_sheet, Some(sheet_id));
    assert!(hint.reconcile_provider_state);
}

fn assert_reconcile_only(hint: Option<&SheetLifecycleRuntimeHint>) {
    let hint = hint.expect("expected sheet lifecycle runtime hint");
    assert_eq!(hint.active_sheet, None);
    assert!(hint.reconcile_provider_state);
}

#[test]
fn forward_create_sheet_hints_new_sheet_focus() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();

    let (hex, result) = engine.create_sheet("Sheet2").unwrap();
    let new_sheet_id = sheet_id_from_hex(&hex);

    assert_focus(result.sheet_lifecycle_runtime_hint.as_ref(), new_sheet_id);
}

#[test]
fn redo_create_sheet_replays_new_sheet_focus_hint() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();

    let (hex, _result) = engine.create_sheet("Sheet2").unwrap();
    let new_sheet_id = sheet_id_from_hex(&hex);

    let (_patches, undo_result) = engine.undo().unwrap();
    assert_reconcile_only(undo_result.sheet_lifecycle_runtime_hint.as_ref());

    let (_patches, redo_result) = engine.redo().unwrap();
    assert_focus(
        redo_result.sheet_lifecycle_runtime_hint.as_ref(),
        new_sheet_id,
    );
}

#[test]
fn forward_copy_sheet_hints_copied_sheet_focus() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();
    let source = sheet_id();

    let (hex, result) = engine.copy_sheet(&source, "Copy").unwrap();
    let copied_sheet_id = sheet_id_from_hex(&hex);

    assert_focus(
        result.sheet_lifecycle_runtime_hint.as_ref(),
        copied_sheet_id,
    );
}

#[test]
fn forward_delete_sheet_hints_provider_reconciliation() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();
    let target = second_sheet_id();

    let (_patches, result) = engine.delete_sheet(&target).unwrap();

    assert_reconcile_only(result.sheet_lifecycle_runtime_hint.as_ref());
}

#[test]
fn hide_and_show_sheet_emit_visibility_hints() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();
    let target = second_sheet_id();

    let (_patches, hide_result) = engine.set_sheet_visibility(&target, "hidden").unwrap();
    assert_reconcile_only(hide_result.sheet_lifecycle_runtime_hint.as_ref());

    let (_patches, show_result) = engine.set_sheet_visibility(&target, "visible").unwrap();
    assert_focus(show_result.sheet_lifecycle_runtime_hint.as_ref(), target);
}

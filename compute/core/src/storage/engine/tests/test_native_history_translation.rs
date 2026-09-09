//! Native undo/redo sheet metadata and lifecycle result contracts.

use super::super::*;
use super::helpers::*;
use snapshot_types::{ChangeKind, SheetChangeField, SheetSnapshot, WorkbookSnapshot};

/// Build a two-sheet snapshot for order/lifecycle tests.
fn two_sheet_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
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

fn sheet_id_2() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap()
}

fn sheet_id_from_hex(hex: &str) -> SheetId {
    let raw = compute_document::hex::hex_to_id(hex).expect("sheet hex should parse");
    SheetId::from_raw(raw)
}

// ------------------------------------------------------------------
// Order: move_sheet then undo
// ------------------------------------------------------------------

#[test]
fn undo_move_sheet_emits_order_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();

    let sid = sheet_id();

    // Forward: move Sheet1 from index 0 to index 1.
    let fwd_result = engine.move_sheet(&sid, 1).unwrap();
    // Forward should emit Order SheetChange.
    assert!(
        fwd_result
            .sheet_changes
            .iter()
            .any(|sc| sc.field == SheetChangeField::Order),
        "forward move_sheet must emit Order SheetChange"
    );

    // Verify the order actually changed in native storage.
    let order_after_move = engine.storage().sheet_order();
    assert_eq!(order_after_move[0], sheet_id_2());
    assert_eq!(order_after_move[1], sid);

    // Undo: should revert to [Sheet1, Sheet2].
    let undo_result = engine.undo().unwrap();

    // The undo MutationResult must contain Order SheetChange entries.
    let order_changes: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::Order)
        .collect();
    assert!(
        !order_changes.is_empty(),
        "undo of move_sheet must emit Order SheetChange; got sheet_changes = {:?}",
        undo_result.sheet_changes
    );

    // Verify order reverted in native storage.
    let order_after_undo = engine.storage().sheet_order();
    assert_eq!(order_after_undo[0], sid);
    assert_eq!(order_after_undo[1], sheet_id_2());

    // The emitted index values must match the restored order.
    let sheet1_change = order_changes
        .iter()
        .find(|sc| sc.sheet_id == sid.to_uuid_string());
    assert!(sheet1_change.is_some(), "must emit Order change for Sheet1");
    assert_eq!(sheet1_change.unwrap().index, Some(0));
}

#[test]
fn redo_move_sheet_emits_order_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();

    let sid = sheet_id();

    // Forward + undo.
    engine.move_sheet(&sid, 1).unwrap();
    engine.undo().unwrap();

    // Redo: should re-apply the move.
    let redo_result = engine.redo().unwrap();

    let order_changes: Vec<_> = redo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::Order)
        .collect();
    assert!(
        !order_changes.is_empty(),
        "redo of move_sheet must emit Order SheetChange; got sheet_changes = {:?}",
        redo_result.sheet_changes
    );

    // Verify order is back to moved state [Sheet2, Sheet1].
    let order = engine.storage().sheet_order();
    assert_eq!(order[0], sheet_id_2());
    assert_eq!(order[1], sid);
}

// ------------------------------------------------------------------
// Lifecycle: create_sheet then undo/redo
// ------------------------------------------------------------------

#[test]
fn undo_create_sheet_removes_only_created_sheet() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let original_sid = sheet_id();

    let (new_hex, _create_result) = engine.create_sheet("Sheet2").unwrap();
    let new_sid = sheet_id_from_hex(&new_hex);

    let order_after_create = engine.storage().sheet_order();
    assert_eq!(order_after_create, vec![original_sid, new_sid]);

    let undo_result = engine.undo().unwrap();

    let order_after_undo = engine.storage().sheet_order();
    assert_eq!(
        order_after_undo,
        vec![original_sid],
        "undoing create_sheet must leave the original sheet and remove only the created sheet"
    );

    let removed: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| {
            sc.field == SheetChangeField::Sheet
                && sc.kind == ChangeKind::Removed
                && sc.sheet_id == new_sid.to_uuid_string()
        })
        .collect();
    assert_eq!(
        removed.len(),
        1,
        "undo of create_sheet must emit one lifecycle removal for Sheet2; got {:?}",
        undo_result.sheet_changes
    );
    assert!(
        !undo_result.sheet_changes.iter().any(|sc| {
            sc.field == SheetChangeField::Sheet
                && sc.kind == ChangeKind::Removed
                && sc.sheet_id == original_sid.to_uuid_string()
        }),
        "undo of create_sheet must not emit a lifecycle removal for the original sheet; got {:?}",
        undo_result.sheet_changes
    );
}

#[test]
fn redo_create_sheet_restores_created_sheet() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let original_sid = sheet_id();

    let (new_hex, _create_result) = engine.create_sheet("Sheet2").unwrap();
    let new_sid = sheet_id_from_hex(&new_hex);
    engine.undo().unwrap();

    let redo_result = engine.redo().unwrap();

    let order_after_redo = engine.storage().sheet_order();
    assert_eq!(
        order_after_redo,
        vec![original_sid, new_sid],
        "redoing create_sheet must restore the created sheet after the original sheet"
    );

    let created: Vec<_> = redo_result
        .sheet_changes
        .iter()
        .filter(|sc| {
            sc.field == SheetChangeField::Sheet
                && sc.kind == ChangeKind::Set
                && sc.sheet_id == new_sid.to_uuid_string()
        })
        .collect();
    assert_eq!(
        created.len(),
        1,
        "redo of create_sheet must emit one lifecycle creation for Sheet2; got {:?}",
        redo_result.sheet_changes
    );
    assert_eq!(created[0].name.as_deref(), Some("Sheet2"));
}

// ------------------------------------------------------------------
// TabColor: set_tab_color then undo
// ------------------------------------------------------------------

#[test]
fn undo_set_tab_color_emits_tab_color_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();

    let sid = sheet_id();
    engine.set_tab_color(&sid, Some("#FF0000".into())).unwrap();

    let undo_result = engine.undo().unwrap();

    let tab_changes: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::TabColor)
        .collect();
    assert!(
        !tab_changes.is_empty(),
        "undo of set_tab_color must emit TabColor SheetChange; got sheet_changes = {:?}",
        undo_result.sheet_changes
    );
    // After undo, the color should be None (reverted to no tab color).
    assert_eq!(tab_changes[0].color, None);
}

// ------------------------------------------------------------------
// Name: rename then undo
// ------------------------------------------------------------------

#[test]
fn undo_rename_sheet_emits_name_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();

    let sid = sheet_id();
    engine.rename_compute_sheet(&sid, "Renamed").unwrap();

    let undo_result = engine.undo().unwrap();

    let name_changes: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::Name)
        .collect();
    assert!(
        !name_changes.is_empty(),
        "undo of rename must emit Name SheetChange; got sheet_changes = {:?}",
        undo_result.sheet_changes
    );
    // After undo, name should revert to "Sheet1".
    assert_eq!(name_changes[0].name.as_deref(), Some("Sheet1"));
}

// ------------------------------------------------------------------
// Hidden: set_sheet_hidden then undo
// ------------------------------------------------------------------

#[test]
fn undo_set_sheet_hidden_emits_hidden_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();

    let sid = sheet_id();
    engine.set_sheet_hidden(&sid, true).unwrap();

    let undo_result = engine.undo().unwrap();

    let hidden_changes: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::Hidden)
        .collect();
    assert!(
        !hidden_changes.is_empty(),
        "undo of set_sheet_hidden must emit Hidden SheetChange; got sheet_changes = {:?}",
        undo_result.sheet_changes
    );
    // After undo, sheet should be visible (hidden=false).
    assert_eq!(hidden_changes[0].hidden, Some(false));
}

// ------------------------------------------------------------------
// Visibility: set_sheet_visibility then undo
// ------------------------------------------------------------------

#[test]
fn undo_set_sheet_visibility_emits_visibility_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();

    let sid = sheet_id();
    engine.set_sheet_visibility(&sid, "veryHidden").unwrap();

    let undo_result = engine.undo().unwrap();

    let vis_changes: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::Visibility)
        .collect();
    assert!(
        !vis_changes.is_empty(),
        "undo of set_sheet_visibility must emit Visibility SheetChange; got sheet_changes = {:?}",
        undo_result.sheet_changes
    );
    // After undo, sheet should be visible (hidden=false).
    assert_eq!(vis_changes[0].hidden, Some(false));
}

// ------------------------------------------------------------------
// Frozen: set_frozen_panes then undo
// ------------------------------------------------------------------

#[test]
fn undo_set_frozen_panes_emits_frozen_sheet_change() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();

    let sid = sheet_id();
    engine.set_frozen_panes(&sid, 3, 2).unwrap();

    let undo_result = engine.undo().unwrap();

    let frozen_changes: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|sc| sc.field == SheetChangeField::Frozen)
        .collect();
    assert!(
        !frozen_changes.is_empty(),
        "undo of set_frozen_panes must emit Frozen SheetChange; got sheet_changes = {:?}",
        undo_result.sheet_changes
    );
    // After undo, frozen should revert to (0, 0).
    assert_eq!(frozen_changes[0].frozen_rows, Some(0));
    assert_eq!(frozen_changes[0].frozen_cols, Some(0));
}

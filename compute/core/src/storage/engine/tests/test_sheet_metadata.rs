//! Group 19: Sheet metadata mutations (tab color, hidden, move, frozen, visibility, serialization).

use super::super::*;
use super::helpers::*;

// Test: set_tab_color returns MutationResult with color in sheet_changes
#[test]
fn test_set_tab_color_returns_mutation_result_with_sheet_changes() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let (_patches, result) = engine
        .set_tab_color(&sid, Some("#ff0000".to_string()))
        .unwrap();

    assert_eq!(result.sheet_changes.len(), 1);
    let change = &result.sheet_changes[0];
    assert_eq!(change.field, snapshot_types::SheetChangeField::TabColor);
    assert_eq!(change.kind, snapshot_types::ChangeKind::Set);
    assert_eq!(change.color, Some("#ff0000".to_string()));
    assert_eq!(change.old_color, None); // No previous color set
    assert_eq!(change.sheet_id, sid.to_uuid_string());
}

// Test: set_tab_color preserves old_color when changing colors
#[test]
fn test_set_tab_color_preserves_old_color() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Set initial color
    engine
        .set_tab_color(&sid, Some("#ff0000".to_string()))
        .unwrap();

    // Change to new color -- old_color should be the previous one
    let (_patches, result) = engine
        .set_tab_color(&sid, Some("#00ff00".to_string()))
        .unwrap();
    assert_eq!(result.sheet_changes.len(), 1);
    let change = &result.sheet_changes[0];
    assert_eq!(change.color, Some("#00ff00".to_string()));
    assert_eq!(change.old_color, Some("#ff0000".to_string()));
}

// Test: clearing tab color (setting to None) returns correct sheet_changes
#[test]
fn test_set_tab_color_clear_returns_sheet_changes() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Set then clear
    engine
        .set_tab_color(&sid, Some("#ff0000".to_string()))
        .unwrap();
    let (_patches, result) = engine.set_tab_color(&sid, None).unwrap();

    assert_eq!(result.sheet_changes.len(), 1);
    let change = &result.sheet_changes[0];
    assert_eq!(change.color, None);
    assert_eq!(change.old_color, Some("#ff0000".to_string()));
}

// Test: SheetChangeField serializes to expected camelCase strings
#[test]
fn test_sheet_change_field_serializes_to_camel_case() {
    use snapshot_types::SheetChangeField;

    assert_eq!(
        serde_json::to_string(&SheetChangeField::Name).unwrap(),
        "\"name\""
    );
    assert_eq!(
        serde_json::to_string(&SheetChangeField::TabColor).unwrap(),
        "\"tabColor\""
    );
    assert_eq!(
        serde_json::to_string(&SheetChangeField::Sheet).unwrap(),
        "\"sheet\""
    );
    assert_eq!(
        serde_json::to_string(&SheetChangeField::Order).unwrap(),
        "\"order\""
    );
    assert_eq!(
        serde_json::to_string(&SheetChangeField::Hidden).unwrap(),
        "\"hidden\""
    );
    assert_eq!(
        serde_json::to_string(&SheetChangeField::Frozen).unwrap(),
        "\"frozen\""
    );
    assert_eq!(
        serde_json::to_string(&SheetChangeField::Visibility).unwrap(),
        "\"visibility\""
    );
}

// Test: SheetChangeField round-trips through serde
#[test]
fn test_sheet_change_field_deserializes_from_camel_case() {
    use snapshot_types::SheetChangeField;

    let field: SheetChangeField = serde_json::from_str("\"tabColor\"").unwrap();
    assert_eq!(field, SheetChangeField::TabColor);

    let field: SheetChangeField = serde_json::from_str("\"name\"").unwrap();
    assert_eq!(field, SheetChangeField::Name);
}

// Test: All mutation methods that modify sheet metadata return non-empty sheet_changes
#[test]
fn test_set_sheet_hidden_returns_non_empty_sheet_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let (_patches, result) = engine.set_sheet_hidden(&sid, true).unwrap();

    assert!(
        !result.sheet_changes.is_empty(),
        "set_sheet_hidden should return non-empty sheet_changes"
    );
    assert_eq!(
        result.sheet_changes[0].field,
        snapshot_types::SheetChangeField::Hidden
    );
}

#[test]
fn test_move_sheet_returns_non_empty_sheet_changes() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    // Move to same position (index 0) -- should still produce a sheet change
    let (_patches, result) = engine.move_sheet(&sid, 0).unwrap();

    assert!(
        !result.sheet_changes.is_empty(),
        "move_sheet should return non-empty sheet_changes"
    );
    assert_eq!(
        result.sheet_changes[0].field,
        snapshot_types::SheetChangeField::Order
    );
}

#[test]
fn test_set_frozen_panes_returns_non_empty_sheet_changes() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let (_patches, result) = engine.set_frozen_panes(&sid, 2, 3).unwrap();

    assert!(
        !result.sheet_changes.is_empty(),
        "set_frozen_panes should return non-empty sheet_changes"
    );
    assert_eq!(
        result.sheet_changes[0].field,
        snapshot_types::SheetChangeField::Frozen
    );
}

#[test]
fn test_set_scroll_position_returns_scroll_position_change() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let (_patches, result) = engine.set_scroll_position(&sid, 10, 5).unwrap();

    assert_eq!(result.scroll_position_changes.len(), 1);
    let change = &result.scroll_position_changes[0];
    assert_eq!(change.sheet_id, sid.to_uuid_string());
    assert_eq!(change.top_row, 10);
    assert_eq!(change.left_col, 5);
}

#[test]
fn test_set_sheet_visibility_returns_non_empty_sheet_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let (_patches, result) = engine.set_sheet_visibility(&sid, "hidden").unwrap();

    assert!(
        !result.sheet_changes.is_empty(),
        "set_sheet_visibility should return non-empty sheet_changes"
    );
    assert_eq!(
        result.sheet_changes[0].field,
        snapshot_types::SheetChangeField::Visibility
    );
}

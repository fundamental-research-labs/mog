use crate::snapshot::{ChangeKind as SnapChangeKind, SheetChangeField};
use crate::storage::engine::ComputeEngine;
use cell_types::SheetId;
use domain_types::domain::print::PrintSettings as DomainPrintSettings;
use domain_types::domain::sheet::{PrintRange, PrintTitles, SplitDirection, SplitViewConfig};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn build_engine() -> ComputeEngine {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = ComputeEngine::from_snapshot(snap).expect("from_snapshot");
    engine
}

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

// -- Page breaks (5 functions) --------------------------------------

#[test]
fn add_horizontal_page_break_returns_page_break_changes() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let result = engine
        .add_horizontal_page_break(&sid, 5)
        .map(|(_, result)| result);
    let result = result.expect("add_horizontal_page_break");
    assert_eq!(result.page_break_changes.len(), 1);
    assert_eq!(result.page_break_changes[0].sheet_id, sid.to_uuid_string());
    assert!(
        result.page_break_changes[0]
            .breaks
            .row_breaks
            .iter()
            .any(|b| b.id == 5),
        "row_breaks must reflect the post-mutation snapshot"
    );
}

#[test]
fn add_vertical_page_break_returns_page_break_changes() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let result = engine
        .add_vertical_page_break(&sid, 7)
        .map(|(_, result)| result);
    let result = result.expect("add_vertical_page_break");
    assert_eq!(result.page_break_changes.len(), 1);
    assert!(
        result.page_break_changes[0]
            .breaks
            .col_breaks
            .iter()
            .any(|b| b.id == 7)
    );
}

#[test]
fn remove_horizontal_page_break_returns_page_break_changes() {
    let mut engine = build_engine();
    let sid = sheet_id();
    // Seed a break first so the removal path observes a transition.
    engine
        .add_horizontal_page_break(&sid, 3)
        .map(|(_, result)| result)
        .expect("seed");

    let result = engine
        .remove_horizontal_page_break(&sid, 3)
        .map(|(_, result)| result)
        .expect("remove_horizontal_page_break");
    assert_eq!(result.page_break_changes.len(), 1);
    assert!(
        !result.page_break_changes[0]
            .breaks
            .row_breaks
            .iter()
            .any(|b| b.id == 3),
        "post-removal snapshot must not contain the removed row break"
    );
}

#[test]
fn remove_vertical_page_break_returns_page_break_changes() {
    let mut engine = build_engine();
    let sid = sheet_id();
    engine
        .add_vertical_page_break(&sid, 4)
        .map(|(_, result)| result)
        .expect("seed");

    let result = engine
        .remove_vertical_page_break(&sid, 4)
        .map(|(_, result)| result)
        .expect("remove_vertical_page_break");
    assert_eq!(result.page_break_changes.len(), 1);
    assert!(
        !result.page_break_changes[0]
            .breaks
            .col_breaks
            .iter()
            .any(|b| b.id == 4),
        "post-removal snapshot must not contain the removed col break"
    );
}

#[test]
fn clear_all_page_breaks_returns_page_break_changes() {
    let mut engine = build_engine();
    let sid = sheet_id();
    engine
        .add_horizontal_page_break(&sid, 1)
        .map(|(_, result)| result)
        .expect("seed h");
    engine
        .add_vertical_page_break(&sid, 2)
        .map(|(_, result)| result)
        .expect("seed v");

    let result = engine
        .clear_all_page_breaks(&sid)
        .map(|(_, result)| result)
        .expect("clear_all_page_breaks");
    assert_eq!(result.page_break_changes.len(), 1);
    let breaks = &result.page_break_changes[0].breaks;
    assert!(breaks.row_breaks.is_empty());
    assert!(breaks.col_breaks.is_empty());
}

// -- Print area / titles / settings (3 functions) -------------------

#[test]
fn set_print_area_returns_print_area_change() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let area = PrintRange {
        start_row: 0,
        start_col: 0,
        end_row: 10,
        end_col: 5,
    };
    let result = engine
        .set_print_area(&sid, Some(area.clone()))
        .map(|(_, result)| result)
        .expect("set_print_area");
    assert_eq!(result.print_area_changes.len(), 1);
    let change = &result.print_area_changes[0];
    assert_eq!(change.kind, SnapChangeKind::Set);
    assert_eq!(change.area.as_ref().map(|a| a.end_row), Some(10));

    // Removal path → kind must be Removed.
    let result = engine
        .set_print_area(&sid, None)
        .map(|(_, result)| result)
        .expect("set_print_area(None)");
    assert_eq!(result.print_area_changes.len(), 1);
    assert_eq!(result.print_area_changes[0].kind, SnapChangeKind::Removed);
    assert!(result.print_area_changes[0].area.is_none());
}

#[test]
fn set_print_titles_returns_print_titles_change() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let titles = PrintTitles {
        repeat_rows: Some((0, 1)),
        repeat_cols: None,
    };
    let result = engine
        .set_print_titles(&sid, titles)
        .map(|(_, result)| result)
        .expect("set_print_titles");
    assert_eq!(result.print_titles_changes.len(), 1);
    assert_eq!(
        result.print_titles_changes[0].titles.repeat_rows,
        Some((0, 1))
    );
}

#[test]
fn set_print_settings_returns_print_settings_change() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let mut settings = DomainPrintSettings::default();
    settings.orientation = Some("landscape".to_string());
    let result = engine
        .set_print_settings(&sid, settings)
        .map(|(_, result)| result)
        .expect("set_print_settings");
    assert_eq!(result.print_settings_changes.len(), 1);
    assert_eq!(
        result.print_settings_changes[0].settings.orientation,
        Some("landscape".to_string())
    );
}

// -- Split config (1 function) --------------------------------------

#[test]
fn set_split_config_returns_split_config_change() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let config = SplitViewConfig {
        direction: SplitDirection::Both,
        horizontal_position: 100,
        vertical_position: 200,
    };
    let result = engine
        .set_split_config(&sid, Some(config.clone()))
        .map(|(_, result)| result)
        .expect("set_split_config");
    assert_eq!(result.split_config_changes.len(), 1);
    let change = &result.split_config_changes[0];
    assert_eq!(change.kind, SnapChangeKind::Set);
    assert_eq!(
        change.config.as_ref().map(|c| c.horizontal_position),
        Some(100)
    );

    // Removal path → kind == Removed.
    let result = engine
        .set_split_config(&sid, None)
        .map(|(_, result)| result)
        .expect("set_split_config(None)");
    assert_eq!(result.split_config_changes.len(), 1);
    assert_eq!(result.split_config_changes[0].kind, SnapChangeKind::Removed);
}

#[test]
fn set_split_config_reports_frozen_panes_cleared() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let config = SplitViewConfig {
        direction: SplitDirection::Both,
        horizontal_position: 100,
        vertical_position: 200,
    };
    engine
        .set_frozen_panes(&sid, 3, 2)
        .map(|(_, result)| result)
        .expect("set_frozen_panes");

    let result = engine
        .set_split_config(&sid, Some(config.clone()))
        .map(|(_, result)| result)
        .expect("set_split_config");

    assert_eq!(result.split_config_changes.len(), 1);
    let frozen_change = result
        .sheet_changes
        .iter()
        .find(|change| change.field == SheetChangeField::Frozen)
        .expect("split should report frozen panes cleared");
    assert_eq!(frozen_change.frozen_rows, Some(0));
    assert_eq!(frozen_change.old_frozen_rows, Some(3));
    assert_eq!(frozen_change.frozen_cols, Some(0));
    assert_eq!(frozen_change.old_frozen_cols, Some(2));
}

#[test]
fn native_bridge_set_split_config_returns_split_config_change() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let config = SplitViewConfig {
        direction: SplitDirection::Both,
        horizontal_position: 1,
        vertical_position: 1,
    };

    let (_patches, result) = engine
        .set_split_config(&sid, Some(config))
        .expect("bridge set_split_config");

    assert_eq!(result.split_config_changes.len(), 1);
    let change = &result.split_config_changes[0];
    assert_eq!(change.kind, SnapChangeKind::Set);
    assert_eq!(change.config.as_ref().map(|c| c.vertical_position), Some(1));
}

// -- Scroll position (1 function) -----------------------------------

#[test]
fn set_scroll_position_returns_scroll_position_change() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let result = engine
        .set_scroll_position(&sid, 12, 7)
        .map(|(_, result)| result)
        .expect("set_scroll_position");
    assert_eq!(result.scroll_position_changes.len(), 1);
    let change = &result.scroll_position_changes[0];
    assert_eq!(change.sheet_id, sid.to_uuid_string());
    assert_eq!(change.top_row, 12);
    assert_eq!(change.left_col, 7);
}

#[test]
fn delete_sheet_preserves_other_sheet() {
    let mut engine = build_engine();
    engine.create_sheet("Sheet2").unwrap();
    engine.delete_sheet(&sheet_id()).unwrap();
    let order = engine.stores.storage.sheet_order();
    assert_eq!(order.len(), 1);
    assert_ne!(order[0], sheet_id());
    engine.undo().unwrap();
    assert_eq!(engine.stores.storage.sheet_order()[0], sheet_id());
}

#[test]
fn delete_last_sheet_is_rejected() {
    let mut engine = build_engine();
    assert!(engine.delete_sheet(&sheet_id()).is_err());
    assert_eq!(engine.stores.storage.sheet_order(), vec![sheet_id()]);
    assert!(!engine.can_undo());
}

#[test]
fn delete_missing_sheet_is_rejected() {
    let mut engine = build_engine();
    engine.create_sheet("Sheet2").unwrap();
    let order = engine.stores.storage.sheet_order();
    let depth = engine.get_undo_state().undo_depth;
    assert!(engine.delete_sheet(&SheetId::from_raw(999)).is_err());
    assert_eq!(engine.stores.storage.sheet_order(), order);
    assert_eq!(engine.get_undo_state().undo_depth, depth);
}

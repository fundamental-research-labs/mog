use super::{
    add_horizontal_page_break, add_vertical_page_break, clear_all_page_breaks,
    remove_horizontal_page_break, remove_vertical_page_break, set_frozen_panes, set_print_area,
    set_print_settings, set_print_titles, set_scroll_position, set_split_config,
};
use crate::snapshot::{ChangeKind as SnapChangeKind, SheetChangeField};
use crate::storage::engine::YrsComputeEngine;
use cell_types::SheetId;
use domain_types::domain::print::PrintSettings as DomainPrintSettings;
use domain_types::domain::sheet::{PrintRange, PrintTitles, SplitDirection, SplitViewConfig};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn build_engine() -> YrsComputeEngine {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
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
    let result =
        engine.with_internals_for_test(|stores, _, _| add_horizontal_page_break(stores, &sid, 5));
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
    let result =
        engine.with_internals_for_test(|stores, _, _| add_vertical_page_break(stores, &sid, 7));
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
        .with_internals_for_test(|stores, _, _| add_horizontal_page_break(stores, &sid, 3))
        .expect("seed");

    let result = engine
        .with_internals_for_test(|stores, _, _| remove_horizontal_page_break(stores, &sid, 3))
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
        .with_internals_for_test(|stores, _, _| add_vertical_page_break(stores, &sid, 4))
        .expect("seed");

    let result = engine
        .with_internals_for_test(|stores, _, _| remove_vertical_page_break(stores, &sid, 4))
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
        .with_internals_for_test(|stores, _, _| add_horizontal_page_break(stores, &sid, 1))
        .expect("seed h");
    engine
        .with_internals_for_test(|stores, _, _| add_vertical_page_break(stores, &sid, 2))
        .expect("seed v");

    let result = engine
        .with_internals_for_test(|stores, _, _| clear_all_page_breaks(stores, &sid))
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
        .with_internals_for_test(|stores, _, _| set_print_area(stores, &sid, Some(&area)))
        .expect("set_print_area");
    assert_eq!(result.print_area_changes.len(), 1);
    let change = &result.print_area_changes[0];
    assert_eq!(change.kind, SnapChangeKind::Set);
    assert_eq!(change.area.as_ref().map(|a| a.end_row), Some(10));

    // Removal path → kind must be Removed.
    let result = engine
        .with_internals_for_test(|stores, _, _| set_print_area(stores, &sid, None))
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
        .with_internals_for_test(|stores, _, _| set_print_titles(stores, &sid, &titles))
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
        .with_internals_for_test(|stores, _, _| set_print_settings(stores, &sid, &settings))
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
        .with_internals_for_test(|stores, _, _| set_split_config(stores, &sid, Some(&config)))
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
        .with_internals_for_test(|stores, _, _| set_split_config(stores, &sid, None))
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
        .with_internals_for_test(|stores, _, _| set_frozen_panes(stores, &sid, 3, 2))
        .expect("set_frozen_panes");

    let result = engine
        .with_internals_for_test(|stores, _, _| set_split_config(stores, &sid, Some(&config)))
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
fn yrs_bridge_set_split_config_returns_split_config_change() {
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
        .with_internals_for_test(|stores, _, _| set_scroll_position(stores, &sid, 12, 7))
        .expect("set_scroll_position");
    assert_eq!(result.scroll_position_changes.len(), 1);
    let change = &result.scroll_position_changes[0];
    assert_eq!(change.sheet_id, sid.to_uuid_string());
    assert_eq!(change.top_row, 12);
    assert_eq!(change.left_col, 7);
}

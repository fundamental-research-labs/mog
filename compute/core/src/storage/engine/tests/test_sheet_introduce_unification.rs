//! Tests pinning the contract that every "introduce a sheet
//! to observable state" handler — bootstrap, user-edit add, and copy —
//! flows through `build_sheet_hydration_changes` and emits the full
//! per-sheet hydration shape, not the slim "creation event only" shape
//! that left eight of nine per-sheet store dimensions uninitialized.
//!
//! Bootstrap byte-for-byte coverage lives in
//! `test_bootstrap_hydration.rs` and the inline
//! `hydration_emits_store_backed_families_with_populated_payloads` test
//! in `result_building.rs`. This file covers the user-edit add and copy
//! paths specifically.

use super::super::*;
use crate::snapshot::{ChangeKind, SheetChangeField};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn workbook_with_one_sheet() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Test 1 — user-edit add emits the full per-sheet hydration shape
// ---------------------------------------------------------------------------

#[test]
fn user_edit_sheet_add_emits_full_per_sheet_families() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook_with_one_sheet()).expect("from_snapshot");

    // Add Sheet2 via the user-edit path. This goes through
    // `mutation_create_sheet` → `build_sheet_hydration_changes(None)`.
    let (new_hex, result) = engine.create_sheet("Sheet2").expect("create_sheet");
    assert!(!new_hex.is_empty(), "new sheet hex must be non-empty");

    // Resolve the new SheetId from the hex so we can scope per-sheet
    // assertions to the sheet that was just created (the workbook still
    // has Sheet1 and the helper does NOT enumerate it on the user-edit
    // add path — only the new sheet).
    let new_sid = {
        let raw =
            compute_document::hex::hex_to_id(&new_hex).expect("new_hex must parse as cell-id hex");
        cell_types::SheetId::from_uuid_str(&cell_types::CellId::from_raw(raw).to_uuid_string())
            .expect("SheetId from hex round-trip")
    };
    let new_sid_str = new_sid.to_uuid_string();

    // ----- Identity SheetChange (canonical creation event) -----
    let creation_events: Vec<_> = result
        .sheet_changes
        .iter()
        .filter(|c| c.sheet_id == new_sid_str && c.field == SheetChangeField::Sheet)
        .collect();
    assert_eq!(
        creation_events.len(),
        1,
        "expected exactly one SheetChange{{field:Sheet,kind:Set}} for the new sheet, got {:?}",
        creation_events,
    );
    let creation = creation_events[0];
    assert_eq!(creation.kind, ChangeKind::Set);
    assert_eq!(creation.name.as_deref(), Some("Sheet2"));
    assert_eq!(creation.index, Some(1));
    assert_eq!(
        creation.source_sheet_id, None,
        "user-edit add must not carry source_sheet_id provenance",
    );

    // ----- Per-field Name + Order emits -----
    let name_events: Vec<_> = result
        .sheet_changes
        .iter()
        .filter(|c| c.sheet_id == new_sid_str && c.field == SheetChangeField::Name)
        .collect();
    assert_eq!(name_events.len(), 1, "expected one Name SheetChange");
    assert_eq!(name_events[0].name.as_deref(), Some("Sheet2"));

    let order_events: Vec<_> = result
        .sheet_changes
        .iter()
        .filter(|c| c.sheet_id == new_sid_str && c.field == SheetChangeField::Order)
        .collect();
    assert_eq!(order_events.len(), 1, "expected one Order SheetChange");
    assert_eq!(order_events[0].index, Some(1));

    // ----- Default-value emits suppressed -----
    for field in [
        SheetChangeField::Frozen,
        SheetChangeField::Visibility,
        SheetChangeField::TabColor,
    ] {
        let count = result
            .sheet_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str && c.field == field)
            .count();
        assert_eq!(
            count, 0,
            "default-value SheetChange for {:?} must be suppressed for a fresh sheet",
            field,
        );
    }

    // ----- The fix: SheetSettingsChange for the new sheet -----
    //
    // This is the actual cell_store-drift closure. Without this emit, the TS
    // cell_store's `settingsBySheet[newId]` falls back to DEFAULT_SHEET_SETTINGS
    // — which disagrees with Rust's wire shape on `gridlineColor`,
    // `defaultRowHeight`, `defaultColWidth`, `showFormulas`, `zoomScale`.
    let settings_events: Vec<_> = result
        .settings_changes
        .iter()
        .filter(|c| c.sheet_id == new_sid_str)
        .collect();
    assert_eq!(
        settings_events.len(),
        1,
        "expected exactly one SheetSettingsChange for the new sheet",
    );
    let settings = settings_events[0];
    assert_eq!(settings.kind, ChangeKind::Set);
    assert_eq!(
        settings.changed_key, "*hydration*",
        "user-edit add must use the hydration sentinel — same wire shape as bootstrap",
    );
    assert!(
        settings.settings.is_object(),
        "settings JSON must be an object",
    );
    assert!(
        settings.settings.get("showGridlines").is_some(),
        "settings must contain showGridlines key",
    );
    assert!(
        settings.settings.get("defaultRowHeight").is_some(),
        "settings must contain defaultRowHeight key",
    );

    // ----- PrintSettings + ScrollPosition always emitted -----
    assert_eq!(
        result
            .print_settings_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str)
            .count(),
        1,
        "expected one PrintSettingsChange for the new sheet",
    );
    assert_eq!(
        result
            .scroll_position_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str)
            .count(),
        1,
        "expected one ScrollPositionChange for the new sheet",
    );

    // ----- Empty per-sheet projections produce zero entries -----
    for (label, count) in [
        (
            "tables",
            result
                .table_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "comments",
            result
                .comment_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "filters",
            result
                .filter_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "floating_objects",
            result
                .floating_object_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "cf",
            result
                .cf_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "sparklines",
            result
                .sparkline_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "pivots",
            result
                .pivot_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "grouping",
            result
                .grouping_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "page_breaks",
            result
                .page_break_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "print_area",
            result
                .print_area_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "print_titles",
            result
                .print_titles_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
        (
            "split_config",
            result
                .split_config_changes
                .iter()
                .filter(|c| c.sheet_id == new_sid_str)
                .count(),
        ),
    ] {
        assert_eq!(
            count, 0,
            "expected zero {} entries for fresh empty sheet, got {}",
            label, count,
        );
    }
}

// ---------------------------------------------------------------------------
// Test 2 — copy_sheet emits the source's per-sheet projections on the copy
// ---------------------------------------------------------------------------
//
// Copy emits native per-sheet metadata through the shared hydration result
// builder, including copy provenance, settings, print metadata, and CF rules.

#[test]
fn copy_sheet_emits_source_projections_on_target() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook_with_one_sheet()).expect("from_snapshot");
    let source_sid = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // Add a conditional format rule on the source. Schema mirrors
    // `compute/core/tests/cf_canonical_schema.rs::cf_payload`.
    let cf_rule = serde_json::json!({
        "id": "fmt-copy-test",
        "sheetId": source_sid.to_uuid_string(),
        "ranges": [{
            "startRow": 0, "startCol": 0,
            "endRow": 1,   "endCol": 0,
        }],
        "rules": [{
            "type": "containsBlanks",
            "id": "rule-cb",
            "priority": 1,
            "style": {},
        }],
    });
    engine
        .add_cf_rule(&source_sid, cf_rule)
        .expect("add_cf_rule");

    // Now copy the source.
    let (copy_hex, result) = engine.copy_sheet(&source_sid, "Copy").expect("copy_sheet");
    assert!(!copy_hex.is_empty());

    let new_sid = {
        let raw = compute_document::hex::hex_to_id(&copy_hex)
            .expect("copy_hex must parse as cell-id hex");
        cell_types::SheetId::from_uuid_str(&cell_types::CellId::from_raw(raw).to_uuid_string())
            .expect("SheetId from hex round-trip")
    };
    let new_sid_str = new_sid.to_uuid_string();

    // ----- Provenance threading on the canonical creation event -----
    let creation = result
        .sheet_changes
        .iter()
        .find(|c| c.sheet_id == new_sid_str && c.field == SheetChangeField::Sheet)
        .expect("expected creation SheetChange for the copy");
    assert_eq!(creation.kind, ChangeKind::Set);
    assert_eq!(creation.name.as_deref(), Some("Copy"));
    assert_eq!(
        creation.source_sheet_id,
        Some(source_sid.to_uuid_string()),
        "copy must thread source_sheet_id on the canonical creation event",
    );

    // Copied CF rules must appear immediately in the mutation result.
    let cf_changes_for_copy: Vec<_> = result
        .cf_changes
        .iter()
        .filter(|c| c.sheet_id == new_sid_str)
        .collect();
    assert!(
        !cf_changes_for_copy.is_empty(),
        "copy must emit CfChange entries for the deep-cloned conditional formats \
         (got cf_changes = {:?})",
        result.cf_changes,
    );

    // ----- Per-sheet hydration-shape on the copy too -----
    let settings_for_copy: Vec<_> = result
        .settings_changes
        .iter()
        .filter(|c| c.sheet_id == new_sid_str)
        .collect();
    assert_eq!(
        settings_for_copy.len(),
        1,
        "copy must emit exactly one SheetSettingsChange",
    );
    assert_eq!(settings_for_copy[0].changed_key, "*hydration*");

    assert_eq!(
        result
            .print_settings_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str)
            .count(),
        1,
        "copy must emit one PrintSettingsChange",
    );
    assert_eq!(
        result
            .scroll_position_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str)
            .count(),
        1,
        "copy must emit one ScrollPositionChange",
    );
}

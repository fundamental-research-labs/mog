//! Tests that blank-workbook bootstrap and settle_for_mirror both emit
//! hydration-shape MutationResults (the same shape as XLSX/CSV import).

use super::super::*;

#[test]
fn create_default_sheet_emits_hydration_shape_settings() {
    use snapshot_types::WorkbookSnapshot;

    let (mut engine, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let (_hex, result) = engine
        .create_default_sheet("Sheet1")
        .expect("bootstrap should succeed");

    // Must have at least one SheetSettingsChange with the hydration sentinel.
    assert!(
        !result.settings_changes.is_empty(),
        "bootstrap must emit SheetSettingsChange — got none"
    );
    let hydration_settings = result
        .settings_changes
        .iter()
        .find(|c| c.changed_key == "*hydration*");
    assert!(
        hydration_settings.is_some(),
        "bootstrap must emit SheetSettingsChange with changed_key='*hydration*'"
    );
    let settings_json = &hydration_settings.unwrap().settings;
    assert!(
        settings_json.is_object(),
        "hydration settings must be a JSON object"
    );
    let settings_obj = settings_json.as_object().unwrap();
    assert!(
        settings_obj.contains_key("showGridlines"),
        "hydration settings must contain showGridlines"
    );
    assert!(
        settings_obj.contains_key("defaultRowHeight"),
        "hydration settings must contain defaultRowHeight"
    );

    // Must have a WorkbookSettingsChange.
    assert!(
        !result.workbook_settings_changes.is_empty(),
        "bootstrap must emit WorkbookSettingsChange — got none"
    );
    let wb_change = &result.workbook_settings_changes[0];
    assert_eq!(wb_change.kind, crate::snapshot::ChangeKind::Set);
    assert!(
        !wb_change.changed_keys.is_empty(),
        "WorkbookSettingsChange must enumerate changed keys"
    );
    let wb_settings = wb_change.settings.as_object().unwrap();
    assert!(
        wb_settings.contains_key("culture") || wb_settings.contains_key("showHorizontalScrollbar"),
        "workbook settings must contain at least one known key"
    );
}

#[test]
fn create_default_sheet_still_bypasses_undo_stack() {
    use snapshot_types::WorkbookSnapshot;

    let (mut engine, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let _ = engine.create_default_sheet("Sheet1").unwrap();
    assert!(
        !engine.can_undo(),
        "bootstrap with hydration-shape result must NOT enter undo stack"
    );
}

#[test]
fn settle_for_mirror_returns_hydration_shape() {
    use snapshot_types::WorkbookSnapshot;

    let (mut engine, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    // Create a sheet first so settle has something to enumerate.
    let _ = engine.create_default_sheet("Sheet1").unwrap();

    let (_patches, result) = engine.settle_for_mirror().expect("settle should succeed");

    // Same assertions as bootstrap: full hydration shape.
    assert!(
        !result.settings_changes.is_empty(),
        "settle must emit SheetSettingsChange"
    );
    assert!(
        result
            .settings_changes
            .iter()
            .any(|c| c.changed_key == "*hydration*"),
        "settle must include hydration sentinel"
    );
    assert!(
        !result.workbook_settings_changes.is_empty(),
        "settle must emit WorkbookSettingsChange"
    );

    // Print settings should be present (always emitted even for defaults).
    assert!(
        !result.print_settings_changes.is_empty(),
        "settle must emit PrintSettingsChange"
    );

    // Scroll position should be present.
    assert!(
        !result.scroll_position_changes.is_empty(),
        "settle must emit ScrollPositionChange"
    );
}

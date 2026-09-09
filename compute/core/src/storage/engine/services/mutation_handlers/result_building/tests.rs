use crate::snapshot::{ChangeKind as SnapChangeKind, SheetChangeField, WorkbookSettingsChange};
use crate::storage::engine::ComputeEngine;
use cell_types::SheetId;
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn empty_snapshot_with_one_sheet() -> WorkbookSnapshot {
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

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

#[test]
fn hydration_emits_store_backed_families_with_populated_payloads() {
    // Build engine, mutate state to non-defaults, then call the
    // hydration builder directly to exercise the cold-load path.
    let (mut engine, _) =
        ComputeEngine::from_snapshot(empty_snapshot_with_one_sheet()).expect("from_snapshot");
    let sid = sheet_id();

    // Establish non-default values across cell_store-backed families.
    engine
        .set_view_option(&sid, "showGridlines", false)
        .expect("set_view_option");
    engine
        .set_frozen_panes(&sid, 3, 2)
        .expect("set_frozen_panes");
    engine
        .set_tab_color(&sid, Some("#00FF00".into()))
        .expect("set_tab_color");

    let recalc = crate::snapshot::RecalcResult::empty();
    let result = engine.with_internals_for_test(|stores, cell_store| {
        super::build_mutation_result_for_hydration(stores, cell_store, recalc)
    });

    // 1. SheetChange families on hydration must use Set (not Created).
    for sc in &result.sheet_changes {
        assert!(
            matches!(sc.kind, SnapChangeKind::Set | SnapChangeKind::Removed),
            "hydration SheetChange.kind must be Set or Removed (was {:?})",
            sc.kind
        );
    }

    // 2. Frozen change must be populated (not just discriminator).
    let frozen = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Frozen)
        .expect("expected Frozen SheetChange on hydration");
    assert_eq!(frozen.frozen_rows, Some(3));
    assert_eq!(frozen.frozen_cols, Some(2));

    // 3. TabColor populated.
    let tab = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::TabColor)
        .expect("expected TabColor SheetChange on hydration");
    assert_eq!(tab.color.as_deref(), Some("#00FF00"));

    // 4. Name populated.
    let name = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Name)
        .expect("expected Name SheetChange on hydration");
    assert_eq!(name.name.as_deref(), Some("Sheet1"));

    // 5. Order populated.
    let order = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Order)
        .expect("expected Order SheetChange on hydration");
    assert_eq!(order.index, Some(0));

    // 5b. Canonical creation event: `field:Sheet, kind:Set` must be
    // emitted per registered sheet with both name and index populated.
    // Without it, the kernel cell_store's `sheetOrder` stays empty after
    // hydration — the per-field `Name`/`Order` arms only touch the
    // meta map and `Order`'s move arm requires `oldIndex`. See
    // `kernel/src/document/state-cell_store.ts:applySheetChange`.
    let sheet_create = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Sheet)
        .expect("expected Sheet SheetChange on hydration");
    assert_eq!(sheet_create.kind, SnapChangeKind::Set);
    assert_eq!(sheet_create.sheet_id, sid.to_uuid_string());
    assert_eq!(sheet_create.name.as_deref(), Some("Sheet1"));
    assert_eq!(sheet_create.index, Some(0));

    // 6. Per-sheet settings — full snapshot (sentinel changed_key).
    let settings = result
        .settings_changes
        .iter()
        .find(|s| s.sheet_id == sid.to_uuid_string())
        .expect("expected SheetSettingsChange on hydration");
    assert_eq!(settings.changed_key, "*hydration*");
    assert_eq!(settings.kind, SnapChangeKind::Set);
    let show = settings
        .settings
        .get("showGridlines")
        .and_then(|v| v.as_bool())
        .expect("settings.showGridlines key");
    assert!(!show, "hydration must reflect post-mutation showGridlines");

    // 7. Workbook-level settings emitted exactly once with all keys.
    assert_eq!(
        result.workbook_settings_changes.len(),
        1,
        "hydration must emit one WorkbookSettingsChange, got {:?}",
        result.workbook_settings_changes
    );
    let WorkbookSettingsChange {
        kind,
        changed_keys,
        settings: wb_settings,
    } = &result.workbook_settings_changes[0];
    assert_eq!(*kind, SnapChangeKind::Set);
    assert!(
        !changed_keys.is_empty(),
        "WorkbookSettingsChange.changed_keys must enumerate settings on hydration"
    );
    assert!(
        wb_settings.is_object(),
        "WorkbookSettingsChange.settings must be a serialized object"
    );

    // 8. Print settings always emitted (defaults populate the cell store).
    assert!(
        !result.print_settings_changes.is_empty(),
        "hydration must emit print_settings_changes"
    );
    // 9. Scroll position always emitted.
    assert!(
        !result.scroll_position_changes.is_empty(),
        "hydration must emit scroll_position_changes"
    );
}

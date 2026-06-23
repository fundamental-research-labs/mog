use super::*;
use crate::snapshot::{
    ChangeKind as SnapChangeKind, MutationResult, SheetChangeField, WorkbookSettingsChange,
};
use crate::storage::engine::YrsComputeEngine;
use cell_types::SheetId;
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn empty_snapshot_with_one_sheet() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
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

/// Build a (peer_a, peer_b) pair seeded from the same yrs state.
/// Peer B is born from A's full state; both share CellIds + history,
/// so subsequent yrs deltas from A apply cleanly to B.
fn build_collab_pair() -> (YrsComputeEngine, YrsComputeEngine) {
    let (engine_a, _) =
        YrsComputeEngine::from_snapshot(empty_snapshot_with_one_sheet()).expect("A from_snapshot");
    let empty_sv = {
        use yrs::updates::encoder::Encode;
        yrs::StateVector::default().encode_v1()
    };
    let full_state = engine_a
        .encode_diff(&empty_sv)
        .expect("A encode_diff(empty)");
    let (engine_b, _) = YrsComputeEngine::from_yrs_state(&full_state).expect("B from_yrs_state");
    (engine_a, engine_b)
}

fn ship_delta(a: &mut YrsComputeEngine, b: &mut YrsComputeEngine) -> MutationResult {
    let b_sv = b.encode_state_vector();
    let delta = a.encode_diff(&b_sv).expect("A encode_diff(B.sv)");
    let (_patches, result) = b
        .apply_sync_update_legacy(&delta)
        .expect("B apply_sync_update");
    result
}

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

// ------------------------------------------------------------------
// Gap A.2 — Sync rebuild routes settings state through the hydration
// `SheetSettingsChange` sentinel with the post-mutation full settings blob.
// ------------------------------------------------------------------
#[test]
fn sync_rebuild_emits_settings_hydration_for_remote_show_gridlines_toggle() {
    let (mut engine_a, mut engine_b) = build_collab_pair();
    let sid = sheet_id();

    // Peer A: toggle showGridlines off.
    engine_a
        .set_view_option(&sid, "showGridlines", false)
        .expect("A set_view_option");

    // Peer B applies A's delta. Sync intentionally rebuilds from Yrs state
    // instead of trusting observer events, so the returned settings change
    // is hydration-shaped rather than a per-key observer delta.
    let result = ship_delta(&mut engine_a, &mut engine_b);

    let settings_change = result
        .settings_changes
        .iter()
        .find(|s| s.sheet_id == sid.to_uuid_string())
        .expect("settings_changes must contain the sheet settings entry");
    assert_eq!(settings_change.sheet_id, sid.to_uuid_string());
    assert_eq!(settings_change.kind, SnapChangeKind::Set);
    assert_eq!(settings_change.changed_key, "*hydration*");
    // Full settings snapshot must be populated and must reflect the
    // post-mutation value (showGridlines=false).
    let show = settings_change
        .settings
        .get("showGridlines")
        .and_then(|v| v.as_bool())
        .expect("showGridlines key on settings blob");
    assert!(!show, "post-state showGridlines must be false");

    assert!(
        result
            .sheet_changes
            .iter()
            .any(|sc| sc.field == SheetChangeField::Sheet && sc.sheet_id == sid.to_uuid_string()),
        "sync rebuild must include the hydration sheet entry"
    );
}

// ------------------------------------------------------------------
// Gap A.1 — Frozen-key normalization for raw "frozenRows"/"frozenCols".
// ------------------------------------------------------------------
#[test]
fn observer_translation_emits_frozen_change_for_remote_freeze_toggle() {
    let (mut engine_a, mut engine_b) = build_collab_pair();
    let sid = sheet_id();

    engine_a
        .set_frozen_panes(&sid, 2, 1)
        .expect("A set_frozen_panes");

    let result = ship_delta(&mut engine_a, &mut engine_b);

    // The observer fires twice (one for `frozenRows`, one for
    // `frozenCols`). Both must normalize to `SheetChangeField::Frozen`
    // with the post-state counts.
    let frozen_changes: Vec<_> = result
        .sheet_changes
        .iter()
        .filter(|s| s.field == SheetChangeField::Frozen)
        .collect();
    assert!(
        !frozen_changes.is_empty(),
        "expected at least one Frozen SheetChange; got sheet_changes = {:?}",
        result.sheet_changes
    );
    for sc in &frozen_changes {
        assert_eq!(sc.sheet_id, sid.to_uuid_string());
        assert_eq!(sc.frozen_rows, Some(2));
        assert_eq!(sc.frozen_cols, Some(1));
    }
}

// ------------------------------------------------------------------
// Gap A — populated payload tests for remote sheet-meta edits.
// ------------------------------------------------------------------
#[test]
fn observer_translation_emits_populated_rename() {
    let (mut engine_a, mut engine_b) = build_collab_pair();
    let sid = sheet_id();

    engine_a
        .rename_compute_sheet(&sid, "Renamed")
        .expect("A rename_sheet");

    let result = ship_delta(&mut engine_a, &mut engine_b);

    let sc = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Name)
        .expect("expected Name SheetChange");
    assert_eq!(sc.sheet_id, sid.to_uuid_string());
    assert_eq!(sc.name.as_deref(), Some("Renamed"));
}

#[test]
fn sync_rebuild_emits_populated_visibility_for_hidden() {
    let (mut engine_a, mut engine_b) = build_collab_pair();
    let sid = sheet_id();

    engine_a.set_sheet_hidden(&sid, true).expect("A set_hidden");
    let result = ship_delta(&mut engine_a, &mut engine_b);

    let sc = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Visibility)
        .expect("expected Visibility SheetChange");
    assert_eq!(sc.hidden, Some(true));
}

#[test]
fn observer_translation_emits_populated_visibility() {
    let (mut engine_a, mut engine_b) = build_collab_pair();
    let sid = sheet_id();

    engine_a
        .set_sheet_visibility(&sid, "veryHidden")
        .expect("A set_visibility");
    let result = ship_delta(&mut engine_a, &mut engine_b);

    let sc = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::Visibility)
        .expect("expected Visibility SheetChange");
    assert_eq!(sc.hidden, Some(true));
}

#[test]
fn observer_translation_emits_populated_tab_color() {
    let (mut engine_a, mut engine_b) = build_collab_pair();
    let sid = sheet_id();

    engine_a
        .set_tab_color(&sid, Some("#FF0000".into()))
        .expect("A set_tab_color");
    let result = ship_delta(&mut engine_a, &mut engine_b);

    let sc = result
        .sheet_changes
        .iter()
        .find(|s| s.field == SheetChangeField::TabColor)
        .expect("expected TabColor SheetChange");
    assert_eq!(sc.color.as_deref(), Some("#FF0000"));
}

// NOTE on Order coverage:
//
// The plan lists `order` in the populated-payload set, but the
// `SheetChangeField::Order` branch in `build_mutation_result_from_changes`
// reads from `changes.sheet_meta` with `field == "order"` — and the
// production observer path never writes a top-level `"order"` key
// into per-sheet meta. Sheet ordering is stored as a workbook-scoped
// YArray (KEY_SHEET_ORDER), which the observer surfaces as a
// `structural_changes` entry, not a `sheet_meta` change. The Order
// arm is reachable only by a synthetic test that injects a
// `SheetMetaChange { field: Some("order".into()), ... }` directly,
// which would test the unit logic of the arm without exercising any
// realistic pipeline. Hydration coverage already verifies that
// `SheetChangeField::Order` lands with a populated `index` on the
// cold-load path (`hydration_emits_mirror_backed_families_with_populated_payloads`).

// ------------------------------------------------------------------
// Gap C — Hydration emits mirror-backed direct-state families with
// populated payloads; uses Set | Removed only.
// ------------------------------------------------------------------
#[test]
fn hydration_emits_mirror_backed_families_with_populated_payloads() {
    // Build engine, mutate state to non-defaults, then call the
    // hydration builder directly to exercise the cold-load path.
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(empty_snapshot_with_one_sheet()).expect("from_snapshot");
    let sid = sheet_id();

    // Establish non-default values across mirror-backed families.
    engine
        .set_view_option(&sid, "showGridlines", false)
        .expect("set_view_option");
    engine
        .set_frozen_panes(&sid, 3, 2)
        .expect("set_frozen_panes");
    engine
        .set_tab_color(&sid, Some("#00FF00".into()))
        .expect("set_tab_color");

    // Drain pending observer effects so subsequent hydration sees a
    // settled engine state (mirrors the production hydration path).
    let recalc = crate::snapshot::RecalcResult::empty();
    let result = engine.with_internals_for_test(|stores, mirror, _| {
        super::build_mutation_result_for_hydration(stores, mirror, recalc)
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
    // Without it, the kernel mirror's `sheetOrder` stays empty after
    // hydration — the per-field `Name`/`Order` arms only touch the
    // meta map and `Order`'s move arm requires `oldIndex`. See
    // `kernel/src/document/state-mirror.ts:applySheetChange`.
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

    // 8. Print settings always emitted (defaults populate the mirror).
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

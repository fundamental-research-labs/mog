//! Tests pinning the contract that every "introduce a sheet
//! to observable state" handler — bootstrap, user-edit add, and copy —
//! flows through `build_sheet_hydration_changes` and emits the full
//! per-sheet hydration shape, not the slim "creation event only" shape
//! that left eight of nine per-sheet mirror dimensions uninitialized.
//!
//! Bootstrap byte-for-byte coverage lives in
//! `test_bootstrap_hydration.rs` and the inline
//! `hydration_emits_mirror_backed_families_with_populated_payloads` test
//! in `result_building.rs`. This file covers the user-edit add and copy
//! paths specifically.

use super::super::*;
use crate::snapshot::{ChangeKind, SheetChangeField};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn workbook_with_one_sheet() -> WorkbookSnapshot {
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

// ---------------------------------------------------------------------------
// Test 1 — user-edit add emits the full per-sheet hydration shape
// ---------------------------------------------------------------------------

#[test]
fn user_edit_sheet_add_emits_full_per_sheet_families() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_one_sheet()).expect("from_snapshot");

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
    // This is the actual mirror-drift closure. Without this emit, the TS
    // mirror's `settingsBySheet[newId]` falls back to DEFAULT_SHEET_SETTINGS
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
// The slim shape used to emit zero CommentChange / CfChange / etc. for a
// copied sheet, even though `copy_sheet` deep-clones the sub-maps under
// the new sheet's Yrs node. After unification, every per-sheet projection
// that the source carries appears on the copy because the helper reads
// from Yrs/storage with the new sheet_id.
//
// Workbook-scoped projections (tables — keyed under `workbook/tables` not
// per-sheet — and pivots/slicers/named ranges) are NOT deep-cloned by
// `copy_sheet` and therefore intentionally do not appear in this test.
// That's a separate latent bug in the copy-sheet flow itself; surfacing
// it via TableChange would require a different fix and is out of scope.
//
// This test pins:
//   - source_sheet_id provenance threading on the canonical creation event,
//   - per-sheet hydration shape on the copy (settings, print settings,
//     scroll position),
//   - per-sheet CF rules deep-cloned via Yrs flow through the helper.

#[test]
fn copy_sheet_emits_source_projections_on_target() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_one_sheet()).expect("from_snapshot");
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

    // ----- Bug closure: per-sheet CF rules arrive at TS via the helper -----
    //
    // Pre-unification, the slim shape emitted zero CfChange for the new
    // sheet, even though `copy_sheet` deep-clones the sheet's
    // conditionalFormat sub-map in Yrs. The mirror only saw the cloned
    // rules if a later mutation happened to re-emit. Now they appear at
    // copy time because the helper reads from Yrs storage with the new
    // sheet_id.
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

// ---------------------------------------------------------------------------
// Test 3 — observer-driven undo of delete-sheet re-emits the full hydration shape
// ---------------------------------------------------------------------------
//
// When the user deletes a sheet and then presses Cmd+Z, the Yrs UndoManager
// replays the inverse Yrs operations (re-inserting the sheet's sub-map),
// which fires the observer with `sheet_additions = [restored_sheet_id]`.
// `apply_observer_changes_with_patches` then calls
// `build_mutation_result_from_changes` to convert the observer record into
// a `MutationResult`.
//
// Pre-fix, that builder emitted nothing for `sheet_additions` —
// the kernel mirror never received a `SheetChange{field:Sheet,kind:Set}`
// for the restored sheet, and `snapshot.sheetNames` did not include it.
// This is the fourth "introduce a sheet to observable state" call site,
// architecturally identical to the three sync-paint/09 fixed.
//
// This test pins the contract that observer-driven undo restores the sheet
// to the kernel mirror in the same shape as bootstrap / user-edit add /
// copy: a canonical creation event plus the per-sheet hydration families.

#[test]
fn observer_undo_of_delete_sheet_emits_full_hydration_shape() {
    use cell_types::SheetId;

    let workbook = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "660e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet2".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook).expect("from_snapshot");
    let sheet2_sid =
        SheetId::from_uuid_str("660e8400-e29b-41d4-a716-446655440000").expect("Sheet2 SheetId");

    // Tick the undo timer past the merge window so a subsequent edit
    // produces a fresh undo entry. (Yrs UndoManager merges captures
    // within a configurable window; spreadsheet tests in this repo
    // ratchet via small writes between operations, but here we rely
    // on the engine harness — `delete_sheet` should be its own undo
    // entry by default.)

    // Delete Sheet2 via the user-edit path; this emits the slim
    // `SheetChange { Removed, Sheet }` that sync-paint/09 left untouched.
    let (_, _delete_result) = engine.delete_sheet(&sheet2_sid).expect("delete_sheet");

    // Undo. The undo manager replays inverse Yrs operations, which fires
    // the observer with `sheet_additions = [Sheet2]` (and a flurry of
    // sheet_meta changes for the restored fields). The flow under test:
    //   undo() → apply_observer_changes_with_patches()
    //         → apply_all_observer_changes() (in-engine state rebuild)
    //         → build_mutation_result_from_changes() (← our fix)
    let (_patches, undo_result) = engine.undo().expect("undo");

    let sheet2_uuid_str = sheet2_sid.to_uuid_string();

    // ----- Canonical creation event for the restored sheet -----
    let creation_events: Vec<_> = undo_result
        .sheet_changes
        .iter()
        .filter(|c| {
            c.sheet_id == sheet2_uuid_str
                && c.field == SheetChangeField::Sheet
                && c.kind == ChangeKind::Set
        })
        .collect();
    assert_eq!(
        creation_events.len(),
        1,
        "expected exactly one SheetChange{{field:Sheet,kind:Set}} for the restored sheet, \
         got {} (sheet_changes = {:?})",
        creation_events.len(),
        undo_result.sheet_changes,
    );
    let creation = creation_events[0];
    assert_eq!(creation.name.as_deref(), Some("Sheet2"));
    assert_eq!(
        creation.source_sheet_id, None,
        "observer-driven restore is not a copy — source_sheet_id must be None",
    );

    // ----- The fix's load-bearing claim: per-sheet settings emit -----
    //
    // Without this, `snapshot.sheetNames` may include the restored sheet
    // (if the per-field meta loop happened to emit `Name`) but the
    // `mirror-matches-rust` invariant fails on `settingsBySheet[sheet2]`
    // because the TS-side default disagrees with Rust's wire shape.
    let settings_events: Vec<_> = undo_result
        .settings_changes
        .iter()
        .filter(|c| c.sheet_id == sheet2_uuid_str && c.changed_key == "*hydration*")
        .collect();
    assert_eq!(
        settings_events.len(),
        1,
        "expected one SheetSettingsChange{{*hydration*}} for the restored sheet, \
         got {} (settings_changes = {:?})",
        settings_events.len(),
        undo_result.settings_changes,
    );

    // ----- PrintSettings + ScrollPosition emitted -----
    assert_eq!(
        undo_result
            .print_settings_changes
            .iter()
            .filter(|c| c.sheet_id == sheet2_uuid_str)
            .count(),
        1,
        "expected one PrintSettingsChange for the restored sheet",
    );
    assert_eq!(
        undo_result
            .scroll_position_changes
            .iter()
            .filter(|c| c.sheet_id == sheet2_uuid_str)
            .count(),
        1,
        "expected one ScrollPositionChange for the restored sheet",
    );
}

// ---------------------------------------------------------------------------
// Test 4 — observer-driven redo of create-sheet emits full hydration shape
// ---------------------------------------------------------------------------
//
// Direct create_sheet suppresses its forward observer events so the direct
// mutation result stays authoritative, but the Yrs operation must still enter
// the undo stack. On redo, the observer reintroduces the sheet, so it must emit
// the same full per-sheet hydration families as any other sheet-introduction
// path.

#[test]
fn observer_redo_of_create_sheet_emits_full_hydration_shape() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_one_sheet()).expect("from_snapshot");

    let (new_hex, _create_result) = engine.create_sheet("Sheet2").expect("create_sheet");
    let raw = compute_document::hex::hex_to_id(&new_hex).expect("sheet hex should parse");
    let new_sid =
        cell_types::SheetId::from_uuid_str(&cell_types::CellId::from_raw(raw).to_uuid_string())
            .expect("sheet id");
    let new_sid_str = new_sid.to_uuid_string();

    let (_patches, undo_result) = engine.undo().expect("undo create_sheet");
    assert!(
        undo_result.sheet_changes.iter().any(|c| {
            c.sheet_id == new_sid_str
                && c.field == SheetChangeField::Sheet
                && c.kind == ChangeKind::Removed
        }),
        "undo of create_sheet must emit a lifecycle removal for the created sheet; got {:?}",
        undo_result.sheet_changes,
    );

    let (_patches, redo_result) = engine.redo().expect("redo create_sheet");
    assert!(
        redo_result.sheet_changes.iter().any(|c| {
            c.sheet_id == new_sid_str
                && c.field == SheetChangeField::Sheet
                && c.kind == ChangeKind::Set
                && c.name.as_deref() == Some("Sheet2")
        }),
        "redo of create_sheet must emit the canonical lifecycle creation; got {:?}",
        redo_result.sheet_changes,
    );
    assert!(
        redo_result
            .settings_changes
            .iter()
            .any(|c| c.sheet_id == new_sid_str && c.changed_key == "*hydration*"),
        "redo of create_sheet must emit sheet settings hydration; got {:?}",
        redo_result.settings_changes,
    );
    assert_eq!(
        redo_result
            .print_settings_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str)
            .count(),
        1,
        "redo of create_sheet must emit one PrintSettingsChange",
    );
    assert_eq!(
        redo_result
            .scroll_position_changes
            .iter()
            .filter(|c| c.sheet_id == new_sid_str)
            .count(),
        1,
        "redo of create_sheet must emit one ScrollPositionChange",
    );
}

// ---------------------------------------------------------------------------
// Test 5 — observer-driven sheet deletion emits SheetChange{Removed,Sheet}
// ---------------------------------------------------------------------------
//
// `mutation_delete_sheet` itself emits the slim Removed shape directly; the
// observer-driven path is exercised when delete-undo-redo is replayed (or
// when a remote peer's delete arrives via `apply_sync_update`). In those
// cases `build_mutation_result_from_changes` must emit
// `SheetChange{Removed, Sheet}` so the receiving mirror calls
// `dropSheet(sid)` and clears all per-sheet maps. Symmetric with test 3.
//
// We drive this end-to-end via delete → undo → redo. The final redo step
// replays the delete via the Yrs observer, which fires
// `sheet_deletions = [Sheet2]` and reaches the builder under test.

#[test]
fn observer_redo_of_delete_emits_removed_sheet_change() {
    use cell_types::SheetId;

    let workbook = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "660e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet2".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook).expect("from_snapshot");
    let sheet2_sid =
        SheetId::from_uuid_str("660e8400-e29b-41d4-a716-446655440000").expect("Sheet2 SheetId");

    // delete → undo → redo. The redo replays the delete via the Yrs
    // observer; the resulting MutationResult is what the kernel mirror
    // sees in the cross-sheet-ref-breaks-on-delete app-eval scenario when
    // a future redo (after the undo we tested in test 3) runs.
    let _ = engine.delete_sheet(&sheet2_sid).expect("delete_sheet");
    let _ = engine.undo().expect("undo");
    let (_patches, redo_result) = engine.redo().expect("redo");

    let sheet2_uuid_str = sheet2_sid.to_uuid_string();
    let removed: Vec<_> = redo_result
        .sheet_changes
        .iter()
        .filter(|c| {
            c.kind == ChangeKind::Removed
                && c.field == SheetChangeField::Sheet
                && c.sheet_id == sheet2_uuid_str
        })
        .collect();
    assert_eq!(
        removed.len(),
        1,
        "redo of delete must emit exactly one SheetChange{{Removed,Sheet}} for the dropped \
         sheet (got {} from sheet_changes = {:?})",
        removed.len(),
        redo_result.sheet_changes,
    );
}

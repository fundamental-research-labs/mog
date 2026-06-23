//! Sync `MutationResult` propagation coverage.

use super::super::*;
use super::helpers::*;
use super::sync_helpers::*;
use cell_types::CellId;
use domain_types::{CellFormat, domain::comment::CommentType};
use snapshot_types::{Axis, ChangeKind, MutationResult, SheetChangeField, StructureChangeType};
use value_types::CellValue;

// ===================================================================
// Sync MutationResult propagation tests
//
// These tests verify that `rebuild_from_yrs_after_sync` populates the
// expected MutationResult fields when a remote peer's changes are applied
// via `apply_sync_update`. Collaboration-shaped tests use the two-engine
// pattern:
//   1. Engines A and B fork from one authoritative Yrs baseline
//   2. Engine A performs a mutation
//   3. Encode A->B diff via state vectors
//   4. Engine B applies the sync update
//   5. Assert the returned MutationResult contains the expected change shape
// ===================================================================

fn authored_test_cell_id(offset: u128) -> CellId {
    CellId::from_raw(0x9000_0000_0000_4000_8000_0000_0000_0000 + offset)
}

fn find_authored_change<'a>(
    result: &'a MutationResult,
    cell_id: CellId,
) -> Option<&'a snapshot_types::CellChange> {
    let cell_id = cell_id.to_uuid_string();
    result
        .authored_cell_changes
        .iter()
        .find(|change| change.cell_id == cell_id)
}

fn find_recalc_change<'a>(
    result: &'a MutationResult,
    cell_id: CellId,
) -> Option<&'a snapshot_types::CellChange> {
    let cell_id = cell_id.to_uuid_string();
    result
        .recalc
        .changed_cells
        .iter()
        .find(|change| change.cell_id == cell_id)
}

// -------------------------------------------------------------------
// Authored cell changes
// -------------------------------------------------------------------

#[test]
fn sync_authored_cell_changes_report_remote_literal_write() {
    let a1 = authored_test_cell_id(1);
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        let a1 = authored_test_cell_id(1);
        engine_a
            .set_cell(
                sheet_id,
                a1,
                0,
                0,
                crate::bridge_types::CellInput::Parse { text: "42".into() },
            )
            .unwrap();
    });

    let change =
        find_authored_change(&result, a1).expect("remote literal write should be authored");
    assert_eq!(change.sheet_id, sheet_id.to_uuid_string());
    assert!(matches!(
        &change.position,
        Some(position) if position.row == 0 && position.col == 0
    ));
    assert_eq!(change.old_value, Some(CellValue::Null));
    assert_eq!(change.value, num(42.0));
    assert_eq!(change.old_formula, None);
    assert_eq!(change.new_formula, None);
}

#[test]
fn sync_authored_cell_changes_report_formula_text_edit_with_unchanged_value() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let a1 = authored_test_cell_id(1);
    let b1 = authored_test_cell_id(2);

    baseline
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "1".into() },
        )
        .unwrap();
    baseline
        .set_cell(
            &sheet_id,
            b1,
            0,
            1,
            crate::bridge_types::CellInput::Parse {
                text: "=A1+1".into(),
            },
        )
        .unwrap();

    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    engine_a
        .set_cell(
            &sheet_id,
            b1,
            0,
            1,
            crate::bridge_types::CellInput::Parse {
                text: "=A1*2".into(),
            },
        )
        .unwrap();

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);
    let change = find_authored_change(&result, b1).expect("remote formula edit should be authored");

    assert_eq!(change.old_value, Some(num(2.0)));
    assert_eq!(change.value, num(2.0));
    assert_eq!(change.old_formula.as_deref(), Some("=A1+1"));
    assert_eq!(change.new_formula.as_deref(), Some("=A1*2"));
}

#[test]
fn sync_authored_cell_changes_report_remote_clear() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let a1 = authored_test_cell_id(1);

    baseline
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "7".into() },
        )
        .unwrap();

    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    engine_a
        .set_cell(&sheet_id, a1, 0, 0, crate::bridge_types::CellInput::Clear)
        .unwrap();

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);
    let change = find_authored_change(&result, a1).expect("remote clear should be authored");

    assert!(matches!(
        &change.position,
        Some(position) if position.row == 0 && position.col == 0
    ));
    assert_eq!(change.old_value, Some(num(7.0)));
    assert_eq!(change.value, CellValue::Null);
    assert_eq!(change.old_formula, None);
    assert_eq!(change.new_formula, None);
}

#[test]
fn sync_authored_cell_changes_exclude_dependent_formula_recalculation() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let a1 = authored_test_cell_id(1);
    let b1 = authored_test_cell_id(2);

    baseline
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "1".into() },
        )
        .unwrap();
    baseline
        .set_cell(
            &sheet_id,
            b1,
            0,
            1,
            crate::bridge_types::CellInput::Parse {
                text: "=A1+1".into(),
            },
        )
        .unwrap();

    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    engine_a
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "2".into() },
        )
        .unwrap();

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        find_authored_change(&result, a1).is_some(),
        "direct remote literal edit should be authored; got {:?}",
        result.authored_cell_changes,
    );
    assert!(
        find_authored_change(&result, b1).is_none(),
        "dependent formula recalculation must not be authored; got {:?}",
        result.authored_cell_changes,
    );
    assert!(
        find_recalc_change(&result, b1).is_some(),
        "dependent formula recalculation must remain in recalc.changed_cells; got {:?}",
        result.recalc.changed_cells,
    );
}

#[test]
fn sync_authored_cell_changes_exclude_structural_position_shift() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let a1 = authored_test_cell_id(1);

    baseline
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "9".into() },
        )
        .unwrap();

    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    engine_a
        .structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertRows {
                at: 0,
                count: 1,
                new_row_ids: vec![],
            },
        )
        .unwrap();

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_eq!(
        engine_b.get_cell_value(&sheet_id, 1, 0),
        num(9.0),
        "sync should shift the authored cell down without rewriting its content"
    );
    assert!(
        result.authored_cell_changes.is_empty(),
        "row insertion shifts viewport/cell positions but must not be an authored cell edit; got {:?}",
        result.authored_cell_changes,
    );
    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::InsertRows)
                && change.count == 1
        }),
        "structural sync result should still report the row insert; got {:?}",
        result.structure_changes,
    );
}

#[test]
fn sync_authored_cell_changes_exclude_vacated_position_patch() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let a1 = authored_test_cell_id(1);

    baseline
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "17".into() },
        )
        .unwrap();

    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    engine_a
        .relocate_cells_yrs(&sheet_id, 0, 0, 0, 0, &sheet_id, 0, 2)
        .expect("relocate A1 to C1");

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_eq!(
        engine_b.get_cell_value(&sheet_id, 0, 0),
        CellValue::Null,
        "source position should be vacated after sync"
    );
    assert_eq!(
        engine_b.get_cell_value(&sheet_id, 0, 2),
        num(17.0),
        "destination position should receive the moved authored cell"
    );
    assert!(
        result.authored_cell_changes.is_empty(),
        "relocation may produce viewport clear/set patches, but must not report synthetic authored cell edits; got {:?}",
        result.authored_cell_changes,
    );
}

#[test]
fn sync_authored_cell_changes_exclude_format_only_viewport_patch() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let a1 = authored_test_cell_id(1);

    baseline
        .set_cell(
            &sheet_id,
            a1,
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "11".into() },
        )
        .unwrap();

    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    engine_a
        .set_format_for_ranges(
            &sheet_id,
            &[(0, 0, 0, 0)],
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_eq!(
        engine_b.get_cell_value(&sheet_id, 0, 0),
        num(11.0),
        "format-only sync should preserve the cell value"
    );
    assert_eq!(
        engine_b.get_resolved_format(&sheet_id, 0, 0).bold,
        Some(true),
        "format-only sync should still apply the visual format"
    );
    assert!(
        result.authored_cell_changes.is_empty(),
        "format-only viewport updates must not be authored cell edits; got {:?}",
        result.authored_cell_changes,
    );
}

// -------------------------------------------------------------------
// Sheet changes
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_create() {
    let (room_state, _) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    // Engine A creates a second sheet
    let (new_sheet_hex, _) = engine_a.create_sheet("Sheet2").unwrap();
    let new_sheet_id = SheetId::from_uuid_str(&new_sheet_hex).unwrap();

    // Sync A->B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_sheet_change(
        &result,
        &new_sheet_id,
        SheetChangeField::Sheet,
        ChangeKind::Set,
    );
    // Verify the new sheet is actually visible
    let all_sheets = engine_b.get_all_sheet_ids();
    assert_eq!(all_sheets.len(), 2, "engine B must see 2 sheets after sync");
    assert!(
        all_sheets.contains(&new_sheet_hex),
        "engine B must see the new sheet ID"
    );
}

#[test]
fn sync_propagates_sheet_delete() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let (_, _) = baseline.create_sheet("Sheet2").unwrap();
    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    assert_eq!(engine_b.get_all_sheet_ids().len(), 2);

    // Engine A deletes Sheet1
    engine_a.delete_sheet(&sheet_id).unwrap();

    // Sync A->B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::Sheet,
        ChangeKind::Removed,
    );
    assert_eq!(
        engine_b.get_all_sheet_ids().len(),
        1,
        "engine B must have 1 sheet after sync delete"
    );
}

#[test]
fn sync_propagates_sheet_rename() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .rename_compute_sheet(sheet_id, "RenamedSheet")
            .unwrap();
    });

    assert_sheet_change(&result, &sheet_id, SheetChangeField::Name, ChangeKind::Set);
}

#[test]
fn sync_propagates_sheet_reorder() {
    let (room_state, sheet1_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    let (sheet2_hex, _) = baseline.create_sheet("Sheet2").unwrap();
    let sheet1_hex = sheet1_id.to_uuid_string();
    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    // Engine A reorders sheets
    engine_a
        .reorder_sheets(vec![sheet2_hex.clone(), sheet1_hex.clone()])
        .unwrap();

    // Sync A->B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        result.sheet_changes.iter().any(|change| change.field == SheetChangeField::Order && change.kind == ChangeKind::Set),
        "sync must propagate sheet_reorder in MutationResult.sheet_changes; got {:?}",
        result.sheet_changes,
    );
}

#[test]
fn sync_propagates_sheet_hidden() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_sheet_hidden(sheet_id, true).unwrap();
    });

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::Visibility,
        ChangeKind::Set,
    );
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == sheet_id.to_uuid_string()
                && change.hidden == Some(true)),
        "sheet hidden payload must be true; got {:?}",
        result.sheet_changes,
    );
}

#[test]
fn sync_propagates_tab_color() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .set_tab_color(sheet_id, Some("#FF0000".to_string()))
            .unwrap();
    });

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::TabColor,
        ChangeKind::Set,
    );
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == sheet_id.to_uuid_string()
                && change.color.as_deref() == Some("#FF0000")),
        "tab color payload must be #FF0000; got {:?}",
        result.sheet_changes,
    );
}

#[test]
fn sync_propagates_freeze_panes() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_frozen_panes(sheet_id, 2, 1).unwrap();
    });

    assert_sheet_change(
        &result,
        &sheet_id,
        SheetChangeField::Frozen,
        ChangeKind::Set,
    );
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == sheet_id.to_uuid_string()
                && change.frozen_rows == Some(2)
                && change.frozen_cols == Some(1)),
        "freeze panes payload must be rows=2 cols=1; got {:?}",
        result.sheet_changes,
    );
}

// -------------------------------------------------------------------
// Dimension changes
// -------------------------------------------------------------------

#[test]
fn sync_propagates_row_height() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_row_height(sheet_id, 0, 40.0).unwrap();
    });

    assert!(
        result.dimension_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Row
                && change.index == 0
                && change.kind == ChangeKind::Set
                && change.size.is_some()
        }),
        "sync must propagate set_row_height in MutationResult.dimension_changes; got {:?}",
        result.dimension_changes,
    );
}

#[test]
fn sync_propagates_col_width() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.set_col_width(sheet_id, 0, 120.0).unwrap();
    });

    assert!(
        result.dimension_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Col
                && change.index == 0
                && change.kind == ChangeKind::Set
                && change.size.is_some()
        }),
        "sync must propagate set_col_width in MutationResult.dimension_changes; got {:?}",
        result.dimension_changes,
    );
}

// -------------------------------------------------------------------
// Structure changes
// -------------------------------------------------------------------

#[test]
fn sync_propagates_row_insert() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .structure_change(
                sheet_id,
                &formula_types::StructureChange::InsertRows {
                    at: 0,
                    count: 2,
                    new_row_ids: vec![],
                },
            )
            .unwrap();
    });

    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::InsertRows)
                && change.count == 2
        }),
        "sync must propagate row insert in MutationResult.structure_changes; got {:?}",
        result.structure_changes,
    );
}

#[test]
fn sync_propagates_col_delete() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .structure_change(
                sheet_id,
                &formula_types::StructureChange::DeleteCols {
                    at: 0,
                    count: 1,
                    deleted_cell_ids: vec![],
                },
            )
            .unwrap();
    });

    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::DeleteCols)
                && change.count == 1
        }),
        "sync must propagate col delete in MutationResult.structure_changes; got {:?}",
        result.structure_changes,
    );
}

// -------------------------------------------------------------------
// Visibility changes
// -------------------------------------------------------------------

#[test]
fn sync_propagates_hide_rows() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.hide_rows(sheet_id, &[0, 1]).unwrap();
    });

    assert!(
        result.visibility_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Row
                && change.index == 0
                && change.hidden
        }),
        "sync must propagate hide_rows in MutationResult.visibility_changes; got {:?}",
        result.visibility_changes,
    );
}

#[test]
fn sync_propagates_hide_columns() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.hide_columns(sheet_id, &[0]).unwrap();
    });

    assert!(
        result.visibility_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.axis == Axis::Col
                && change.index == 0
                && change.hidden
        }),
        "sync must propagate hide_columns in MutationResult.visibility_changes; got {:?}",
        result.visibility_changes,
    );
}

// -------------------------------------------------------------------
// Merge changes
// -------------------------------------------------------------------

#[test]
fn sync_propagates_merge() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a.merge_range(sheet_id, 0, 0, 1, 1).unwrap();
    });

    assert!(
        result.merge_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.kind == ChangeKind::Set
                && change.start_row == 0
                && change.start_col == 0
                && change.end_row == 1
                && change.end_col == 1
        }),
        "sync must propagate merge_range in MutationResult.merge_changes; got {:?}",
        result.merge_changes,
    );
}

#[test]
fn sync_propagates_unmerge() {
    let (room_state, sheet_id) = canonical_room_state();
    let mut baseline = fork_engine_from_state(&room_state);
    baseline.merge_range(&sheet_id, 0, 0, 1, 1).unwrap();
    let baseline_state = compute_collab::encode_full_state(baseline.storage().doc());
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&baseline_state);

    // Now unmerge on A
    engine_a.unmerge_range(&sheet_id, 0, 0, 1, 1).unwrap();

    // Sync unmerge A->B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        result.merge_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.kind == ChangeKind::Removed
                && change.start_row == 0
                && change.start_col == 0
                && change.end_row == 1
                && change.end_col == 1
        }),
        "sync must propagate unmerge_range in MutationResult.merge_changes; got {:?}",
        result.merge_changes,
    );
}

// -------------------------------------------------------------------
// Comments
// -------------------------------------------------------------------

#[test]
fn sync_propagates_comment() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .add_comment_by_position(
                sheet_id,
                0,
                0,
                "Hello from peer",
                "Alice",
                None,
                None,
                CommentType::Note,
            )
            .unwrap();
    });

    assert!(
        result.comment_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change.kind == ChangeKind::Set
                && matches!(&change.position, Some(pos) if pos.row == 0 && pos.col == 0)
        }),
        "sync must propagate add_comment in MutationResult.comment_changes; got {:?}",
        result.comment_changes,
    );
}

// -------------------------------------------------------------------
// Sheet settings
// -------------------------------------------------------------------

#[test]
fn sync_propagates_sheet_settings() {
    let (_, sheet_id, result) = sync_a_to_b(|engine_a, sheet_id| {
        engine_a
            .set_sheet_setting(sheet_id, "showGridLines", "false")
            .unwrap();
    });

    assert!(
        result.settings_changes.iter().any(|change| {
            change.sheet_id == sheet_id.to_uuid_string() && change.kind == ChangeKind::Set
        }),
        "sync must propagate set_sheet_setting in MutationResult.settings_changes; got {:?}",
        result.settings_changes,
    );
}

// -------------------------------------------------------------------
// Workbook settings
// -------------------------------------------------------------------

#[test]
fn sync_propagates_workbook_settings() {
    let (room_state, _) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    // Engine A changes a workbook setting
    engine_a
        .set_workbook_setting("iterativeCalc", serde_json::json!(true))
        .unwrap();

    // Sync A->B
    let result = sync_a_to_b_diff(&engine_a, &mut engine_b);

    assert!(
        result
            .workbook_settings_changes
            .iter()
            .any(|change| change.kind == ChangeKind::Set && !change.changed_keys.is_empty()),
        "sync must propagate set_workbook_setting in MutationResult.workbook_settings_changes; got {:?}",
        result.workbook_settings_changes,
    );
}

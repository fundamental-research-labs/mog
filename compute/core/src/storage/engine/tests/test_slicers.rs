//! Slicer mutation-result contract tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{SheetSnapshot, SlicerChangeKind, SlicerSourceType};
use compute_document::schema::KEY_SLICERS;
use domain_types::domain::slicer::{
    CrossFilterMode, SlicerSelectionChangeType, SlicerSortOrder, SlicerSource, SlicerStyle,
    StoredSlicer, StoredSlicerUpdate,
};
use value_types::{CellValue, ComputeError};
use yrs::{Map, Transact};

fn second_sheet_id() -> SheetId {
    SheetId::from_uuid_str("660e8400-e29b-41d4-a716-446655440000").unwrap()
}

fn two_sheet_snapshot() -> WorkbookSnapshot {
    let mut snapshot = simple_snapshot();
    snapshot.sheets.push(SheetSnapshot {
        id: second_sheet_id().to_uuid_string(),
        name: "Sheet2".to_string(),
        rows: 100,
        cols: 26,
        cells: vec![],
        ranges: vec![],
    });
    snapshot
}

fn table_slicer(id: &str) -> StoredSlicer {
    StoredSlicer {
        id: id.to_string(),
        sheet_id: sheet_id().to_uuid_string(),
        source: SlicerSource::Table {
            table_id: "table-1".to_string(),
            column_cell_id: "region".to_string(),
        },
        cache_name: None,
        cache_uid: None,
        caption: "Region".to_string(),
        name: Some("Region Slicer".to_string()),
        style: SlicerStyle {
            preset: None,
            custom: None,
            column_count: 1,
            button_height: 30,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
            custom_list_sort: true,
            show_items_with_no_data: true,
            sort_order: SlicerSortOrder::Ascending,
        },
        table_column_index: None,
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: None,
        level: 0,
        uid: None,
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: None,
        anchor_object_id: None,
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 0,
        locked: false,
        show_header: true,
        start_item: None,
        multi_select: true,
        selected_values: Vec::new(),
        created_at: None,
        updated_at: None,
    }
}

fn table_slicer_on(id: &str, owner: &SheetId) -> StoredSlicer {
    StoredSlicer {
        sheet_id: owner.to_uuid_string(),
        ..table_slicer(id)
    }
}

fn has_slicer_map(engine: &YrsComputeEngine) -> bool {
    let txn = engine.storage().doc().transact();
    engine
        .storage()
        .workbook_map()
        .get(&txn, KEY_SLICERS)
        .is_some()
}

fn assert_slicer_not_found(err: &ComputeError, sheet_id: &SheetId, slicer_id: &str) {
    assert!(
        matches!(
            err,
            ComputeError::SlicerNotFound {
                sheet_id: actual_sheet_id,
                slicer_id: actual_slicer_id,
            } if actual_sheet_id == &sheet_id.to_uuid_string() && actual_slicer_id == slicer_id
        ),
        "expected receiver-scoped SlicerNotFound, got {err:?}"
    );
}

fn assert_not_found_without_side_effects<F>(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    slicer_id: &str,
    operation: F,
) where
    F: FnOnce() -> Result<(Vec<u8>, crate::snapshot::MutationResult), ComputeError>,
{
    engine
        .drain_pending_updates()
        .expect("drain setup provider updates");
    let before_state_vector = engine.encode_state_vector();
    let before_undo = engine.get_undo_state();
    let before_dirty = engine.stores.compute.is_dirty();
    let before_map_presence = has_slicer_map(engine);
    let before_slicers = engine.get_all_slicers_workbook();

    let err = operation().expect_err("invalid slicer target must reject");
    assert_slicer_not_found(&err, sheet_id, slicer_id);
    assert_eq!(engine.encode_state_vector(), before_state_vector);
    assert_eq!(engine.get_undo_state().undo_depth, before_undo.undo_depth);
    assert_eq!(engine.get_undo_state().redo_depth, before_undo.redo_depth);
    assert_eq!(engine.stores.compute.is_dirty(), before_dirty);
    assert_eq!(has_slicer_map(engine), before_map_presence);
    assert_eq!(engine.get_all_slicers_workbook(), before_slicers);
    assert!(
        engine
            .drain_pending_updates()
            .expect("drain rejected provider updates")
            .is_empty(),
        "rejection must not enqueue a provider update"
    );
}

#[test]
fn slicer_crud_and_selection_emit_mutation_result_changes() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let (_patches, create_result) = engine
        .create_slicer(&sid, table_slicer("slicer-1"))
        .expect("create slicer");
    assert_eq!(create_result.slicer_changes.len(), 1);
    let create_change = &create_result.slicer_changes[0];
    assert_eq!(create_change.kind, SlicerChangeKind::Created);
    assert_eq!(create_change.source_type, Some(SlicerSourceType::Table));
    assert_eq!(create_change.source_id.as_deref(), Some("table-1"));
    assert_eq!(
        create_change.data.as_ref().map(|s| s.id.as_str()),
        Some("slicer-1")
    );

    let (_patches, update_result) = engine
        .update_slicer_config(
            &sid,
            "slicer-1",
            StoredSlicerUpdate {
                caption: Some("Region Updated".to_string()),
                name: None,
                style: None,
                position: None,
                z_index: Some(4),
                locked: None,
                show_header: None,
                start_item: None,
                multi_select: None,
                selected_values: None,
            },
        )
        .expect("update slicer");
    assert_eq!(update_result.slicer_changes.len(), 1);
    let update_change = &update_result.slicer_changes[0];
    assert_eq!(update_change.kind, SlicerChangeKind::Updated);
    assert_eq!(update_change.updated_fields, vec!["caption", "zIndex"]);
    assert_eq!(
        update_change.data.as_ref().map(|s| s.caption.as_str()),
        Some("Region Updated")
    );

    let (_patches, toggle_result) = engine
        .toggle_slicer_item(&sid, "slicer-1", CellValue::Text("West".into()))
        .expect("toggle slicer");
    let toggle_change = &toggle_result.slicer_changes[0];
    assert_eq!(toggle_change.kind, SlicerChangeKind::SelectionChanged);
    assert_eq!(
        toggle_change.selection_change_type,
        Some(SlicerSelectionChangeType::Toggle)
    );
    assert_eq!(
        toggle_change.selected_values,
        Some(vec![CellValue::Text("West".into())])
    );
    assert_eq!(
        toggle_change
            .data
            .as_ref()
            .map(|s| s.selected_values.as_slice()),
        Some([CellValue::Text("West".into())].as_slice())
    );

    let (_patches, clear_result) = engine
        .clear_slicer_selection(&sid, "slicer-1")
        .expect("clear slicer selection");
    let clear_change = &clear_result.slicer_changes[0];
    assert_eq!(clear_change.kind, SlicerChangeKind::SelectionChanged);
    assert_eq!(
        clear_change.selection_change_type,
        Some(SlicerSelectionChangeType::Clear)
    );
    assert_eq!(clear_change.selected_values, Some(Vec::new()));
    assert!(
        clear_change
            .data
            .as_ref()
            .expect("clear post-state")
            .selected_values
            .is_empty()
    );

    let (_patches, delete_result) = engine
        .delete_slicer(&sid, "slicer-1")
        .expect("delete slicer");
    let delete_change = &delete_result.slicer_changes[0];
    assert_eq!(delete_change.kind, SlicerChangeKind::Deleted);
    assert_eq!(delete_change.source_type, Some(SlicerSourceType::Table));
    assert_eq!(delete_change.source_id.as_deref(), Some("table-1"));
    assert_eq!(
        delete_change.data.as_ref().map(|s| s.id.as_str()),
        Some("slicer-1")
    );
}

#[test]
fn undo_slicer_creation_emits_deleted_change() {
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .create_slicer(&sid, table_slicer("slicer-1"))
        .expect("create slicer");

    let (_patches, undo_result) = engine.undo().expect("undo create slicer");

    assert_eq!(undo_result.slicer_changes.len(), 1);
    let change = &undo_result.slicer_changes[0];
    assert_eq!(change.kind, SlicerChangeKind::Deleted);
    assert_eq!(change.slicer_id, "slicer-1");
    assert_eq!(change.source_type, Some(SlicerSourceType::Table));
    assert_eq!(change.source_id.as_deref(), Some("table-1"));
}

#[test]
fn missing_targets_reject_without_creating_slicer_map_or_side_effects() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let missing = "missing-slicer";

    assert!(!has_slicer_map(&engine));
    assert_eq!(engine.get_slicer_state(&sid, missing), None);
    assert_not_found_without_side_effects(&engine, &sid, missing, || {
        engine.delete_slicer(&sid, missing)
    });
    assert_not_found_without_side_effects(&engine, &sid, missing, || {
        engine.update_slicer_config(
            &sid,
            missing,
            StoredSlicerUpdate {
                caption: Some("Nope".to_string()),
                name: None,
                style: None,
                position: None,
                z_index: None,
                locked: None,
                show_header: None,
                start_item: None,
                multi_select: None,
                selected_values: None,
            },
        )
    });
    assert_not_found_without_side_effects(&engine, &sid, missing, || {
        engine.toggle_slicer_item(&sid, missing, CellValue::Text("West".into()))
    });
    assert_not_found_without_side_effects(&engine, &sid, missing, || {
        engine.set_slicer_selection(&sid, missing, vec![CellValue::Text("West".into())])
    });
    assert_not_found_without_side_effects(&engine, &sid, missing, || {
        engine.clear_slicer_selection(&sid, missing)
    });
}

#[test]
fn wrong_sheet_targets_are_absent_and_all_strict_mutations_reject() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();
    let owner = sheet_id();
    let other = second_sheet_id();
    let slicer_id = "owned-slicer";
    engine
        .create_slicer(&owner, table_slicer_on(slicer_id, &owner))
        .unwrap();

    assert_eq!(engine.get_slicer_state(&other, slicer_id), None);
    assert!(engine.get_all_slicers(&other).is_empty());
    assert_not_found_without_side_effects(&engine, &other, slicer_id, || {
        engine.delete_slicer(&other, slicer_id)
    });
    assert_not_found_without_side_effects(&engine, &other, slicer_id, || {
        engine.update_slicer_config(
            &other,
            slicer_id,
            StoredSlicerUpdate {
                caption: Some("Wrong owner".to_string()),
                name: None,
                style: None,
                position: None,
                z_index: None,
                locked: None,
                show_header: None,
                start_item: None,
                multi_select: None,
                selected_values: None,
            },
        )
    });
    assert_not_found_without_side_effects(&engine, &other, slicer_id, || {
        engine.toggle_slicer_item(&other, slicer_id, CellValue::Text("West".into()))
    });
    assert_not_found_without_side_effects(&engine, &other, slicer_id, || {
        engine.set_slicer_selection(&other, slicer_id, vec![CellValue::Text("West".into())])
    });
    assert_not_found_without_side_effects(&engine, &other, slicer_id, || {
        engine.clear_slicer_selection(&other, slicer_id)
    });

    let (_, retry) = engine
        .set_slicer_selection(&owner, slicer_id, vec![CellValue::Text("West".into())])
        .expect("correct owner still works after rejection");
    assert_eq!(retry.slicer_changes.len(), 1);
    assert_eq!(
        retry.slicer_changes[0]
            .data
            .as_ref()
            .unwrap()
            .selected_values,
        vec![CellValue::Text("West".into())]
    );
}

#[test]
fn stale_targets_reject_after_successful_removal() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let slicer_id = "stale-slicer";
    engine.create_slicer(&sid, table_slicer(slicer_id)).unwrap();
    engine.delete_slicer(&sid, slicer_id).unwrap();

    assert_eq!(engine.get_slicer_state(&sid, slicer_id), None);
    assert_not_found_without_side_effects(&engine, &sid, slicer_id, || {
        engine.clear_slicer_selection(&sid, slicer_id)
    });
}

#[test]
fn create_rejects_duplicate_and_invalid_owner_without_side_effects() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();
    let owner = sheet_id();
    let other = second_sheet_id();
    let slicer_id = "unique-slicer";
    engine
        .create_slicer(&owner, table_slicer_on(slicer_id, &owner))
        .unwrap();
    engine.drain_pending_updates().unwrap();

    let before_state_vector = engine.encode_state_vector();
    let before_undo_depth = engine.get_undo_state().undo_depth;
    let original = engine.get_slicer_state(&owner, slicer_id).unwrap();
    let err = engine
        .create_slicer(&owner, table_slicer_on(slicer_id, &owner))
        .unwrap_err();
    assert!(matches!(
        err,
        ComputeError::SlicerIdConflict { slicer_id: id } if id == slicer_id
    ));
    assert_eq!(engine.encode_state_vector(), before_state_vector);
    assert_eq!(engine.get_undo_state().undo_depth, before_undo_depth);
    assert!(engine.drain_pending_updates().unwrap().is_empty());
    assert_eq!(
        engine.get_slicer_state(&owner, slicer_id),
        Some(original.clone())
    );

    let err = engine
        .create_slicer(&other, table_slicer_on(slicer_id, &other))
        .unwrap_err();
    assert!(matches!(
        err,
        ComputeError::SlicerIdConflict { slicer_id: id } if id == slicer_id
    ));
    assert_eq!(engine.get_slicer_state(&owner, slicer_id), Some(original));
    assert_eq!(engine.get_slicer_state(&other, slicer_id), None);
    assert!(engine.drain_pending_updates().unwrap().is_empty());

    let mut empty_owner = table_slicer("empty-owner");
    empty_owner.sheet_id.clear();
    let err = engine.create_slicer(&owner, empty_owner).unwrap_err();
    assert!(matches!(
        err,
        ComputeError::SlicerSheetMismatch {
            receiver_sheet_id,
            requested_sheet_id,
        } if receiver_sheet_id == owner.to_uuid_string() && requested_sheet_id.is_empty()
    ));

    let err = engine
        .create_slicer(&owner, table_slicer_on("wrong-owner", &other))
        .unwrap_err();
    assert!(matches!(
        err,
        ComputeError::SlicerSheetMismatch {
            receiver_sheet_id,
            requested_sheet_id,
        } if receiver_sheet_id == owner.to_uuid_string()
            && requested_sheet_id == other.to_uuid_string()
    ));
    assert!(engine.drain_pending_updates().unwrap().is_empty());

    let mut canonical_equivalent = table_slicer("canonical-owner");
    canonical_equivalent.sheet_id = uuid::Uuid::from_u128(owner.as_u128()).to_string();
    let (_, result) = engine
        .create_slicer(&owner, canonical_equivalent)
        .expect("equivalent dashed owner ID is accepted");
    assert_eq!(
        result.slicer_changes[0].data.as_ref().unwrap().sheet_id,
        owner.to_uuid_string()
    );
}

#[test]
fn generated_id_collision_retries_and_cross_sheet_source_is_allowed() {
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(two_sheet_snapshot()).unwrap();
    let owner = sheet_id();
    engine.stores.id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(42));
    let colliding_id = uuid::Uuid::from_u128(42).to_string();
    let expected_generated_id = uuid::Uuid::from_u128(43).to_string();
    engine
        .create_slicer(&owner, table_slicer(&colliding_id))
        .unwrap();

    let mut generated = table_slicer("");
    generated.source = SlicerSource::Table {
        table_id: "table-on-another-sheet".to_string(),
        column_cell_id: "region".to_string(),
    };
    let (_, result) = engine.create_slicer(&owner, generated).unwrap();
    let created = result.slicer_changes[0].data.as_ref().unwrap();
    assert_eq!(created.id, expected_generated_id);
    assert_eq!(created.sheet_id, owner.to_uuid_string());
    assert!(engine.get_slicer_state(&owner, &colliding_id).is_some());
    assert!(
        engine
            .get_slicer_state(&owner, &expected_generated_id)
            .is_some()
    );
}

#[test]
fn atomic_set_selection_emits_one_authoritative_post_state() {
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .create_slicer(&sid, table_slicer("slicer-1"))
        .unwrap();

    let values = vec![
        CellValue::Text("West".into()),
        CellValue::Text("East".into()),
    ];
    let (_, result) = engine
        .set_slicer_selection(&sid, "slicer-1", values.clone())
        .unwrap();
    assert_eq!(result.slicer_changes.len(), 1);
    let change = &result.slicer_changes[0];
    assert_eq!(change.kind, SlicerChangeKind::SelectionChanged);
    assert_eq!(
        change.selection_change_type,
        Some(SlicerSelectionChangeType::Select)
    );
    assert_eq!(change.selected_values, Some(values.clone()));
    assert_eq!(change.data.as_ref().unwrap().selected_values, values);
    assert_eq!(
        engine
            .get_slicer_state(&sid, "slicer-1")
            .unwrap()
            .selected_values,
        change.data.as_ref().unwrap().selected_values
    );
}

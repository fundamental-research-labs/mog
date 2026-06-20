//! Groups 1, 2, 5: Core engine / snapshot hydration, cell editing, accessors, debug.

use super::super::*;
use super::helpers::*;
use crate::engine_types::PivotCreateWithSheetOptions;
use crate::snapshot::{ChangeKind, SheetChangeField};
use cell_types::SheetId;
use formula_types::StructureChange;
use serde_json::json;
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Test 1: Create engine from snapshot, verify cells accessible
// -------------------------------------------------------------------

#[test]
fn test_from_snapshot_cells_accessible() {
    let snap = simple_snapshot();
    let (engine, recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1 = 10
    let a1 = engine.mirror().get_cell_value(&cell_id_a1());
    assert!(a1.is_some());
    assert_eq!(*a1.unwrap(), CellValue::Number(FiniteF64::must(10.0)));

    // B1 = 20
    let b1 = engine.mirror().get_cell_value(&cell_id_b1());
    assert!(b1.is_some());
    assert_eq!(*b1.unwrap(), CellValue::Number(FiniteF64::must(20.0)));

    // A2 = =A1+B1, which should compute to 30
    let a2_val = engine.mirror().get_cell_value(&cell_id_a2());
    assert!(a2_val.is_some());
    assert_eq!(*a2_val.unwrap(), CellValue::Number(FiniteF64::must(30.0)));

    // RecalcResult should contain the formula cell's computed value
    assert!(
        !recalc.changed_cells.is_empty(),
        "initial recalc should produce changes"
    );

    // GridIndex should have entries for the 3 cells
    let grid = engine.grid_index(&sheet_id());
    assert!(grid.is_some());
    let grid = grid.unwrap();
    assert_eq!(grid.cell_position(&cell_id_a1()), Some((0, 0)));
    assert_eq!(grid.cell_position(&cell_id_b1()), Some((0, 1)));
    assert_eq!(grid.cell_position(&cell_id_a2()), Some((1, 0)));
}

// -------------------------------------------------------------------
// Test 2: set_cell triggers recalc, formula updates
// -------------------------------------------------------------------

#[test]
fn test_set_cell_triggers_recalc() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Verify initial state: A2 = A1+B1 = 10+20 = 30
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a2()).unwrap(),
        CellValue::Number(FiniteF64::must(30.0))
    );

    // Change A1 from 10 to 50
    let result = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();

    // A2 should now be 50+20 = 70
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a2()).unwrap(),
        CellValue::Number(FiniteF64::must(70.0))
    );

    // The recalc result should include A2 as changed
    assert!(
        !result.1.recalc.changed_cells.is_empty(),
        "recalc should report changes"
    );

    // YrsStorage should also reflect the change
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(50.0))
    );
}

// -------------------------------------------------------------------
// Test 5: Structural change (insert rows) updates positions
// -------------------------------------------------------------------

#[test]
fn test_structure_change_insert_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Verify initial positions: A1 at (0,0), A2 at (1,0)
    let grid = engine.grid_index(&sid).unwrap();
    assert_eq!(grid.cell_position(&cell_id_a1()), Some((0, 0)));
    assert_eq!(grid.cell_position(&cell_id_a2()), Some((1, 0)));

    // Insert 2 rows at row 1 (between A1 and A2)
    let change = StructureChange::InsertRows {
        at: 1,
        count: 2,
        new_row_ids: vec![], // StructuralOps generates these
    };
    let result = engine.structure_change(&sid, &change);
    assert!(result.is_ok(), "structure_change should succeed");

    // A1 stays at (0,0), A2 moves from (1,0) to (3,0)
    let grid = engine.grid_index(&sid).unwrap();
    assert_eq!(grid.cell_position(&cell_id_a1()), Some((0, 0)));
    assert_eq!(grid.cell_position(&cell_id_a2()), Some((3, 0)));

    // Grid row count should increase
    assert_eq!(grid.row_count(), 102); // 100 + 2
}

#[test]
fn test_structure_change_insert_rows_auto_grows_sparse_axis() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    let change = StructureChange::InsertRows {
        at: 14,
        count: 1,
        new_row_ids: vec![],
    };
    let result = engine.structure_change(&sid, &change);
    assert!(
        result.is_ok(),
        "insert rows beyond the materialized row axis should grow blank row identities first: {result:?}"
    );

    let grid = engine.grid_index(&sid).unwrap();
    assert_eq!(grid.row_count(), 15);
    assert_eq!(grid.col_count(), 0);
    assert!(
        grid.row_id(14).is_some(),
        "the inserted row should have a resolvable row identity"
    );
}

#[test]
fn test_structure_change_insert_cols_auto_grows_sparse_axis() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    let change = StructureChange::InsertCols {
        at: 4,
        count: 2,
        new_col_ids: vec![],
    };
    let result = engine.structure_change(&sid, &change);
    assert!(
        result.is_ok(),
        "insert cols beyond the materialized column axis should grow blank column identities first: {result:?}"
    );

    let grid = engine.grid_index(&sid).unwrap();
    assert_eq!(grid.row_count(), 0);
    assert_eq!(grid.col_count(), 6);
    assert!(
        grid.col_id(5).is_some(),
        "the inserted columns should have resolvable column identities"
    );
}

// -------------------------------------------------------------------
// Test 7: Engine debug formatting
// -------------------------------------------------------------------

#[test]
fn test_engine_debug_format() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let debug = format!("{:?}", engine);
    assert!(debug.contains("YrsComputeEngine"));
    assert!(debug.contains("storage"));
}

#[test]
fn pivot_source_sheet_id_survives_sheet_rename() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    let sid_str = sid.to_uuid_string();

    let config = json!({
        "id": "caller-id",
        "name": "PivotById",
        "sourceSheetId": sid_str,
        "sourceSheetName": "Sheet1",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetName": "Sheet1",
        "outputLocation": { "row": 5, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let (_patches, created_result) = engine.pivot_create(config).expect("pivot create");
    let created: compute_pivot::PivotTableConfig = created_result
        .extract_data()
        .expect("created pivot config in data");

    engine
        .rename_compute_sheet(&sid, "RenamedData")
        .expect("rename sheet");

    let loaded = engine
        .pivot_get(&sid, &created.id)
        .expect("pivot should still load after source sheet rename");
    assert_eq!(loaded.source_sheet_id.as_deref(), Some(sid_str.as_str()));
    assert_eq!(loaded.source_sheet_name, "RenamedData");
}

#[test]
fn pivot_legacy_source_sheet_name_resolves_to_source_sheet_id_on_read() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let config = json!({
        "id": "caller-id",
        "name": "LegacyByName",
        "sourceSheetName": "Sheet1",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetName": "Sheet1",
        "outputLocation": { "row": 5, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let (_patches, created_result) = engine.pivot_create(config).expect("pivot create");
    let created: compute_pivot::PivotTableConfig = created_result
        .extract_data()
        .expect("created pivot config in data");

    let loaded = engine
        .pivot_get(&sid, &created.id)
        .expect("pivot should load with resolved source identity");
    assert_eq!(
        loaded.source_sheet_id.as_deref(),
        Some(sid.to_uuid_string().as_str())
    );
    assert_eq!(loaded.source_sheet_name, "Sheet1");
}

#[test]
fn pivot_create_treats_null_optional_sheet_ids_as_absent() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    let sid_str = sid.to_uuid_string();

    let config = json!({
        "id": "caller-id",
        "name": "TransportNullIds",
        "sourceSheetId": null,
        "sourceSheetName": "Sheet1",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetId": null,
        "outputSheetName": "Sheet1",
        "outputLocation": { "row": 5, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let (_patches, created_result) = engine.pivot_create(config).expect("pivot create");
    let created: compute_pivot::PivotTableConfig = created_result
        .extract_data()
        .expect("created pivot config in data");

    assert_eq!(created.source_sheet_id.as_deref(), Some(sid_str.as_str()));
    assert_eq!(created.output_sheet_id.as_deref(), Some(sid_str.as_str()));
    assert_eq!(created.source_sheet_name, "Sheet1");
    assert_eq!(created.output_sheet_name, "Sheet1");
}

#[test]
fn pivot_update_persists_detected_fields_for_sparse_placement_config() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "Region".into(),
            },
        )
        .expect("write Region header");
    engine
        .set_cell(
            &sid,
            cell_id_b1(),
            0,
            1,
            crate::bridge_types::CellInput::Parse {
                text: "Sales".into(),
            },
        )
        .expect("write Sales header");
    engine
        .set_cell(
            &sid,
            cell_id_a2(),
            1,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "East".into(),
            },
        )
        .expect("write Region value");
    engine
        .set_cell(
            &sid,
            cell_types::CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440004")
                .expect("B2 cell id"),
            1,
            1,
            crate::bridge_types::CellInput::Parse { text: "100".into() },
        )
        .expect("write Sales value");

    let config = json!({
        "id": "caller-id",
        "name": "SparsePivot",
        "sourceSheetId": sid.to_uuid_string(),
        "sourceSheetName": "Sheet1",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetName": "Sheet1",
        "outputLocation": { "row": 5, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let (_patches, created_result) = engine.pivot_create(config).expect("pivot create");
    let created: domain_types::domain::pivot::PivotTableConfig = created_result
        .extract_data()
        .expect("created pivot config in data");
    assert!(created.fields.is_empty());

    let mut updated = created.clone();
    updated.placements = vec![
        domain_types::domain::pivot::PivotFieldPlacementFlat {
            placement_id: Default::default(),
            field_id: domain_types::domain::pivot::FieldId::from("Region"),
            calculated_field_id: None,
            area: domain_types::domain::pivot::PivotFieldArea::Row,
            position: 0,
            aggregate_function: None,
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: None,
            number_format: None,
            show_values_as: None,
        },
        domain_types::domain::pivot::PivotFieldPlacementFlat {
            placement_id: Default::default(),
            field_id: domain_types::domain::pivot::FieldId::from("Sales"),
            calculated_field_id: None,
            area: domain_types::domain::pivot::PivotFieldArea::Value,
            position: 0,
            aggregate_function: Some(domain_types::domain::analytics::AggregateFunction::Sum),
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: None,
            number_format: None,
            show_values_as: None,
        },
    ];

    let (_patches, update_result) = engine
        .pivot_update(&sid, &created.id, updated)
        .expect("pivot update");
    let updated_config: Option<domain_types::domain::pivot::PivotTableConfig> = update_result
        .extract_data()
        .expect("updated pivot config in data");
    let updated_config = updated_config.expect("pivot should be updated");

    assert_eq!(
        updated_config
            .fields
            .iter()
            .map(|field| (field.id.as_str(), field.name.as_str()))
            .collect::<Vec<_>>(),
        vec![("Region", "Region"), ("Sales", "Sales")]
    );

    let loaded = engine
        .pivot_get(&sid, &created.id)
        .expect("pivot should load after update");
    assert_eq!(loaded.fields, updated_config.fields);

    let result = engine
        .pivot_compute_from_source(&sid, &created.id, None)
        .expect("stored pivot config should compute");
    assert_eq!(result.source_row_count, 1);
}

#[test]
fn pivot_create_with_sheet_can_insert_before_source_sheet() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let (source_hex, _) = engine.create_sheet("Data").expect("create source sheet");
    let source_id = SheetId::from_uuid_str(&source_hex).expect("source sheet id");
    let source_uuid = source_id.to_uuid_string();

    let config = json!({
        "id": "caller-id",
        "name": "PivotBeforeSource",
        "sourceSheetId": source_uuid.clone(),
        "sourceSheetName": "Data",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetName": "Pivot Output",
        "outputLocation": { "row": 0, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let (pivot_hex, pivot, result) = engine
        .pivot_create_with_sheet(
            "Pivot Output",
            config,
            Some(PivotCreateWithSheetOptions {
                insert_before_sheet_id: Some(source_uuid.clone()),
                insert_index: Some(0),
            }),
        )
        .expect("pivot create with sheet");
    let pivot_sheet_id = SheetId::from_uuid_str(&pivot_hex).expect("pivot sheet id");

    let order = engine.storage().sheet_order();
    let pivot_index = order
        .iter()
        .position(|sheet_id| sheet_id == &pivot_sheet_id)
        .expect("pivot sheet in order");
    let source_index = order
        .iter()
        .position(|sheet_id| sheet_id == &source_id)
        .expect("source sheet in order");
    assert_eq!(pivot_index + 1, source_index);
    assert_eq!(
        pivot.output_sheet_id.as_deref(),
        Some(pivot_sheet_id.to_uuid_string().as_str())
    );
    assert!(result.sheet_changes.iter().any(|change| {
        change.sheet_id == pivot_sheet_id.to_uuid_string()
            && change.field == SheetChangeField::Order
    }));
}

#[test]
fn pivot_create_rejects_source_sheet_id_name_conflict() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let config = json!({
        "id": "caller-id",
        "name": "Conflict",
        "sourceSheetId": sheet_id().to_uuid_string(),
        "sourceSheetName": "NotSheet1",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetName": "Sheet1",
        "outputLocation": { "row": 5, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let err = engine
        .pivot_create(config)
        .expect_err("conflicting source identity should fail");
    assert!(
        err.to_string().contains("Pivot source identity conflict"),
        "unexpected error: {err}"
    );
}

#[test]
fn pivot_create_undo_redo_emits_semantic_pivot_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let config = json!({
        "id": "caller-id",
        "name": "UndoPivot",
        "sourceSheetName": "Sheet1",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1 },
        "outputSheetName": "Sheet1",
        "outputLocation": { "row": 5, "col": 0 },
        "fields": [],
        "placements": [],
        "filters": []
    });

    let (_patches, created_result) = engine.pivot_create(config).expect("pivot create");
    let created: compute_pivot::PivotTableConfig = created_result
        .extract_data()
        .expect("created pivot config in data");

    let (_patches, undo_result) = engine.undo().expect("undo pivot create");
    assert!(
        undo_result.pivot_changes.iter().any(|change| {
            change.sheet_id == sheet_id().to_uuid_string()
                && change.pivot_id == created.id
                && change.kind == ChangeKind::Removed
        }),
        "undo of pivot create must emit semantic Removed, got {:?}",
        undo_result.pivot_changes
    );

    let (_patches, redo_result) = engine.redo().expect("redo pivot create");
    assert!(
        redo_result.pivot_changes.iter().any(|change| {
            change.sheet_id == sheet_id().to_uuid_string()
                && change.pivot_id == created.id
                && change.kind == ChangeKind::Set
        }),
        "redo of pivot create must emit semantic Set, got {:?}",
        redo_result.pivot_changes
    );
}

// -------------------------------------------------------------------
// Test 8: set_cell with formula
// -------------------------------------------------------------------

#[test]
fn test_set_cell_with_formula() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Change A2 formula from =A1+B1 to =A1*B1
    let result = engine
        .set_cell(
            &sheet_id(),
            cell_id_a2(),
            1,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=A1*B1".into(),
            },
        )
        .unwrap();

    // A2 should now be 10*20 = 200
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a2()).unwrap(),
        CellValue::Number(FiniteF64::must(200.0))
    );

    // Result should have changes
    assert!(!result.1.recalc.changed_cells.is_empty());
}

// -------------------------------------------------------------------
// Test 12: Accessors return correct references
// -------------------------------------------------------------------

#[test]
fn test_accessors() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // storage() returns a reference
    let _ = engine.storage().sheet_order();

    // grid_index() returns Some for existing sheet
    assert!(engine.grid_index(&sheet_id()).is_some());

    // grid_index() returns None for non-existent sheet
    let fake_sheet = SheetId::from_raw(999);
    assert!(engine.grid_index(&fake_sheet).is_none());

    // compute() returns a reference
    let _ = engine.mirror();

    // undo_manager() returns a reference
    assert!(!engine.undo_manager().can_undo());

    // observer() returns a reference
    assert!(!engine.observer().has_changes());
}

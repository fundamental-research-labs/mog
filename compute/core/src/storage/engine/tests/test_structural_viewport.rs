//! Group 10: Structural change viewport synchronization tests.

use super::super::*;
use super::helpers::*;
use cell_types::CellId;
use formula_types::StructureChange;
use snapshot_types::StructureChangeType;
use value_types::{CellError, CellValue, FiniteF64};

fn patch_positions_from_packed(packed: &[u8]) -> Vec<(u32, u32)> {
    extract_first_viewport_mutation(packed)
        .map(|mutation_bytes| extract_patch_positions(&mutation_bytes))
        .unwrap_or_default()
}

// -------------------------------------------------------------------
// Test: Insert column with formula -- the original bug
// -------------------------------------------------------------------

/// Structural changes report the row/column delta and leave shifted viewport
/// buffers to the bridge-level force refresh. Formula/value recalc patches can
/// still be emitted, but they must not expand to every registered viewport cell.
#[test]
fn test_structural_viewport_insert_col_formula_cell_visible() {
    let snap = simple_snapshot(); // A1=10, B1=20, A2=A1+B1
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Register a viewport covering the relevant area
    let _ = engine.register_viewport("main", &sid, 0, 0, 5, 5);

    // Insert 1 column at col 1 (between A and B).
    // A1 stays at (0,0), B1 moves to (0,2), A2 stays at (1,0)
    let change = StructureChange::InsertCols {
        at: 1,
        count: 1,
        new_col_ids: vec![],
    };
    let (patches_packed, result) = engine.structure_change(&sid, &change).unwrap();
    let positions = patch_positions_from_packed(&patches_packed);

    assert!(
        positions.len() < 36,
        "structural edits must not emit viewport-wide synthetic patches; got {positions:?}"
    );
    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sid.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::InsertCols)
                && change.count == 1
        }),
        "structure_change must report InsertCols so the bridge force-refreshes viewports; got {:?}",
        result.structure_changes
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 2),
        CellValue::Number(FiniteF64::must(20.0)),
        "the moved value remains readable from Rust at its new position"
    );
}

// -------------------------------------------------------------------
// Test: Insert rows reports structure change without viewport-wide patches
// -------------------------------------------------------------------

#[test]
fn test_structural_viewport_insert_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let _ = engine.register_viewport("main", &sid, 0, 0, 3, 2);

    let change = StructureChange::InsertRows {
        at: 1,
        count: 1,
        new_row_ids: vec![],
    };
    let (patches_packed, result) = engine.structure_change(&sid, &change).unwrap();
    let positions = patch_positions_from_packed(&patches_packed);

    assert!(
        positions.len() < 12,
        "insert rows must not emit viewport-wide synthetic patches; got {positions:?}"
    );
    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sid.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::InsertRows)
                && change.count == 1
        }),
        "structure_change must report InsertRows so the bridge force-refreshes viewports; got {:?}",
        result.structure_changes
    );
}

// -------------------------------------------------------------------
// Test: Delete columns reports structure change without viewport-wide patches
// -------------------------------------------------------------------

#[test]
fn test_structural_viewport_delete_cols() {
    let snap = simple_snapshot(); // A1=10, B1=20, A2=A1+B1
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let _ = engine.register_viewport("main", &sid, 0, 0, 3, 3);

    // Delete column 0 (A). B1 at (0,1) should move to (0,0).
    let change = StructureChange::DeleteCols {
        at: 0,
        count: 1,
        deleted_cell_ids: vec![],
    };
    let (patches_packed, result) = engine.structure_change(&sid, &change).unwrap();
    let positions = patch_positions_from_packed(&patches_packed);

    assert!(
        positions.len() < 16,
        "delete cols must not emit viewport-wide synthetic patches; got {positions:?}"
    );
    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sid.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::DeleteCols)
                && change.count == 1
        }),
        "structure_change must report DeleteCols so the bridge force-refreshes viewports; got {:?}",
        result.structure_changes
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 0),
        CellValue::Number(FiniteF64::must(20.0)),
        "the shifted value remains readable from Rust at its new position"
    );
}

// -------------------------------------------------------------------
// Test: Delete rows reports structure change without viewport-wide patches
// -------------------------------------------------------------------

#[test]
fn test_structural_viewport_delete_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let _ = engine.register_viewport("main", &sid, 0, 0, 3, 2);

    // Delete row 0 (A1). A2 at (1,0) should move to (0,0).
    let change = StructureChange::DeleteRows {
        at: 0,
        count: 1,
        deleted_cell_ids: vec![],
    };
    let (patches_packed, result) = engine.structure_change(&sid, &change).unwrap();
    let positions = patch_positions_from_packed(&patches_packed);

    assert!(
        positions.len() < 12,
        "delete rows must not emit viewport-wide synthetic patches; got {positions:?}"
    );
    assert!(
        result.structure_changes.iter().any(|change| {
            change.sheet_id == sid.to_uuid_string()
                && matches!(&change.change_type, StructureChangeType::DeleteRows)
                && change.count == 1
        }),
        "structure_change must report DeleteRows so the bridge force-refreshes viewports; got {:?}",
        result.structure_changes
    );
}

// -------------------------------------------------------------------
// Test: No viewport registered -> no structural patches (no crash)
// -------------------------------------------------------------------

#[test]
fn test_structural_change_without_viewport_no_crash() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // No viewport registered -- structural change should still work
    let change = StructureChange::InsertCols {
        at: 1,
        count: 1,
        new_col_ids: vec![],
    };
    let result = engine.structure_change(&sid, &change);
    assert!(
        result.is_ok(),
        "Structure change without viewport should succeed"
    );
}

#[test]
fn structural_formula_text_preserves_explicit_same_sheet_qualifier() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_value_parsed(&sid, 0, 1, "=Sheet1!A1")
        .expect("seed qualified same-sheet formula");
    assert_eq!(
        engine.get_formula(&cell_id_b1()).as_deref(),
        Some("=Sheet1!A1")
    );

    let unrelated_insert = StructureChange::InsertRows {
        at: 10,
        count: 1,
        new_row_ids: vec![],
    };
    engine
        .structure_change(&sid, &unrelated_insert)
        .expect("insert row below reference");
    assert_eq!(
        engine.get_formula(&cell_id_b1()).as_deref(),
        Some("=Sheet1!A1"),
        "unrelated structural cache refresh must not collapse authored same-sheet qualifier"
    );

    let shifting_insert = StructureChange::InsertRows {
        at: 0,
        count: 1,
        new_row_ids: vec![],
    };
    engine
        .structure_change(&sid, &shifting_insert)
        .expect("insert row above reference");
    assert_eq!(
        engine.get_formula(&cell_id_b1()).as_deref(),
        Some("=Sheet1!A2"),
        "structural rewrite must shift the reference while preserving the explicit qualifier"
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 1),
        CellValue::Number(FiniteF64::must(10.0))
    );
}

#[test]
fn delete_column_invalidates_shifted_direct_cell_reference() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_value_parsed(&sid, 0, 2, "=B1*2")
        .expect("seed C1 formula");

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 1,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete column B");

    let shifted = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sid, 0, 1)
            .expect("shifted formula should stay materialized"),
    )
    .expect("cell id should parse");
    let formula = engine
        .get_formula(&shifted)
        .expect("shifted formula should keep formula text");
    assert!(
        formula.contains("#REF!"),
        "direct ref to deleted column should render #REF!, got {formula}"
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 1),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn delete_row_invalidates_shifted_direct_cell_reference() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_value_parsed(&sid, 2, 0, "10")
        .expect("seed A3");
    engine
        .set_cell_value_parsed(&sid, 3, 0, "=A3*2")
        .expect("seed A4 formula");

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 2,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete row 3");

    let shifted = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sid, 2, 0)
            .expect("shifted formula should stay materialized"),
    )
    .expect("cell id should parse");
    let formula = engine
        .get_formula(&shifted)
        .expect("shifted formula should keep formula text");
    assert!(
        formula.contains("#REF!"),
        "direct ref to deleted row should render #REF!, got {formula}"
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 0),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn delete_column_invalidates_shifted_absolute_direct_ref_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_value_parsed(&sid, 13, 10, "100")
        .expect("seed K14");
    engine
        .set_cell_value_parsed(&sid, 13, 11, "200")
        .expect("seed L14");
    engine
        .set_cell_value_parsed(&sid, 34, 12, "0.25")
        .expect("seed M35");
    engine
        .set_cell_value_parsed(&sid, 13, 12, "=$L14*(1+$M$35)")
        .expect("seed M14 formula");

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 11,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete column L");

    let l14 = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sid, 13, 11)
            .expect("shifted formula should stay materialized"),
    )
    .expect("cell id should parse");
    assert_eq!(
        engine.get_formula(&l14).as_deref(),
        Some("=#REF!*(1+$L$35)"),
        "deleted direct ref should render #REF! while surviving absolute refs keep markers"
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 13, 11),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn delete_row_invalidates_shifted_absolute_direct_ref_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_value_parsed(&sid, 9, 0, "100")
        .expect("seed A10");
    engine
        .set_cell_value_parsed(&sid, 10, 0, "200")
        .expect("seed A11");
    engine
        .set_cell_value_parsed(&sid, 11, 1, "0.25")
        .expect("seed B12");
    engine
        .set_cell_value_parsed(&sid, 11, 0, "=$A$11*(1+$B$12)")
        .expect("seed A12 formula");

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 10,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete row 11");

    let a11 = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sid, 10, 0)
            .expect("shifted formula should stay materialized"),
    )
    .expect("cell id should parse");
    assert_eq!(
        engine.get_formula(&a11).as_deref(),
        Some("=#REF!*(1+$B$11)"),
        "deleted direct ref should render #REF! while surviving absolute refs keep markers"
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 10, 0),
        CellValue::Error(CellError::Ref, None)
    );
}

#[test]
fn relocate_precedent_regenerates_dependent_formula_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_value_parsed(&sid, 0, 1, "=A1*2")
        .expect("seed B1 formula");
    assert_eq!(engine.get_formula(&cell_id_b1()).as_deref(), Some("=A1*2"));

    engine
        .relocate_cells_yrs(&sid, 0, 0, 0, 0, &sid, 0, 2)
        .expect("relocate A1 to C1");

    assert_eq!(engine.get_formula(&cell_id_b1()).as_deref(), Some("=C1*2"));

    let row = engine.query_range(&sid, 0, 0, 0, 2);
    assert!(
        row.cells
            .iter()
            .all(|cell| !(cell.row == 0 && cell.col == 0)),
        "source A1 should be empty after relocate: {:?}",
        row.cells
    );

    let b1 = row
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 1)
        .expect("B1 formula cell");
    assert_eq!(b1.value, CellValue::Number(FiniteF64::must(20.0)));
    assert_eq!(b1.formula.as_deref(), Some("=C1*2"));

    let c1 = row
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 2)
        .expect("C1 moved value");
    assert_eq!(c1.value, CellValue::Number(FiniteF64::must(10.0)));
    assert!(c1.formula.is_none());

    engine.undo().expect("undo relocate");
    assert_eq!(engine.get_formula(&cell_id_b1()).as_deref(), Some("=A1*2"));

    let undo_row = engine.query_range(&sid, 0, 0, 0, 2);
    let undo_b1 = undo_row
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 1)
        .expect("B1 formula cell after undo");
    assert_eq!(undo_b1.value, CellValue::Number(FiniteF64::must(20.0)));
    assert_eq!(undo_b1.formula.as_deref(), Some("=A1*2"));

    engine.redo().expect("redo relocate");
    assert_eq!(engine.get_formula(&cell_id_b1()).as_deref(), Some("=C1*2"));

    let redo_row = engine.query_range(&sid, 0, 0, 0, 2);
    let redo_b1 = redo_row
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 1)
        .expect("B1 formula cell after redo");
    assert_eq!(redo_b1.value, CellValue::Number(FiniteF64::must(20.0)));
    assert_eq!(redo_b1.formula.as_deref(), Some("=C1*2"));
}

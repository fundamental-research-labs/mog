//! Group 10: Structural change viewport synchronization tests.

use super::super::*;
use super::helpers::*;
use formula_types::StructureChange;

// -------------------------------------------------------------------
// Test: Insert column with formula -- the original bug
// -------------------------------------------------------------------

/// Reproduces the original bug: B1=A1, insert col between A and B.
/// C1 should have =A1 with the correct value visible in the viewport.
#[test]
fn test_structural_viewport_insert_col_formula_cell_visible() {
    let snap = simple_snapshot(); // A1=10, B1=20, A2=A1+B1
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Register a viewport covering the relevant area
    engine.register_viewport("main", &sid, 0, 0, 5, 5);

    // Insert 1 column at col 1 (between A and B).
    // A1 stays at (0,0), B1 moves to (0,2), A2 stays at (1,0)
    let change = StructureChange::InsertCols {
        at: 1,
        count: 1,
        new_col_ids: vec![],
    };
    let (patches_packed, _result) = engine.structure_change(&sid, &change).unwrap();

    // Unpack multi-viewport blob to get the single viewport's patches
    let mutation_bytes =
        extract_first_viewport_mutation(&patches_packed).expect("Should have viewport patches");

    let positions = extract_patch_positions(&mutation_bytes);

    // The viewport is 6x6 (rows 0-5, cols 0-5), so we expect patches
    // covering all 36 positions. Crucially, position (0,2) must be present
    // (this is where B1 moved to -- the cell that was invisible before the fix).
    assert!(
        positions.contains(&(0, 2)),
        "Viewport patches must include (0,2) -- the moved formula cell. Got: {:?}",
        positions
    );

    // Also verify the old position (0,1) is patched (should be Null/empty now)
    assert!(
        positions.contains(&(0, 1)),
        "Viewport patches must include (0,1) -- the newly inserted empty column"
    );

    // All viewport positions should be covered
    assert_eq!(
        positions.len(),
        36, // 6 rows x 6 cols
        "All viewport positions should have patches after structural change"
    );
}

// -------------------------------------------------------------------
// Test: Insert rows produces viewport patches for all positions
// -------------------------------------------------------------------

#[test]
fn test_structural_viewport_insert_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.register_viewport("main", &sid, 0, 0, 3, 2);

    let change = StructureChange::InsertRows {
        at: 1,
        count: 1,
        new_row_ids: vec![],
    };
    let (patches_packed, _) = engine.structure_change(&sid, &change).unwrap();
    let mutation_bytes =
        extract_first_viewport_mutation(&patches_packed).expect("Should have viewport patches");
    let positions = extract_patch_positions(&mutation_bytes);

    // 4 rows x 3 cols = 12 positions
    assert_eq!(
        positions.len(),
        12,
        "All viewport positions patched after insert rows"
    );
    // A2 moved to (2,0) -- it must be in the patches
    assert!(
        positions.contains(&(2, 0)),
        "Moved cell A2 must be patched at new position (2,0)"
    );
    // Newly inserted row 1 must be patched
    assert!(
        positions.contains(&(1, 0)),
        "Inserted empty row must be patched"
    );
}

// -------------------------------------------------------------------
// Test: Delete columns produces viewport patches
// -------------------------------------------------------------------

#[test]
fn test_structural_viewport_delete_cols() {
    let snap = simple_snapshot(); // A1=10, B1=20, A2=A1+B1
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.register_viewport("main", &sid, 0, 0, 3, 3);

    // Delete column 0 (A). B1 at (0,1) should move to (0,0).
    let change = StructureChange::DeleteCols {
        at: 0,
        count: 1,
        deleted_cell_ids: vec![],
    };
    let (patches_packed, _) = engine.structure_change(&sid, &change).unwrap();
    let mutation_bytes =
        extract_first_viewport_mutation(&patches_packed).expect("Should have viewport patches");
    let positions = extract_patch_positions(&mutation_bytes);

    // 4 rows x 4 cols = 16 positions
    assert_eq!(
        positions.len(),
        16,
        "All viewport positions patched after delete cols"
    );
    // B1 (originally at col 1) should now be at (0,0)
    assert!(
        positions.contains(&(0, 0)),
        "Shifted cell must be patched at new position"
    );
}

// -------------------------------------------------------------------
// Test: Delete rows produces viewport patches
// -------------------------------------------------------------------

#[test]
fn test_structural_viewport_delete_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.register_viewport("main", &sid, 0, 0, 3, 2);

    // Delete row 0 (A1). A2 at (1,0) should move to (0,0).
    let change = StructureChange::DeleteRows {
        at: 0,
        count: 1,
        deleted_cell_ids: vec![],
    };
    let (patches_packed, _) = engine.structure_change(&sid, &change).unwrap();
    let mutation_bytes =
        extract_first_viewport_mutation(&patches_packed).expect("Should have viewport patches");
    let positions = extract_patch_positions(&mutation_bytes);

    // 4 rows x 3 cols = 12 positions
    assert_eq!(
        positions.len(),
        12,
        "All viewport positions patched after delete rows"
    );
    assert!(
        positions.contains(&(0, 0)),
        "Shifted cell must be patched at new position (0,0)"
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

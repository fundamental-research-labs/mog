//! Tests for spill propagation.
//!
//! These tests verify:
//! - Dependents of phantom cells recalculate after spill expansion
//! - Spill range shrinkage clears old phantoms
//! - Editing a phantom triggers source recalculation
//! - expand_spill diff detects unchanged arrays

use super::test_helpers::*;
use super::*;
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use std::sync::Arc;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a snapshot with a 10x10 sheet and the given cells.
fn spill_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Generate a deterministic cell ID string from a row/col pair.
fn cell_id_str(row: u32, col: u32) -> String {
    format!("00000000-0000-0000-0000-{:04x}{:04x}{:04x}", 0, row, col)
}

/// Parse a cell ID string to CellId.
fn cell_id_from_str(s: &str) -> CellId {
    CellId::from_uuid_str(s).unwrap()
}

// ---------------------------------------------------------------------------
// Test 1: Interactive SEQUENCE(5) spills to A2:A5
// ---------------------------------------------------------------------------

#[test]
fn test_interactive_sequence_spills() {
    let a1_str = cell_id_str(0, 0);

    // Start with an empty sheet that has cell A1 as empty
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Set A1 = SEQUENCE(5) — should spill values 1..5 into A1:A5
    let result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // A1 should hold the top-left value (1)
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(*a1_val, CellValue::number(1.0), "A1 should be 1");

    // Verify that projection changes were reported
    assert!(
        !result.projection_changes.is_empty(),
        "projection_changes should be non-empty after SEQUENCE(5)"
    );

    // Check projected values via col_data (no phantom CellIds created)
    let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
    let col_slice = sheet_mirror
        .get_column_slice(0)
        .expect("col_data for column 0 should exist");
    for row in 1..5u32 {
        assert_eq!(
            col_slice[row as usize],
            CellValue::number((row + 1) as f64),
            "A{} should be {} (via col_data)",
            row + 1,
            row + 1
        );
    }
}

// ---------------------------------------------------------------------------
// Test 2: Dependent of a phantom cell recalculates after spill
// ---------------------------------------------------------------------------

#[test]
fn test_dependent_of_phantom_recalcs() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    // Set up B1 with a formula that references A3 (which will be a phantom)
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: Some("=A3*2".to_string()),
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // B1 = A3*2, but A3 is empty so B1 = 0*2 = 0
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(*b1_val, CellValue::number(0.0), "B1 should be 0 initially");

    // Now set A1 = SEQUENCE(5) — A3 becomes phantom with value 3
    let _result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // B1 = A3 * 2 = 3 * 2 = 6
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::number(6.0),
        "B1 should be 6 after SEQUENCE spill"
    );
}

// ---------------------------------------------------------------------------
// Test 3: Spill shrinkage clears old phantoms
// ---------------------------------------------------------------------------

#[test]
fn test_spill_shrinkage_clears_old_phantoms() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Set A1 = SEQUENCE(5) — spills to A2:A5
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // Verify A4 and A5 have values via col_data
    {
        let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
        let col_slice = sheet_mirror
            .get_column_slice(0)
            .expect("col_data should exist");
        assert_eq!(col_slice[3], CellValue::number(4.0), "A4 should be 4");
        assert_eq!(col_slice[4], CellValue::number(5.0), "A5 should be 5");
    }

    // Now shrink: A1 = SEQUENCE(3) — A4 and A5 should be cleared
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();

    // A4 and A5 should now be Null in col_data
    {
        let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
        let col_slice = sheet_mirror
            .get_column_slice(0)
            .expect("col_data should exist");
        assert_eq!(
            col_slice[3],
            CellValue::Null,
            "A4 should be Null after shrinkage"
        );
        assert_eq!(
            col_slice[4],
            CellValue::Null,
            "A5 should be Null after shrinkage"
        );
        // A2 and A3 should still have values
        assert_eq!(col_slice[1], CellValue::number(2.0), "A2 should still be 2");
        assert_eq!(col_slice[2], CellValue::number(3.0), "A3 should still be 3");
    }
}

// ---------------------------------------------------------------------------
// Test 4: Editing a phantom triggers #SPILL! on source
// ---------------------------------------------------------------------------

#[test]
fn test_edit_phantom_triggers_spill_error() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Set A1 = SEQUENCE(5) — spills to A2:A5
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // Verify A3 is a projected position (no phantom CellIds created)
    assert!(
        mirror.projection_registry.is_projected(&sheet_id, 2, 0),
        "A3 should be a projected position before editing"
    );

    // Projected positions don't have CellIds in the mirror.
    // To edit A3, get or create a CellId at that position (simulates client behavior).
    let a3_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(2, 0))
        .unwrap();

    // Edit A3 directly — this should invalidate A1's projection
    core.set_cell(&mut mirror, &sheet_id, a3_id, 2, 0, "hello")
        .unwrap();

    // A1 should show #SPILL! because A3 now blocks its spill range
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(
        *a1_val,
        CellValue::Error(CellError::Spill, None),
        "A1 should be #SPILL! after editing phantom A3"
    );
}

// ---------------------------------------------------------------------------
// Test 5: Same array produces no unnecessary phantom changes
// ---------------------------------------------------------------------------

#[test]
fn test_same_array_no_unnecessary_changes() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    // Set up a cell with a SEQUENCE formula
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: Some("=SEQUENCE(3)".to_string()),
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let b1_id = cell_id_from_str(&b1_str);

    // Verify initial spill
    let a1_id = cell_id_from_str(&a1_str);
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0)
    );

    // Now "edit" B1 to trigger a recalc of A1's formula.
    // A1 will re-evaluate SEQUENCE(3) but produce the same array.
    // The expand_spill diff should detect no changes.
    let result = core
        .set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "42")
        .unwrap();

    // A1 should still be 1
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0)
    );

    // B1 should be 42
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(42.0)
    );

    // The result should not include A1 in changed_cells because the value didn't change
    // (A1 was already 1.0 and SEQUENCE(3) still produces 1.0 as the top-left)
    let a1_uuid = a1_id.to_uuid_string();
    let a1_changed = result.changed_cells.iter().any(|c| c.cell_id == a1_uuid);
    // A1's value didn't change (still 1.0), so it shouldn't be in changed_cells
    assert!(
        !a1_changed,
        "A1 should not be reported as changed when SEQUENCE produces same array"
    );
}

// ===========================================================================
// Projection Materialization Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Test: SEQUENCE(5) materializes projected values into col_data
// ---------------------------------------------------------------------------

#[test]
fn test_projection_materialize_col_data() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Set A1 = SEQUENCE(5) — should register projection and materialize col_data
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // Verify projection is registered
    assert!(
        mirror.projection_registry.is_source(&a1_id),
        "A1 should be registered as a projection source"
    );

    let proj = mirror.projection_registry.get(&a1_id).unwrap();
    assert_eq!(proj.rows, 5, "Projection should have 5 rows");
    assert_eq!(proj.cols, 1, "Projection should have 1 col");
    assert_eq!(proj.origin_row, 0);
    assert_eq!(proj.origin_col, 0);

    // Verify col_data has the materialized projected values
    let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
    let col_slice = sheet_mirror
        .get_column_slice(0)
        .expect("col_data for column 0 should exist");

    // Row 0 is the source cell (should be 1.0 from the top-left of the array)
    assert_eq!(
        col_slice[0],
        CellValue::number(1.0),
        "col_data[0] should be 1.0"
    );
    // Rows 1-4 are projected values
    assert_eq!(
        col_slice[1],
        CellValue::number(2.0),
        "col_data[1] should be 2.0"
    );
    assert_eq!(
        col_slice[2],
        CellValue::number(3.0),
        "col_data[2] should be 3.0"
    );
    assert_eq!(
        col_slice[3],
        CellValue::number(4.0),
        "col_data[3] should be 4.0"
    );
    assert_eq!(
        col_slice[4],
        CellValue::number(5.0),
        "col_data[4] should be 5.0"
    );
}

// ---------------------------------------------------------------------------
// Test: clear_materialization zeros out col_data entries
// ---------------------------------------------------------------------------

#[test]
fn test_clear_materialization_zeros_col_data() {
    use crate::mirror::SheetMirror;

    let sheet_id = SheetId::from_raw(100);
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);

    // Build a 3-element single-column array: [1, 2, 3]
    let arr = CellValue::Array(Arc::new(CellArray::single_column(vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(3.0),
    ])));

    // Materialize the projection
    mirror.materialize_projection(&sheet_id, 0, 0, &arr);

    // Verify values are materialized (row 0 skipped by materialize_projection)
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    let col = sheet.get_column_slice(0).unwrap();
    assert_eq!(col[1], CellValue::number(2.0));
    assert_eq!(col[2], CellValue::number(3.0));

    // Now clear the materialization
    mirror.clear_materialization(&sheet_id, 0, 0, 3, 1);

    // Verify values are cleared (row 0 origin is NOT cleared)
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    let col = sheet.get_column_slice(0).unwrap();
    assert_eq!(col[1], CellValue::Null, "row 1 should be cleared");
    assert_eq!(col[2], CellValue::Null, "row 2 should be cleared");
}

// ---------------------------------------------------------------------------
// Test: resolve_projected_value returns correct elements
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_projected_value() {
    use crate::mirror::{CellEntry, SheetMirror};

    let sheet_id = SheetId::from_raw(100);
    let source_id = CellId::from_raw(1);
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);

    // Build a 3 rows x 2 cols array
    let arr = CellArray::new(
        vec![
            CellValue::number(10.0),
            CellValue::number(20.0),
            CellValue::number(30.0),
            CellValue::number(40.0),
            CellValue::number(50.0),
            CellValue::number(60.0),
        ],
        2,
    );
    let arr_value = CellValue::Array(Arc::new(arr));

    // Insert source cell at (5,3) with the top-left scalar
    mirror.insert_cell(
        &sheet_id,
        source_id,
        SheetPos::new(5, 3),
        CellEntry {
            value: CellValue::number(10.0),
            formula: None,
        },
    );

    // Register projection: 3 rows x 2 cols starting at (5, 3)
    mirror
        .projection_registry
        .register(source_id, sheet_id, 5, 3, 3, 2);

    // Materialize projection into col_data
    mirror.materialize_projection(&sheet_id, 5, 3, &arr_value);

    // Test resolve_projected_value at various positions
    // Origin (5,3) -> elem (0,0) = 10.0 (from col_data, written by insert_cell)
    let val = mirror.resolve_projected_value(&sheet_id, 5, 3);
    assert_eq!(val, Some(CellValue::number(10.0)));

    // (5,4) -> elem (0,1) = 20.0 (from col_data via materialize_projection)
    let val = mirror.resolve_projected_value(&sheet_id, 5, 4);
    assert_eq!(val, Some(CellValue::number(20.0)));

    // (6,3) -> elem (1,0) = 30.0
    let val = mirror.resolve_projected_value(&sheet_id, 6, 3);
    assert_eq!(val, Some(CellValue::number(30.0)));

    // (7,4) -> elem (2,1) = 60.0
    let val = mirror.resolve_projected_value(&sheet_id, 7, 4);
    assert_eq!(val, Some(CellValue::number(60.0)));

    // Outside projection -> None
    let val = mirror.resolve_projected_value(&sheet_id, 8, 3);
    assert_eq!(val, None);

    let val = mirror.resolve_projected_value(&sheet_id, 5, 5);
    assert_eq!(val, None);
}

// ---------------------------------------------------------------------------
// Test: Projection is cleared when formula produces non-array result
// ---------------------------------------------------------------------------

#[test]
fn test_projection_cleared_on_non_array() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // First, set A1 = SEQUENCE(3) — creates projection
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();
    assert!(mirror.projection_registry.is_source(&a1_id));

    // Now change A1 to a plain value — projection should be cleared
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "42")
        .unwrap();
    assert!(
        !mirror.projection_registry.is_source(&a1_id),
        "Projection should be cleared when formula produces non-array result"
    );
}

// ===========================================================================
// Projection Stabilization (Two-Phase Evaluation) Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Test: Stable projection (stabilization skipped)
// When a formula re-evaluates but produces the same-size array, no projection
// deltas are generated and stabilization does not trigger.
// ---------------------------------------------------------------------------

#[test]
fn test_stable_projection_phase2_skipped() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    // A1 = SEQUENCE(5), B1 = some unrelated value
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: Some("=SEQUENCE(5)".to_string()),
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // A1 should have value 1 (top-left of SEQUENCE(5))
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0),
        "A1 should be 1 initially"
    );

    // Projection should be registered
    assert!(mirror.projection_registry.is_source(&a1_id));
    let proj = mirror.projection_registry.get(&a1_id).unwrap();
    assert_eq!(proj.rows, 5);
    assert_eq!(proj.cols, 1);

    // Edit B1 (unrelated) — triggers recalc but A1's SEQUENCE(5) still produces 5x1
    // Stabilization should NOT trigger because projection shape is unchanged
    let result = core
        .set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "20")
        .unwrap();

    // A1 still 1, projection still 5x1
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0),
        "A1 should still be 1 after unrelated edit"
    );
    assert_eq!(
        mirror.projection_registry.get(&a1_id).unwrap().rows,
        5,
        "Projection should still be 5 rows"
    );

    // B1 should be updated
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(20.0),
    );

    // A1 should not appear in changed_cells (same value)
    let a1_uuid = a1_id.to_uuid_string();
    let a1_changed = result.changed_cells.iter().any(|c| c.cell_id == a1_uuid);
    assert!(
        !a1_changed,
        "A1 should not be changed when projection is stable"
    );
}

// ---------------------------------------------------------------------------
// Test: New projection triggers stabilization correction
// When A1=SEQUENCE(5) is entered and B1=SUM(A1:A5) was already computed,
// the projection stabilization should correct B1 to use the spilled values.
// ---------------------------------------------------------------------------

#[test]
fn test_new_projection_triggers_phase2_correction() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    // Set up B1 with a SUM formula over A1:A5 range, A1 initially empty
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: Some("=SUM(A1:A5)".to_string()),
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // Initially B1 = SUM(empty range) = 0
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(0.0),
        "B1 should be 0 initially"
    );

    // Now set A1 = SEQUENCE(5) — creates NEW projection covering A1:A5
    // Topo evaluation evaluates both A1 and B1, but B1 might read stale range values.
    // Projection stabilization should correct B1 = SUM(1+2+3+4+5) = 15
    let _result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // B1 should now be SUM(1..5) = 15
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::number(15.0),
        "B1 should be 15 after SEQUENCE(5) spill + projection stabilization"
    );
}

// ---------------------------------------------------------------------------
// Test: Self-eliminating property
// After stabilization runs once and adds Cell(source) edges, a subsequent recalc
// with stable projections should NOT trigger stabilization again.
// ---------------------------------------------------------------------------

#[test]
fn test_self_eliminating_property() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);
    let c1_str = cell_id_str(0, 2);

    // Setup: A1=SEQUENCE(5), B1=SUM(A1:A5), C1 is a trigger cell
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: Some("=SUM(A1:A5)".to_string()),
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: c1_str.clone(),
            row: 0,
            col: 2,
            value: CellValue::number(0.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);
    let c1_id = cell_id_from_str(&c1_str);

    // First recalc: enter SEQUENCE(5) — stabilization runs, adds Cell(source) edges
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(15.0),
    );

    // Second recalc: edit unrelated C1 — projection is stable, stabilization should not trigger
    // We verify correctness: B1 should still be 15, A1 still 1
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "99")
        .unwrap();
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(15.0),
        "B1 should still be 15 after stable recalc (self-eliminating)"
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0),
        "A1 should still be 1"
    );
}

// ---------------------------------------------------------------------------
// Test: Recursion bound — MAX_DEPTH prevents infinite stabilization loops
// ---------------------------------------------------------------------------

#[test]
fn test_projection_stabilization_recursion_bound() {
    // This test verifies that even if the projection_stabilize function
    // is called at depth >= MAX_DEPTH, it returns Ok without panic.
    // We test this indirectly: set up a scenario and verify it completes.
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Set A1 = SEQUENCE(10) — large projection, stabilization should complete
    let result = core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(10)");
    assert!(result.is_ok(), "SEQUENCE(10) should complete without panic");

    // Verify the projection is correct
    assert!(mirror.projection_registry.is_source(&a1_id));
    let proj = mirror.projection_registry.get(&a1_id).unwrap();
    assert_eq!(proj.rows, 10);
    assert_eq!(proj.cols, 1);

    // Verify values via col_data (no phantom CellIds)
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0)
    );
    {
        let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
        let col_slice = sheet_mirror
            .get_column_slice(0)
            .expect("col_data should exist");
        for row in 1..10u32 {
            assert_eq!(
                col_slice[row as usize],
                CellValue::number((row + 1) as f64),
                "A{} should be {} (via col_data)",
                row + 1,
                row + 1
            );
        }
    }

    // Now resize from 10 to 3 and back to 10 rapidly
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();
    assert_eq!(mirror.projection_registry.get(&a1_id).unwrap().rows, 3);

    let result = core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(10)");
    assert!(result.is_ok(), "Rapid resize should complete without panic");
    assert_eq!(mirror.projection_registry.get(&a1_id).unwrap().rows, 10);
}

// ---------------------------------------------------------------------------
// Test: find_by_range_containment on the dependency graph
// ---------------------------------------------------------------------------

#[test]
fn test_find_by_range_containment() {
    use crate::graph::{DepTarget, DependencyGraph, RangeAccess};
    use cell_types::RangePos;

    let mut graph = DependencyGraph::new();
    let sheet = SheetId::from_raw(1);
    let formula_cell = CellId::from_raw(100);

    // formula_cell depends on range A1:A10 (rows 0-9, col 0)
    graph.set_precedents(
        &formula_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 9, 0),
            RangeAccess::Aggregate,
        )],
    );

    // Position (5, 0) is inside the range — should find formula_cell
    let affected = graph.find_by_range_containment(&[(sheet, 5, 0)]);
    assert!(
        affected.contains(&formula_cell),
        "formula_cell should be found via range containment"
    );

    // Position (10, 0) is outside the range — should NOT find formula_cell
    let affected = graph.find_by_range_containment(&[(sheet, 10, 0)]);
    assert!(
        !affected.contains(&formula_cell),
        "formula_cell should NOT be found for position outside range"
    );

    // Position (5, 1) is outside the range (wrong column) — should NOT find
    let affected = graph.find_by_range_containment(&[(sheet, 5, 1)]);
    assert!(
        !affected.contains(&formula_cell),
        "formula_cell should NOT be found for wrong column"
    );

    // Different sheet — should NOT find
    let other_sheet = SheetId::from_raw(2);
    let affected = graph.find_by_range_containment(&[(other_sheet, 5, 0)]);
    assert!(affected.is_empty(), "Wrong sheet should return empty");
}

// ---------------------------------------------------------------------------
// ANCHORARRAY (#) operator tests
// ---------------------------------------------------------------------------

/// Test: =SUM(ANCHORARRAY(A1)) where A1 has SEQUENCE(10) → 55
#[test]
fn test_anchorarray_sum_over_spill() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // Set A1 = SEQUENCE(10) — spills 1..10 into A1:A10
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(10)")
        .unwrap();

    // Set B1 = SUM(ANCHORARRAY(A1)) — should sum 1+2+...+10 = 55
    core.set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "=SUM(ANCHORARRAY(A1))")
        .unwrap();

    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::number(55.0),
        "SUM(ANCHORARRAY(A1)) should be 55 for SEQUENCE(10)"
    );
}

/// Test: =SUM(ANCHORARRAY(B1)) where B1 is NOT a projection source → #VALUE!
#[test]
fn test_anchorarray_non_source_returns_value_error() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::number(42.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // A1 = SUM(ANCHORARRAY(B1)) — B1 is a plain scalar, not a projection source
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SUM(ANCHORARRAY(B1))")
        .unwrap();

    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(
        *a1_val,
        CellValue::Error(CellError::Value, None),
        "ANCHORARRAY on non-source cell should produce #VALUE!"
    );
}

/// Test: =SUM(ANCHORARRAY(A1)) after A1's formula is deleted → #VALUE!
#[test]
fn test_anchorarray_after_source_deleted() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // Set A1 = SEQUENCE(5), then B1 = SUM(ANCHORARRAY(A1))
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();
    core.set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "=SUM(ANCHORARRAY(A1))")
        .unwrap();

    // Verify it works first
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::number(15.0),
        "SUM(ANCHORARRAY(A1)) should be 15 for SEQUENCE(5)"
    );

    // Now clear A1's formula by setting it to a plain value
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "hello")
        .unwrap();

    // B1 should now be #VALUE! because A1 is no longer a projection source
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::Error(CellError::Value, None),
        "ANCHORARRAY after source deletion should produce #VALUE!"
    );
}

// ---------------------------------------------------------------------------
// Bug reproduction: anchor clear must surface the cleared spill targets
// in the RecalcResult so the viewport buffer can patch them to empty.
// ---------------------------------------------------------------------------

#[test]
fn test_clear_anchor_surfaces_cleared_spill_targets_in_recalc() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Step 1: A1 = SEQUENCE(4) → spills to A1:A4 = 1,2,3,4
    let create_result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(4)")
        .unwrap();
    assert!(
        !create_result.projection_changes.is_empty(),
        "spill creation must emit projection_changes"
    );
    let created_targets: std::collections::HashSet<(u32, u32)> = create_result
        .projection_changes
        .iter()
        .flat_map(|pc| pc.projection_cells.iter().map(|c| (c.row, c.col)))
        .collect();
    assert!(created_targets.contains(&(1, 0)), "A2 patched on create");
    assert!(created_targets.contains(&(2, 0)), "A3 patched on create");
    assert!(created_targets.contains(&(3, 0)), "A4 patched on create");

    // Step 2: Clear A1 (the anchor). The spilled values at A2:A4 must be
    // surfaced in the RecalcResult so the viewport patches them to empty.
    let clear_result = core.clear_cells(&mut mirror, &[a1_id]).unwrap();

    // Verify col_data was cleared (engine-level invariant — already known to work).
    let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
    let col_slice = sheet_mirror.get_column_slice(0).expect("col_data");
    for r in 1..4u32 {
        assert_eq!(
            col_slice[r as usize],
            CellValue::Null,
            "A{} must be Null in col_data after anchor clear",
            r + 1
        );
    }

    // Now the bug: nothing in clear_result tells the UI that A2:A4 changed.
    // Either projection_changes must contain Null patches for A2:A4, or
    // changed_cells must include CellChange entries for those positions.
    let mentioned_positions: std::collections::HashSet<(u32, u32)> = clear_result
        .changed_cells
        .iter()
        .filter_map(|c| c.position.as_ref().map(|p| (p.row, p.col)))
        .chain(
            clear_result
                .projection_changes
                .iter()
                .flat_map(|pc| pc.projection_cells.iter().map(|c| (c.row, c.col))),
        )
        .collect();

    for r in 1..4u32 {
        assert!(
            mentioned_positions.contains(&(r, 0)),
            "BUG: A{} (cleared spill target) is not in RecalcResult — viewport will keep stale value. \
             changed_cells={:?} projection_changes={:?}",
            r + 1,
            clear_result
                .changed_cells
                .iter()
                .map(|c| (c.position.as_ref().map(|p| (p.row, p.col)), c.value.clone()))
                .collect::<Vec<_>>(),
            clear_result
                .projection_changes
                .iter()
                .map(|pc| pc
                    .projection_cells
                    .iter()
                    .map(|c| (c.row, c.col, c.value.clone()))
                    .collect::<Vec<_>>())
                .collect::<Vec<_>>(),
        );
    }
}

// ---------------------------------------------------------------------------
// Bug reproduction (FIX-004 / right-fix/spill-teardown):
//
// When a user writes a real value to a member of an existing spill (e.g.,
// types "X" into A2 while A1 = SEQUENCE(5)), the scheduler MUST emit:
//
//   - exactly ONE patch for A2 — the user's "X" — never a teardown null.
//   - a CellChange for the anchor (A1) reflecting its transition to #SPILL!.
//
// Both invariants were violated before the right-fix:
//
//   1. Contradictory emission: a regular CellChange for A2="X" AND a teardown
//      ProjectionCellData for A2 with value=Null in the same RecalcResult.
//      The TS layer had to dedupe; this test pins the contract at the
//      Rust source so dedupe is unnecessary.
//
//   2. Missing anchor change: invalidate_projection_at pre-set A1 to #SPILL!
//      *before* recalc, so when topo eval re-evaluated A1's formula and
//      produced #SPILL! again, the value-equality check suppressed the
//      CellChange. The anchor's display state transition was therefore
//      invisible to the viewport patches.
// ---------------------------------------------------------------------------

#[test]
fn test_write_to_spill_member_emits_single_patch_per_cell_and_anchor_change() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Step 1: A1 = SEQUENCE(5) → spills to A1:A5 = 1,2,3,4,5
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();
    assert!(
        mirror.projection_registry.is_projected(&sheet_id, 1, 0),
        "A2 should be a projected position before user edit"
    );

    // Step 2: User writes "X" to A2 (a spill member). This must:
    //   - tear down A1's projection
    //   - record the user's "X" at A2
    //   - report A1 transitioning to #SPILL!
    let a2_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(1, 0))
        .unwrap();
    let result = core
        .set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "X")
        .unwrap();

    // Invariant 1: A2 must appear EXACTLY ONCE across all patches, with
    // its real text value "X" — never with Null/teardown semantics.
    let regular_at_a2: Vec<&CellChange> = result
        .changed_cells
        .iter()
        .filter(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 1 && p.col == 0)
        })
        .collect();
    let teardown_at_a2: Vec<&snapshot_types::ProjectionCellData> = result
        .projection_changes
        .iter()
        .flat_map(|pc| pc.projection_cells.iter())
        .filter(|c| c.row == 1 && c.col == 0)
        .collect();

    assert_eq!(
        regular_at_a2.len(),
        1,
        "A2 must have exactly one regular CellChange, got {} — {:?}",
        regular_at_a2.len(),
        regular_at_a2
    );
    let a2_change = regular_at_a2[0];
    assert!(
        matches!(a2_change.value, CellValue::Text(ref s) if s.as_ref() == "X"),
        "A2's CellChange must carry user value \"X\", got {:?}",
        a2_change.value
    );
    assert!(
        teardown_at_a2.is_empty(),
        "A2 must NOT appear in projection_changes — the regular write owns it; \
         emitting a Null-valued teardown for the same cell creates a \
         contradictory patch the buffer cannot reconcile. Found: {:?}",
        teardown_at_a2
    );

    // Invariant 2: A1's transition to #SPILL! must be in changed_cells.
    let a1_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        })
        .expect(
            "A1 transitioned from spill-source to #SPILL! and must appear in \
             changed_cells so the viewport patches its display state",
        );
    assert!(
        matches!(a1_change.value, CellValue::Error(CellError::Spill, _)),
        "A1's CellChange must carry #SPILL!, got {:?}",
        a1_change.value
    );

    // Mirror sanity: A1 is #SPILL!, A2 is "X".
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::Error(CellError::Spill, None),
        "A1 mirror must be #SPILL!"
    );
    assert!(
        matches!(core.get_cell_value(&mirror, &a2_id).unwrap(), CellValue::Text(s) if s.as_ref() == "X"),
        "A2 mirror must be \"X\""
    );
}

#[test]
fn test_teardown_only_covers_vacated_cells_not_the_blocker() {
    // Set up: A1 = SEQUENCE(5), spilling into A1:A5.
    // User writes "X" to A4 (a spill member further down the column).
    // Expected teardown coverage: A2, A3, A5 (the "vacated" cells); A4 must
    // be excluded because the user's regular CellChange is the authoritative
    // patch for that position. A1 transitions to #SPILL! via changed_cells.
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    let a4_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(3, 0))
        .unwrap();
    let result = core
        .set_cell(&mut mirror, &sheet_id, a4_id, 3, 0, "X")
        .unwrap();

    // Collect all cells appearing in projection_changes (teardowns).
    let teardown_positions: std::collections::HashSet<(u32, u32)> = result
        .projection_changes
        .iter()
        .flat_map(|pc| pc.projection_cells.iter().map(|c| (c.row, c.col)))
        .collect();

    // Each vacated cell (A2, A3, A5) must be in the teardown.
    for r in [1, 2, 4] {
        assert!(
            teardown_positions.contains(&(r, 0)),
            "vacated cell (row={}, col=0) must be in teardown projection_changes; \
             got positions={:?}",
            r,
            teardown_positions
        );
    }
    // A4 (the user-written cell) MUST NOT be in projection_changes.
    assert!(
        !teardown_positions.contains(&(3, 0)),
        "A4 (user-written) must NOT appear in teardown projection_changes — \
         the regular CellChange for A4 owns it; got positions={:?}",
        teardown_positions
    );

    // Regular changes still carry A4="X" and A1=#SPILL!.
    let a4_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 3 && p.col == 0)
        })
        .expect("A4 must be in changed_cells");
    assert!(
        matches!(a4_change.value, CellValue::Text(ref s) if s.as_ref() == "X"),
        "A4 must be \"X\""
    );
    let a1_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        })
        .expect("A1 must be in changed_cells");
    assert!(
        matches!(a1_change.value, CellValue::Error(CellError::Spill, _)),
        "A1 must be #SPILL!"
    );
}

#[test]
fn test_replacing_one_spill_with_another_emits_no_teardown_for_overlapping_cells() {
    // Set up: A1 = SEQUENCE(3) spills into A1:A3.
    // User writes =SEQUENCE(2) into A2 — A2 is currently a spill member of A1.
    // After recalc:
    //   - A1 transitions to #SPILL! (its spill is blocked by A2 now containing
    //     a different dynamic-array formula).
    //   - A2 spills into A2:A3 with values 1, 2.
    //
    // The wire output must NOT include a teardown null for A3: A3 is
    // authoritatively re-projected to the new spill value (2), and a
    // null teardown for the same position would race the new-spill value.
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();

    let a2_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(1, 0))
        .unwrap();
    let result = core
        .set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "=SEQUENCE(2)")
        .unwrap();

    // Inspect every patch (regular + projection) per position.
    // Build a multiset of (row, col) → list of values.
    use std::collections::HashMap;
    let mut patches_at: HashMap<(u32, u32), Vec<CellValue>> = HashMap::new();
    for c in &result.changed_cells {
        if let Some(pos) = &c.position {
            patches_at
                .entry((pos.row, pos.col))
                .or_default()
                .push(c.value.clone());
        }
    }
    for pc in &result.projection_changes {
        for cell in &pc.projection_cells {
            patches_at
                .entry((cell.row, cell.col))
                .or_default()
                .push(cell.value.clone());
        }
    }

    // A3 (row=2, col=0) must appear EXACTLY once with value 2 — never with
    // a Null teardown alongside the new-spill value.
    let a3_patches = patches_at.get(&(2, 0)).cloned().unwrap_or_default();
    assert_eq!(
        a3_patches.len(),
        1,
        "A3 must have exactly one patch (the new-spill value), got {}: {:?}",
        a3_patches.len(),
        a3_patches
    );
    assert!(
        matches!(a3_patches[0], CellValue::Number(_)),
        "A3 must carry a numeric spill value, got {:?}",
        a3_patches[0]
    );
    assert!(
        !matches!(a3_patches[0], CellValue::Null),
        "A3 must NOT have a Null teardown patch — the new-spill value owns it"
    );

    // A2 (the new anchor) must have exactly one regular CellChange (the
    // top-left of the new spill = 1). It must NOT also appear in
    // projection_changes (only non-anchor cells are projection cells).
    let a2_patches = patches_at.get(&(1, 0)).cloned().unwrap_or_default();
    assert_eq!(
        a2_patches.len(),
        1,
        "A2 must have exactly one patch (the new anchor's top-left), got {}: {:?}",
        a2_patches.len(),
        a2_patches
    );
}

#[test]
fn test_clearing_blocker_restores_spill_via_clear_cells() {
    // Set up: A1 = SEQUENCE(3); A2 = "X" (blocker) at the time SEQUENCE evaluates.
    // Result: A1 = #SPILL!. spill_blockers tracks A2 → A1.
    // User clears A2 via clear_cells. The spill source A1 must re-evaluate
    // and successfully spill. The recalc result must surface:
    //   - A2 = Null (from the clear)
    //   - A1 = top-left of new spill
    //   - A2/A3 as restoration projection_changes (non-null values)
    let a1_str = cell_id_str(0, 0);
    let a2_str = cell_id_str(1, 0);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: a2_str.clone(),
            row: 1,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let a2_id = cell_id_from_str(&a2_str);

    // Write SEQUENCE(3) — A1 should be #SPILL! because A2 is blocking.
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();
    assert!(
        matches!(
            *core.get_cell_value(&mirror, &a1_id).unwrap(),
            CellValue::Error(CellError::Spill, _)
        ),
        "A1 must be #SPILL! while A2 blocks"
    );

    // Clear A2 via clear_cells. This should re-dirty A1 (via spill_blockers)
    // and surface the spill restoration.
    let result = core.clear_cells(&mut mirror, &[a2_id]).unwrap();

    // A1 transitions back to a number (top-left of the spill = 1).
    let a1_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        })
        .expect("A1 must be in changed_cells after blocker clear");
    assert!(
        matches!(a1_change.value, CellValue::Number(n) if n.get() == 1.0),
        "A1 must be 1 (top-left of restored spill), got {:?}",
        a1_change.value
    );

    // A2/A3 spill members carry the projected values (2, 3) in
    // projection_changes — not Null teardowns.
    let proj_at: std::collections::HashMap<(u32, u32), CellValue> = result
        .projection_changes
        .iter()
        .flat_map(|pc| {
            pc.projection_cells
                .iter()
                .map(|c| ((c.row, c.col), c.value.clone()))
        })
        .collect();

    let a2_proj = proj_at
        .get(&(1, 0))
        .expect("A2 must have a projection patch (restored)");
    assert!(
        matches!(a2_proj, CellValue::Number(n) if n.get() == 2.0),
        "A2 projection patch must carry 2, got {:?}",
        a2_proj
    );
    let a3_proj = proj_at
        .get(&(2, 0))
        .expect("A3 must have a projection patch (restored)");
    assert!(
        matches!(a3_proj, CellValue::Number(n) if n.get() == 3.0),
        "A3 projection patch must carry 3, got {:?}",
        a3_proj
    );
}

// ---------------------------------------------------------------------------
// CSE (Ctrl+Shift+Enter) array-formula entry + partial-write rejection.
//
// `set_array_formula` is the new authoritative path for CSE entries; it
// marks the anchor in `mirror.cse_anchors` and registers the projection
// extent the user selected. `set_cell` then rejects any write that
// falls inside that extent (anchor or member) with
// `ComputeError::PartialArrayWrite`. Tearing down the CSE is exactly
// `clear_cells` on the anchor.
// ---------------------------------------------------------------------------

#[test]
fn test_set_array_formula_marks_anchor_and_registers_projection() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Enter `=SEQUENCE(2,3)` as a 2x3 CSE on A1:C2.
    let _result = core
        .set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Anchor is marked.
    assert!(
        mirror.is_cse_anchor(&a1_id),
        "anchor must be in mirror.cse_anchors after set_array_formula"
    );
    // Projection extent matches the user's selection.
    let proj = mirror
        .projection_registry
        .get(&a1_id)
        .expect("projection registered");
    assert_eq!(proj.origin_row, 0);
    assert_eq!(proj.origin_col, 0);
    assert_eq!(proj.rows, 2);
    assert_eq!(proj.cols, 3);
    // Anchor lookup answers correctly for the anchor cell and a member.
    let (a, _) = mirror
        .cse_anchor_covering(&sheet_id, 0, 0)
        .expect("anchor covers itself");
    assert_eq!(a, a1_id);
    let (a, _) = mirror
        .cse_anchor_covering(&sheet_id, 1, 2)
        .expect("anchor covers (1,2)");
    assert_eq!(a, a1_id);
    // Out-of-extent positions are not covered.
    assert!(mirror.cse_anchor_covering(&sheet_id, 2, 0).is_none());
}

#[test]
fn test_set_cell_rejects_partial_array_write_on_member() {
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        // Pre-allocate a CellId for B2 so set_cell has a target without
        // needing the engine-services layer (this is a scheduler-level
        // test).
        CellData {
            cell_id: b2_str.clone(),
            row: 1,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b2_id = cell_id_from_str(&b2_str);

    // Enter a 2x3 CSE on A1:C2.
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Writing to B2 (a member) must be rejected.
    let err = core
        .set_cell(&mut mirror, &sheet_id, b2_id, 1, 1, "X")
        .expect_err("partial-array write must be rejected");
    match err {
        ComputeError::PartialArrayWrite {
            row,
            col,
            anchor_row,
            anchor_col,
            ..
        } => {
            assert_eq!((row, col), (1, 1));
            assert_eq!((anchor_row, anchor_col), (0, 0));
        }
        other => panic!("expected PartialArrayWrite, got {:?}", other),
    }
}

#[test]
fn test_set_cell_rejects_partial_array_write_on_anchor() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Re-typing into the anchor (non-Clear) must be rejected — the
    // user must clear the array first.
    let err = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=A1+1")
        .expect_err("anchor non-clear write must be rejected");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "got {:?}",
        err,
    );
}

#[test]
fn test_clear_cells_on_anchor_tears_down_cse() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");
    assert!(mirror.is_cse_anchor(&a1_id));

    // clear_cells on the anchor tears down the CSE registration.
    let _ = core.clear_cells(&mut mirror, &[a1_id]).unwrap();

    assert!(
        !mirror.is_cse_anchor(&a1_id),
        "anchor must be unmarked after clear_cells",
    );
    assert!(
        mirror.projection_registry.get(&a1_id).is_none(),
        "projection must be cleared after clear_cells",
    );
}

#[test]
fn test_clear_anchor_via_set_cell_tears_down_cse() {
    // Per-architecture: anchor edits are rejected EXCEPT a Clear
    // input — that path tears down the CSE. This is the natural
    // entry point when the user selects the anchor and presses
    // Delete (which routes to ClearCells in the action layer, but
    // engine-internal callers can also issue CellInput::Clear via
    // set_cell directly).
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Clear the anchor via set_cell with CellInput::Clear.
    use crate::storage::engine::mutation::CellInput;
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, CellInput::Clear)
        .expect("Clear on anchor must succeed");

    assert!(
        !mirror.is_cse_anchor(&a1_id),
        "anchor must be unmarked after Clear on anchor",
    );
}

#[test]
fn test_set_array_formula_re_entry_replaces_extent() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // First entry: 2x3
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .unwrap();
    // Re-entry on the same anchor: 1x2 — should replace the prior extent.
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 0, 1, "=SEQUENCE(1,2)")
        .unwrap();

    let proj = mirror.projection_registry.get(&a1_id).expect("registered");
    assert_eq!(proj.rows, 1);
    assert_eq!(proj.cols, 2);
    assert!(mirror.is_cse_anchor(&a1_id));
}

// ---------------------------------------------------------------------------
// T6 table dependency work → 64: CSE rejection-family completeness.
//
// unified-reference over-rejected Clear on CSE members. table dependency work swung too
// far and allowed teardown via SubstituteAnchorClear. array-member clear regression
// corrects to true Excel parity: Clear on a single CSE member is
// rejected with PartialArrayWrite (same as typing). The user must
// select the entire CSE extent to delete.
//
//   6a) `Clear` on a CSE *member* is rejected with PartialArrayWrite.
//   6b) `set_array_formula` cross-CSE overlap check must scan the whole
//       new rectangle, not only its top-left corner.
// ---------------------------------------------------------------------------

#[test]
fn t6_clear_on_cse_member_rejects_with_partial_array_write() {
    // Anchor A1, 2x3 CSE on A1:C2. Clear B2 (a member) — must be
    // rejected with PartialArrayWrite (Excel parity: "You cannot
    // change part of an array"). The CSE must remain intact.
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b2_str.clone(),
            row: 1,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b2_id = cell_id_from_str(&b2_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula");

    assert!(mirror.is_cse_anchor(&a1_id));

    use crate::storage::engine::mutation::CellInput;
    let err = core
        .set_cell(&mut mirror, &sheet_id, b2_id, 1, 1, CellInput::Clear)
        .expect_err("Clear on CSE member must be rejected");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "expected PartialArrayWrite, got {:?}",
        err
    );
    assert!(
        mirror.is_cse_anchor(&a1_id),
        "CSE must remain intact after rejected member-Clear",
    );
}

#[test]
fn t6_clear_on_cse_member_via_clear_cells_tears_down_whole_array() {
    // Same family, different entry point: scheduler-level `clear_cells`
    // on a member ID also tears down the whole array.
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b2_str.clone(),
            row: 1,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b2_id = cell_id_from_str(&b2_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula");

    let _ = core.clear_cells(&mut mirror, &[b2_id]).unwrap();

    assert!(
        !mirror.is_cse_anchor(&a1_id),
        "anchor must be unmarked after clear_cells on member",
    );
}

#[test]
fn t6_type_into_member_still_rejected_with_partial_array_write() {
    // Type-into-member is the OTHER half of the family — that path
    // remains a reject. Lock it in so the family table stays correct.
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b2_str.clone(),
            row: 1,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b2_id = cell_id_from_str(&b2_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula");

    // Type "X" into B2 — text input on a CSE member: reject.
    let err = core
        .set_cell(&mut mirror, &sheet_id, b2_id, 1, 1, "X")
        .expect_err("Parse on CSE member must reject");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "got {:?}",
        err
    );
    // The CSE itself must NOT be torn down by the rejected attempt.
    assert!(mirror.is_cse_anchor(&a1_id));
}

#[test]
fn t6_set_array_formula_overlap_detected_by_interior_cells() {
    // legacy string-rewrite narrow check resolved only `(top_row, left_col)`. New
    // CSE C1:D3 overlapping existing A2:E2: C1 is OUTSIDE the old
    // extent, but C2/D2 are interior. filter viewport must detect this.
    let a2_str = cell_id_str(1, 0); // anchor of existing CSE
    let c1_str = cell_id_str(0, 2); // new anchor (outside old extent)
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a2_str.clone(),
            row: 1,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: c1_str.clone(),
            row: 0,
            col: 2,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a2_id = cell_id_from_str(&a2_str);
    let c1_id = cell_id_from_str(&c1_str);

    // Existing CSE: A2:E2 (1 row × 5 cols, anchored at A2).
    core.set_array_formula(&mut mirror, &sheet_id, a2_id, 1, 0, 1, 4, "=SEQUENCE(1,5)")
        .expect("first set_array_formula");

    // New CSE: C1:D3 (3 rows × 2 cols, anchored at C1). Top-left C1
    // is OUTSIDE the existing A2:E2; but interior cells C2/D2 are
    // inside. Must be rejected.
    let err = core
        .set_array_formula(&mut mirror, &sheet_id, c1_id, 0, 2, 2, 3, "=SEQUENCE(3,2)")
        .expect_err("interior-cell overlap must be rejected");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "got {:?}",
        err
    );
}

#[test]
fn t6_set_array_formula_non_overlapping_succeeds() {
    // Sanity: a non-overlapping CSE next to an existing one is allowed.
    let a1_str = cell_id_str(0, 0);
    let d1_str = cell_id_str(0, 3);
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: d1_str.clone(),
            row: 0,
            col: 3,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let d1_id = cell_id_from_str(&d1_str);

    // A1:B2
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 1, "=SEQUENCE(2,2)")
        .expect("first set_array_formula");
    // D1:E2 — adjacent, no overlap.
    core.set_array_formula(&mut mirror, &sheet_id, d1_id, 0, 3, 1, 4, "=SEQUENCE(2,2)")
        .expect("non-overlapping must succeed");

    assert!(mirror.is_cse_anchor(&a1_id));
    assert!(mirror.is_cse_anchor(&d1_id));
}

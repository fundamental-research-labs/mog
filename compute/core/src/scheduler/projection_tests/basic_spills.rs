#![allow(unused_imports)]

use super::super::test_helpers::*;
use super::super::*;
use super::helpers::*;
use crate::mirror::CellMirror;
use crate::snapshot::CellData;
use std::sync::Arc;
use value_types::CellValue;

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

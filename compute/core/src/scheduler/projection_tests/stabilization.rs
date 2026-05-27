#![allow(unused_imports)]

use super::super::test_helpers::*;
use super::super::*;
use super::helpers::*;
use crate::mirror::CellMirror;
use crate::snapshot::CellData;
use std::sync::Arc;
use value_types::CellValue;

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

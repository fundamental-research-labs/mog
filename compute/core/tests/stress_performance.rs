#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ===========================================================================
// Category 9: Performance and Timeout (6 tests)
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1: Deep chain no hang
//
// Build chain of 500 formulas: A1=1, A2="=A1+1"=2, ..., A500="=A499+1"=500.
// Assert A500=500.0 exactly. Assert changed_cells.len() <= 501 (linear).
// ---------------------------------------------------------------------------
#[test]
fn test_deep_500_cell_chain() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    // Build all 500 cells in the snapshot
    let mut cell_data: Vec<CellData> = Vec::new();
    // A1 (row=0) = constant 1
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    // A2..A500 (row=1..499): each ="=A{row}+1"
    for row in 1u32..500 {
        cell_data.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A{}+1", row)), // =A1+1, =A2+1, ..., =A499+1
            identity_formula: None,
            array_ref: None,
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: 1000,
            cols: 26,
            cells: cell_data,
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
    };

    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Assert exact chain values: A1=1, A2=2, ..., A500=500
    assert_mirror_number(&mirror, 0, 0, 0, 1.0); // A1
    assert_mirror_number(&mirror, 0, 1, 0, 2.0); // A2
    assert_mirror_number(&mirror, 0, 9, 0, 10.0); // A10
    assert_mirror_number(&mirror, 0, 99, 0, 100.0); // A100
    assert_mirror_number(&mirror, 0, 249, 0, 250.0); // A250
    assert_mirror_number(&mirror, 0, 499, 0, 500.0); // A500

    // Linear, not exponential: changed_cells should be at most 501
    assert!(
        result.changed_cells.len() <= 501,
        "changed_cells.len()={} exceeds 501 — possible exponential blowup",
        result.changed_cells.len()
    );
}

// ---------------------------------------------------------------------------
// Test 2: No leaked state after 200 edits
//
// Empty sheet. B1="=A1*2". Loop 200: set A1 to i. After each: A1=i, B1=2*i.
// After loop: A1=200, B1=400.
// ---------------------------------------------------------------------------
#[test]
fn test_no_leaked_state_200_edits() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 1000, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Set B1="=A1*2"
    let _r = set(&mut core, &mut mirror, 0, 0, 1, "=A1*2");
    // Initially A1=0 (empty→0 for formula), B1=0
    assert_mirror_number(&mirror, 0, 0, 1, 0.0);

    for i in 1u32..=200 {
        let _r = set(&mut core, &mut mirror, 0, 0, 0, &i.to_string());
        assert_mirror_number(&mirror, 0, 0, 0, i as f64);
        assert_mirror_number(&mirror, 0, 0, 1, (2 * i) as f64);
    }

    // Final state
    assert_mirror_number(&mirror, 0, 0, 0, 200.0);
    assert_mirror_number(&mirror, 0, 0, 1, 400.0);
}

// ---------------------------------------------------------------------------
// Test 3: Cycle detection scoping
//
// 100 formula chain (no cycles) A1..A100 via init_from_snapshot.
// Plus separate cycle B1="=C1+1", C1="=B1+1" (divergent, numeric cache preserved).
// Re-set B1 to "=C1+1" via set_cell. Assert changed_cells is small (< 10).
// The 100-cell chain should NOT be affected since it doesn't depend on B1/C1.
// ---------------------------------------------------------------------------
#[test]
fn test_cycle_recalc_scope_isolation() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    // Build snapshot with:
    //   A1=1 (constant), A2="=A1+1"=2, ..., A100="=A99+1"=100
    //   B1="=C1+1", C1="=B1+1" (divergent cycle)
    let mut cell_data: Vec<CellData> = Vec::new();

    // A1 = 1 (row=0, col=0)
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    // A2..A100 (row=1..99, col=0)
    for row in 1u32..100 {
        cell_data.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A{}+1", row)), // =A1+1, ..., =A99+1
            identity_formula: None,
            array_ref: None,
        });
    }
    // B1 (row=0, col=1) = "=C1+1"
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 1),
        row: 0,
        col: 1,
        value: CellValue::number(0.0),
        formula: Some("=C1+1".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    // C1 (row=0, col=2) = "=B1+1"
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 2),
        row: 0,
        col: 2,
        value: CellValue::number(0.0),
        formula: Some("=B1+1".to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: 1000,
            cols: 26,
            cells: cell_data,
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
    };

    let _init_result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Chain should be correct
    assert_mirror_number(&mirror, 0, 0, 0, 1.0); // A1
    assert_mirror_number(&mirror, 0, 99, 0, 100.0); // A100

    assert_mirror_number(&mirror, 0, 0, 1, 0.0);
    assert_mirror_number(&mirror, 0, 0, 2, 0.0);

    // Now re-set B1 to same formula via set_cell (incremental path).
    // set_cell detects cycle → B1 gets #REF!, but the chain should NOT be recalculated.
    let result = set(&mut core, &mut mirror, 0, 0, 1, "=C1+1");

    // The chain cells (A1..A100) should not appear in changed_cells
    // Only B1 (and possibly C1) should be affected
    assert!(
        result.changed_cells.len() < 10,
        "changed_cells.len()={} — the 100-cell chain should NOT be recalculated",
        result.changed_cells.len()
    );

    // Chain values should be intact
    assert_mirror_number(&mirror, 0, 0, 0, 1.0); // A1
    assert_mirror_number(&mirror, 0, 49, 0, 50.0); // A50
    assert_mirror_number(&mirror, 0, 99, 0, 100.0); // A100
}

// ---------------------------------------------------------------------------
// Test 4: Large convergent cycle iteration count
//
// 100-cell ring, all "=prev*0.99+0.01", iterative(10000, 0.001).
// Fixed point: x = 0.99*x + 0.01 → 0.01*x = 0.01 → x = 1.0.
// Assert all cells ≈ 1.0 within 0.01.
// Assert metrics.iterative_iterations < 10000 (converged before cap).
// ---------------------------------------------------------------------------
#[test]
fn test_100_cell_convergent_ring() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    // Build 100-cell ring in column A: A1="=A100*0.99+0.01", A2="=A1*0.99+0.01", ...
    let mut cell_data: Vec<CellData> = Vec::new();
    // A1 (row=0) references A100 (row=99)
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::number(0.0),
        formula: Some("=A100*0.99+0.01".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    // A2..A100 (row=1..99)
    for row in 1u32..100 {
        cell_data.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A{}*0.99+0.01", row)), // =A1*0.99+0.01, ..., =A99*0.99+0.01
            identity_formula: None,
            array_ref: None,
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: 1000,
            cols: 26,
            cells: cell_data,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: true,
        max_iterations: 10000,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Fixed point: x = 0.99x + 0.01 → x = 1.0
    // Check all 100 cells
    for row in 0u32..100 {
        assert_mirror_number_tol(&mirror, 0, row, 0, 1.0, 0.01);
    }

    // Must have circular refs
    assert!(
        result.metrics.has_circular_refs,
        "100-cell ring should detect circular refs"
    );

    // Should converge well before the 10000 cap
    assert!(
        result.metrics.iterative_iterations < 10000,
        "Expected convergence before 10000 iterations, got {}",
        result.metrics.iterative_iterations
    );
}

// ---------------------------------------------------------------------------
// Test 5: Timeout proxy via max_iterations
//
// Divergent cycle A1="=B1+1", B1="=A1+1" with max_iterations=10.
// Assert metrics.iterative_iterations == 10 (or close — hit the cap).
// The values will be Numbers from the iterative solver after only 10 iters.
// Assert A1 and B1 are Numbers and self-consistent.
// ---------------------------------------------------------------------------
#[test]
fn test_divergent_cycle_capped_at_max_iterations() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1+1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1+1")), // B1
            ],
        )],
        10, // max_iterations = 10 (low cap)
        0.001,
    );

    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Must have circular refs
    assert!(
        result.metrics.has_circular_refs,
        "Divergent cycle should detect circular refs"
    );

    // Should hit the iteration cap (10)
    assert_eq!(
        result.metrics.iterative_iterations, 10,
        "Expected exactly 10 iterations (cap), got {}",
        result.metrics.iterative_iterations
    );

    // Both cells should be Numbers (iterative solver produces Numbers, not errors)
    let _a1 = read_mirror_number(&mirror, 0, 0, 0);
    let b1 = read_mirror_number(&mirror, 0, 0, 1);

    // Self-consistency: A1's formula is "=B1+1", so A1 should ≈ B1+1
    // B1's formula is "=A1+1", so B1 should ≈ A1+1
    // With only 10 iterations of a divergent cycle, values are small numbers.
    // The divergent cycle alternates, so last-iteration consistency has slack.
    assert_cycle_self_consistent(
        &mirror,
        0,
        0,
        0,
        || b1 + 1.0,
        3.0,
        "A1 = B1+1 after 10 iterations of divergent cycle",
    );
}

// ---------------------------------------------------------------------------
// Test 6: Memory stability after 500 cycles
//
// Loop 500: create cycle via set_cells(skip=true) with A1="=B1+1", B1="=A1+1".
// Then break: set_cells(skip=false) A1="1", B1="2".
// Assert A1=1, B1=2 each time. After all 500: A1=1, B1=2 (final state clean).
// ---------------------------------------------------------------------------
#[test]
fn test_memory_stability_500_create_break_cycles() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let s = sid(0);

    for _i in 0u32..500 {
        // Create divergent cycle via skip_cycle_check=true
        let cycle_edits: Vec<(
            SheetId,
            CellId,
            u32,
            u32,
            compute_core::bridge_types::CellInput,
        )> = vec![
            (
                s,
                cid(0, 0, 0),
                0,
                0,
                compute_core::bridge_types::CellInput::Parse {
                    text: "=B1+1".to_string(),
                },
            ),
            (
                s,
                cid(0, 0, 1),
                0,
                1,
                compute_core::bridge_types::CellInput::Parse {
                    text: "=A1+1".to_string(),
                },
            ),
        ];
        let _r = core.set_cells(&mut mirror, &cycle_edits, true).unwrap();

        // Break cycle by setting constant values (skip_cycle_check=false)
        let break_edits: Vec<(
            SheetId,
            CellId,
            u32,
            u32,
            compute_core::bridge_types::CellInput,
        )> = vec![
            (
                s,
                cid(0, 0, 0),
                0,
                0,
                compute_core::bridge_types::CellInput::Parse {
                    text: "1".to_string(),
                },
            ),
            (
                s,
                cid(0, 0, 1),
                0,
                1,
                compute_core::bridge_types::CellInput::Parse {
                    text: "2".to_string(),
                },
            ),
        ];
        let _r = core.set_cells(&mut mirror, &break_edits, false).unwrap();

        // Assert clean state after breaking the cycle
        assert_mirror_number(&mirror, 0, 0, 0, 1.0);
        assert_mirror_number(&mirror, 0, 0, 1, 2.0);
    }

    // Final state after all 500 iterations is clean
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert_mirror_number(&mirror, 0, 0, 1, 2.0);
}

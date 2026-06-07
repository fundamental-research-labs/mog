#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use formula_types::{NamedRangeDef, Scope};
use value_types::{CellError, CellValue, FiniteF64};

/// Create a ComputeCore+Mirror with an empty Sheet1 and seed the given cells
/// with value "0" via set_cell so they exist in the dependency graph.
fn core_with_seeds(seed_positions: &[(u32, u32)]) -> (ComputeCore, CellMirror) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    for &(row, col) in seed_positions {
        set(&mut core, &mut mirror, 0, row, col, "0");
    }
    (core, mirror)
}

// ---------------------------------------------------------------------------
// Test 01: Two-cell cycle via set_cell
// Seed B1=0. A1="=B1+1"→A1=1. B1="=A1+1"→B1=#REF!.
// After B1 gets #REF!, A1 depends on B1 so A1 recalcs to #REF! too.
// ---------------------------------------------------------------------------
#[test]
fn test_incremental_two_cell_cycle() {
    let (mut core, mut mirror) = core_with_seeds(&[(0, 1)]);

    // A1="=B1+1": B1=0, so A1=0+1=1
    let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);

    // B1="=A1+1": creates cycle → B1=#REF!, deps not registered.
    // A1 depends on B1, so A1 recalculates: =B1+1 where B1=#REF! → A1=#REF!.
    let _r2 = set(&mut core, &mut mirror, 0, 0, 1, "=A1+1");
    assert!(
        is_ref_error(&mirror, 0, 0, 1),
        "B1 should be #REF! (cycle rejected)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 should be #REF! (propagated from B1)"
    );
}

// ---------------------------------------------------------------------------
// Test 02: Three-cell cycle
// Seed B1,C1=0. A1="=C1+1"→1, B1="=A1+1"→2, C1="=B1+1"→#REF!.
// Propagation: A1 depends on C1(#REF!)→#REF!, B1 depends on A1(#REF!)→#REF!.
// ---------------------------------------------------------------------------
#[test]
fn test_incremental_three_cell_cycle() {
    let (mut core, mut mirror) = core_with_seeds(&[(0, 1), (0, 2)]);

    let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=C1+1"); // C1=0, A1=1
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);

    let _r2 = set(&mut core, &mut mirror, 0, 0, 1, "=A1+1"); // A1=1, B1=2
    assert_mirror_number(&mirror, 0, 0, 1, 2.0);

    // C1="=B1+1" closes cycle → C1=#REF!.
    // A1="=C1+1" recalculates: C1=#REF! → A1=#REF!.
    // B1="=A1+1" recalculates: A1=#REF! → B1=#REF!.
    let _r3 = set(&mut core, &mut mirror, 0, 0, 2, "=B1+1");
    assert!(
        is_ref_error(&mirror, 0, 0, 2),
        "C1 should be #REF! (cycle rejected)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 should be #REF! (propagated)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 1),
        "B1 should be #REF! (propagated)"
    );
}

// ---------------------------------------------------------------------------
// Test 03: Five-cell ring
// A1→E1→D1→C1→B1→A1. E1 closes ring → E1=#REF!.
// Propagation: A1 depends on E1→#REF!, B1→#REF!, C1→#REF!, D1→#REF!.
// ---------------------------------------------------------------------------
#[test]
fn test_incremental_five_cell_ring() {
    let (mut core, mut mirror) = core_with_seeds(&[(0, 1), (0, 2), (0, 3), (0, 4)]);

    let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=E1+1"); // E1=0 → A1=1
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);

    let _r2 = set(&mut core, &mut mirror, 0, 0, 1, "=A1+1"); // A1=1 → B1=2
    assert_mirror_number(&mirror, 0, 0, 1, 2.0);

    let _r3 = set(&mut core, &mut mirror, 0, 0, 2, "=B1+1"); // B1=2 → C1=3
    assert_mirror_number(&mirror, 0, 0, 2, 3.0);

    let _r4 = set(&mut core, &mut mirror, 0, 0, 3, "=C1+1"); // C1=3 → D1=4
    assert_mirror_number(&mirror, 0, 0, 3, 4.0);

    // E1="=D1+1" closes ring → E1=#REF! (cycle rejected).
    // All predecessors recalculate: A1=E1+1→#REF!, B1→#REF!, C1→#REF!, D1→#REF!.
    let _r5 = set(&mut core, &mut mirror, 0, 0, 4, "=D1+1");
    assert!(
        is_ref_error(&mirror, 0, 0, 4),
        "E1 should be #REF! (cycle rejected)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 should be #REF! (propagated from E1)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 1),
        "B1 should be #REF! (propagated from A1)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 2),
        "C1 should be #REF! (propagated from B1)"
    );
    assert!(
        is_ref_error(&mirror, 0, 0, 3),
        "D1 should be #REF! (propagated from C1)"
    );
}

// ---------------------------------------------------------------------------
// Test 04: Self-reference
// A1="=A1+1" → #REF!
// ---------------------------------------------------------------------------
#[test]
fn test_incremental_self_reference() {
    let (mut core, mut mirror) = core_with_seeds(&[]);

    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=A1+1");
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 self-ref should be #REF!"
    );
}

// ---------------------------------------------------------------------------
// Test 05: Batch set_cells(skip_cycle_check=false)
// Both A1="=B1+1" and B1="=A1+1" in one call.
// First edit (A1) succeeds — B1 has no formula deps yet.
// Second edit (B1) creates cycle → #REF!.
// Then recalc propagates: A1 depends on B1(#REF!) → A1=#REF!.
// ---------------------------------------------------------------------------
#[test]
fn test_batch_set_cells_cycle_detection() {
    let (mut core, mut mirror) = core_with_seeds(&[(0, 0), (0, 1)]);

    let s = sid(0);
    let edits: Vec<(
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
    let _r = core.set_cells(&mut mirror, &edits, false).unwrap();

    // Second edit (B1) creates cycle → #REF!
    assert!(
        is_ref_error(&mirror, 0, 0, 1),
        "B1 should be #REF! in batch"
    );

    // A1 depends on B1(#REF!) → propagated #REF!
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 should be #REF! (propagated from B1)"
    );
}

// ---------------------------------------------------------------------------
// Test 06: Convergent two-cell cycle via init_from_snapshot
// A1="=B1*0.5+1", B1="=A1*0.5+1", iterative(100,0.001)
// Fixed point: x=0.5y+1, y=0.5x+1 → x=y=2.0
// ---------------------------------------------------------------------------
#[test]
fn test_convergent_two_cell_fixed_point() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (
                    0,
                    0,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=B1*0.5+1"),
                ),
                (
                    0,
                    1,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=A1*0.5+1"),
                ),
            ],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);
    assert!(
        result.metrics.has_circular_refs,
        "Should detect circular refs"
    );
}

// ---------------------------------------------------------------------------
// Test 07: Self-ref convergent
// A1="=A1*0.5+1", iterative. x=0.5x+1 → x=2.0
// ---------------------------------------------------------------------------
#[test]
fn test_convergent_self_ref_fixed_point() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![(
                0,
                0,
                CellValue::Number(FiniteF64::must(0.0)),
                Some("=A1*0.5+1"),
            )],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01);
    assert!(
        result.metrics.has_circular_refs,
        "Should detect circular refs"
    );
}

// ---------------------------------------------------------------------------
// Test 08: Cross-sheet divergent cycle via init_from_snapshot
// Sheet1!A1="=Sheet2!A1+1", Sheet2!A1="=Sheet1!A1+1"
// Divergent. Assert has_circular_refs, self-consistency.
// ---------------------------------------------------------------------------
#[test]
fn test_cross_sheet_divergent_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            100,
            26,
            vec![(
                0,
                0,
                CellValue::Number(FiniteF64::must(0.0)),
                Some("=Sheet2!A1+1"),
            )],
        ),
        (
            "Sheet2",
            100,
            26,
            vec![(
                0,
                0,
                CellValue::Number(FiniteF64::must(0.0)),
                Some("=Sheet1!A1+1"),
            )],
        ),
    ]);
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert!(
        result.metrics.has_circular_refs,
        "Cross-sheet cycle should be detected"
    );

    assert_mirror_number(&mirror, 0, 0, 0, 0.0);
    assert_mirror_number(&mirror, 1, 0, 0, 0.0);
}

// ---------------------------------------------------------------------------
// Test 09: Named range cycle via init_from_snapshot
// A1="=B1+1", B1="=NR+1" where NR→Sheet1!A1. Divergent.
// ---------------------------------------------------------------------------
#[test]
fn test_named_range_divergent_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let mut snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Number(FiniteF64::must(0.0)), Some("=B1+1")),
            (0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=NR+1")),
        ],
    )]);
    snapshot.named_ranges.push(NamedRangeDef::from_expression(
        "NR".into(),
        Scope::Workbook,
        "Sheet1!A1".into(),
    ));
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert!(
        result.metrics.has_circular_refs,
        "Named range cycle should be detected"
    );

    assert_mirror_number(&mirror, 0, 0, 0, 0.0);
    assert_mirror_number(&mirror, 0, 0, 1, 0.0);
}

// ---------------------------------------------------------------------------
// Test 10: 20-cell ring via init_from_snapshot
// A1="=A20+1", A2="=A1+1", ..., A20="=A19+1". Divergent.
// Assert has_circular_refs. Assert numeric cached values are preserved.
// Assert changed_cells.len() <= 21 (no exponential blowup).
// ---------------------------------------------------------------------------
#[test]
fn test_large_20_cell_ring() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();

    let mut cell_data: Vec<CellData> = Vec::new();
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::Number(FiniteF64::must(0.0)),
        formula: Some("=A20+1".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    for row in 1u32..20 {
        cell_data.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::Number(FiniteF64::must(0.0)),
            formula: Some(format!("=A{}+1", row)), // =A1+1, =A2+1, ..., =A19+1
            identity_formula: None,
            array_ref: None,
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: 100,
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

    assert!(
        result.metrics.has_circular_refs,
        "20-cell ring should be detected as circular"
    );

    for row in 0u32..20 {
        assert_mirror_number(&mirror, 0, row, 0, 0.0);
    }

    // No exponential blowup: changed_cells should be at most 21 (20 ring cells + margin)
    assert!(
        result.changed_cells.len() <= 21,
        "changed_cells.len()={} exceeds 21 — exponential blowup?",
        result.changed_cells.len()
    );
}

// ---------------------------------------------------------------------------
// Test 11: Cycle with constant feeder, convergent
// C1=100, A1="=B1+C1", B1="=A1*0.5", iterative(200,0.001)
// A1=B1+100, B1=A1/2 → A1=A1/2+100 → A1=200, B1=100
// ---------------------------------------------------------------------------
#[test]
fn test_convergent_cycle_with_constant_feeder() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (
                    0,
                    0,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=B1+C1"),
                ),
                (
                    0,
                    1,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=A1*0.5"),
                ),
                (0, 2, CellValue::Number(FiniteF64::must(100.0)), None),
            ],
        )],
        200,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number_tol(&mirror, 0, 0, 0, 200.0, 0.01); // A1=200
    assert_mirror_number_tol(&mirror, 0, 0, 1, 100.0, 0.01); // B1=100
    assert_mirror_number(&mirror, 0, 0, 2, 100.0); // C1=100
    assert!(
        result.metrics.has_circular_refs,
        "Should detect circular refs"
    );
}

#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Test 01: apply_changes creating cycle (skip_cycle_check=true)
// Empty sheet. Apply A1="=B1+1" and B1="=A1+1" with skip=true.
// Cycle diagnostics are emitted. Mutation-created cycle cells materialize as #CIRC.
// ---------------------------------------------------------------------------
#[test]
fn test_apply_changes_creates_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let edits = vec![
        make_edit(
            0,
            0,
            0,
            CellValue::Number(FiniteF64::must(0.0)),
            Some("=B1+1"),
        ),
        make_edit(
            0,
            0,
            1,
            CellValue::Number(FiniteF64::must(0.0)),
            Some("=A1+1"),
        ),
    ];
    let result = core.apply_changes(&mut mirror, &edits, true).unwrap();

    // Cycle detected: errors contain "Circular" diagnostics for cycle cells
    assert!(
        has_any_circular_error(&result),
        "Cycle should be detected with skip_cycle_check=true"
    );

    assert_mirror_error(&mirror, 0, 0, 0, CellError::Circ);
    assert_mirror_error(&mirror, 0, 0, 1, CellError::Circ);
}

// ---------------------------------------------------------------------------
// Test 02: apply_changes breaking a cycle
// Init with divergent cycle A1="=B1+1", B1="=A1+1".
// Apply change: A1=5 (plain value). Breaks cycle. B1="=A1+1"=6.
// ---------------------------------------------------------------------------
#[test]
fn test_apply_changes_breaks_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Number(FiniteF64::must(0.0)), Some("=B1+1")),
            (0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=A1+1")),
        ],
    )]);
    let init_result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(
        init_result.metrics.has_circular_refs,
        "Initial snapshot should have circular refs"
    );

    // Break the cycle: set A1 to plain value 5
    let edits = vec![make_edit(
        0,
        0,
        0,
        CellValue::Number(FiniteF64::must(5.0)),
        None,
    )];
    let _result = core.apply_changes(&mut mirror, &edits, false).unwrap();

    // A1=5 (plain value), B1="=A1+1"=6
    assert_mirror_number(&mirror, 0, 0, 0, 5.0);
    assert_mirror_number(&mirror, 0, 0, 1, 6.0);
}

// ---------------------------------------------------------------------------
// Test 03: skip_cycle_check comparison
// skip=false: last edit gets #REF!. skip=true: cycle reaches non-iterative
// materialization because parsed formulas do not carry numeric cached values.
// ---------------------------------------------------------------------------
#[test]
fn test_skip_cycle_check_comparison() {
    // --- Path 1: skip_cycle_check=false ---
    let mut core1 = ComputeCore::new();
    let mut mirror1 = CellMirror::default();
    let snapshot1 = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core1.init_from_snapshot(&mut mirror1, snapshot1).unwrap();

    let s = sid(0);
    let edits_no_skip: Vec<(
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
                text: "=B1".to_string(),
            },
        ),
        (
            s,
            cid(0, 0, 1),
            0,
            1,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A1".to_string(),
            },
        ),
    ];
    let _r1 = core1
        .set_cells(&mut mirror1, &edits_no_skip, false)
        .unwrap();

    // With skip=false, B1 (second edit) creates cycle → #REF!
    assert!(
        is_ref_error(&mirror1, 0, 0, 1),
        "B1 should be #REF! with skip_cycle_check=false"
    );

    // --- Path 2: skip_cycle_check=true ---
    let mut core2 = ComputeCore::new();
    let mut mirror2 = CellMirror::default();
    let snapshot2 = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core2.init_from_snapshot(&mut mirror2, snapshot2).unwrap();

    let s2 = sid(0);
    let edits_skip: Vec<(
        SheetId,
        CellId,
        u32,
        u32,
        compute_core::bridge_types::CellInput,
    )> = vec![
        (
            s2,
            cid(0, 0, 0),
            0,
            0,
            compute_core::bridge_types::CellInput::Parse {
                text: "=B1".to_string(),
            },
        ),
        (
            s2,
            cid(0, 0, 1),
            0,
            1,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A1".to_string(),
            },
        ),
    ];
    let r2 = core2.set_cells(&mut mirror2, &edits_skip, true).unwrap();

    // With skip=true, circular diagnostics are emitted and non-numeric cycle
    // cells materialize as #CIRC.
    assert!(
        has_any_circular_error(&r2),
        "With skip=true, should detect circular refs"
    );
    assert_mirror_error(&mirror2, 0, 0, 0, CellError::Circ);
    assert_mirror_error(&mirror2, 0, 0, 1, CellError::Circ);
}

// ---------------------------------------------------------------------------
// Test 04: Interleaved set_cell and apply_changes
// set_cell A1="=B1+1" (no cycle). Then apply_changes B1="=A1+1".
// Test both skip=false (B1=#REF!) and skip=true (#CIRC materialization).
// ---------------------------------------------------------------------------
#[test]
fn test_interleaved_set_cell_and_apply_changes() {
    // --- Path A: skip=false → B1=#REF! ---
    {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::default();
        let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        // set_cell A1="=B1+1": B1 empty (0), A1=1
        let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
        assert_mirror_number(&mirror, 0, 0, 0, 1.0);

        // apply_changes B1="=A1+1" with skip=false → cycle → B1=#REF!
        let edits = vec![make_edit(
            0,
            0,
            1,
            CellValue::Number(FiniteF64::must(0.0)),
            Some("=A1+1"),
        )];
        let _r2 = core.apply_changes(&mut mirror, &edits, false).unwrap();

        // B1 is rejected with #REF! due to cycle detection
        assert!(
            is_ref_error(&mirror, 0, 0, 1),
            "B1 should be #REF! with skip=false"
        );
        // A1 may also become #REF! due to error propagation during recalc
        // (B1=#REF! and A1="=B1+1" may propagate the error), or it may stay 1.0
        // depending on recalc ordering. Either outcome is valid.
        let a1_val = read_mirror_value(&mirror, 0, 0, 0);
        assert!(
            matches!(
                a1_val,
                Some(CellValue::Number(_)) | Some(CellValue::Error(CellError::Ref, _))
            ),
            "A1 should be either Number or #REF! after cycle rejection, got {:?}",
            a1_val
        );
    }

    // --- Path B: skip=true → mutation-created cycle materializes as #CIRC ---
    {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::default();
        let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
        assert_mirror_number(&mirror, 0, 0, 0, 1.0);

        let edits = vec![make_edit(
            0,
            0,
            1,
            CellValue::Number(FiniteF64::must(0.0)),
            Some("=A1+1"),
        )];
        let r2 = core.apply_changes(&mut mirror, &edits, true).unwrap();

        // Circular diagnostics emitted
        assert!(
            has_any_circular_error(&r2),
            "Should detect circular refs with skip=true"
        );
        assert_mirror_error(&mirror, 0, 0, 0, CellError::Circ);
        assert_mirror_error(&mirror, 0, 0, 1, CellError::Circ);
    }
}

// ---------------------------------------------------------------------------
// Test 05: Undo simulation
// A1="=B1+1"→1. set_cell B1="=A1+1"→#REF!. Revert B1 via apply_changes.
// After revert: B1=Null, A1="=B1+1"=1 (Null→0, 0+1=1).
// ---------------------------------------------------------------------------
#[test]
fn test_undo_via_apply_changes() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // A1="=B1+1": B1 empty, A1=1
    let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);

    // B1="=A1+1" → #REF! (cycle)
    let _r2 = set(&mut core, &mut mirror, 0, 0, 1, "=A1+1");
    assert!(is_ref_error(&mirror, 0, 0, 1), "B1 should be #REF!");

    // Undo: revert B1 to Null via apply_changes
    let edits = vec![make_edit(0, 0, 1, CellValue::Null, None)];
    let _r3 = core.apply_changes(&mut mirror, &edits, false).unwrap();

    // B1 is now Null (empty), A1="=B1+1" → 0+1=1
    assert_mirror_null(&mirror, 0, 0, 1);
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
}

// ---------------------------------------------------------------------------
// Test 06: Redo simulation
// After undo (B1=Null, A1=1), re-apply B1="=A1+1" via apply_changes(skip=true).
// Mutation-created cycle cells materialize as #CIRC. Assert circular refs detected.
// ---------------------------------------------------------------------------
#[test]
fn test_redo_via_apply_changes() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Setup: A1="=B1+1"→1
    let _r1 = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);

    // B1="=A1+1" → #REF!
    let _r2 = set(&mut core, &mut mirror, 0, 0, 1, "=A1+1");
    assert!(is_ref_error(&mirror, 0, 0, 1));

    // Undo: revert B1
    let undo_edits = vec![make_edit(0, 0, 1, CellValue::Null, None)];
    let _r3 = core.apply_changes(&mut mirror, &undo_edits, false).unwrap();
    assert_mirror_null(&mirror, 0, 0, 1);
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);

    // Redo: re-apply B1="=A1+1" with skip=true.
    let redo_edits = vec![make_edit(
        0,
        0,
        1,
        CellValue::Number(FiniteF64::must(0.0)),
        Some("=A1+1"),
    )];
    let r4 = core.apply_changes(&mut mirror, &redo_edits, true).unwrap();

    // Circular diagnostics emitted
    assert!(
        has_any_circular_error(&r4),
        "Redo should detect circular refs"
    );
    assert_mirror_error(&mirror, 0, 0, 0, CellError::Circ);
    assert_mirror_error(&mirror, 0, 0, 1, CellError::Circ);
}

// ---------------------------------------------------------------------------
// Test 07: Large batch — 50 edits via apply_changes
// 48 plain values (C1..C48 = 1..48) + A1="=B1+1", B1="=A1+1" (cycle).
// skip=true. Assert exact values for plain cells and cycle detection.
// ---------------------------------------------------------------------------
#[test]
fn test_large_batch_50_edits() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let mut edits = Vec::with_capacity(50);

    // 48 plain values: C1..C48 (col=2, rows 0..48), values 1..48
    for row in 0u32..48 {
        let val = (row + 1) as f64;
        edits.push(make_edit(
            0,
            row,
            2,
            CellValue::Number(FiniteF64::must(val)),
            None,
        ));
    }

    // A1="=B1+1", B1="=A1+1" — cycle
    edits.push(make_edit(
        0,
        0,
        0,
        CellValue::Number(FiniteF64::must(0.0)),
        Some("=B1+1"),
    ));
    edits.push(make_edit(
        0,
        0,
        1,
        CellValue::Number(FiniteF64::must(0.0)),
        Some("=A1+1"),
    ));

    let result = core.apply_changes(&mut mirror, &edits, true).unwrap();

    // Assert exact plain values
    assert_mirror_number(&mirror, 0, 0, 2, 1.0); // C1=1
    assert_mirror_number(&mirror, 0, 9, 2, 10.0); // C10=10
    assert_mirror_number(&mirror, 0, 47, 2, 48.0); // C48=48

    // A1 and B1 are in cycle — circular diagnostics emitted
    assert!(
        has_any_circular_error(&result),
        "Cycle among A1,B1 should be detected"
    );
    assert_mirror_error(&mirror, 0, 0, 0, CellError::Circ);
    assert_mirror_error(&mirror, 0, 0, 1, CellError::Circ);
}

// ---------------------------------------------------------------------------
// Test 08: Mixed formulas and values — no cycle
// apply_changes: A1="=B1+1", B1=100 (plain value). No cycle. A1=101, B1=100.
// ---------------------------------------------------------------------------
#[test]
fn test_mixed_formulas_and_values_no_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let edits = vec![
        make_edit(
            0,
            0,
            0,
            CellValue::Number(FiniteF64::must(0.0)),
            Some("=B1+1"),
        ),
        make_edit(0, 0, 1, CellValue::Number(FiniteF64::must(100.0)), None),
    ];
    let result = core.apply_changes(&mut mirror, &edits, false).unwrap();

    assert_mirror_number(&mirror, 0, 0, 1, 100.0); // B1=100
    assert_mirror_number(&mirror, 0, 0, 0, 101.0); // A1="=B1+1"=101
    assert!(
        !has_any_circular_error(&result),
        "No cycle should be detected"
    );
}

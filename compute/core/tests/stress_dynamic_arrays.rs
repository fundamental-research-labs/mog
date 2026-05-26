#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Test 01: SEQUENCE spill adjacent to convergent cycle
// A1="=SEQUENCE(5)" → A1:A5 = 1..5
// B1="=C1+1", C1="=B1*0.5" → convergent iterative FP: B1=2, C1=1
// Then edit A1="=SEQUENCE(10)" → A6:A10 = 6..10, cycle unchanged
// ---------------------------------------------------------------------------
#[test]
fn test_sequence_spill_adjacent_to_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                // A1: SEQUENCE(5) — spills A1:A5 = 1..5
                (0, 0, CellValue::number(0.0), Some("SEQUENCE(5)")),
                // B1="=C1+1", C1="=B1*0.5" — convergent cycle
                (0, 1, CellValue::number(0.0), Some("C1+1")),
                (0, 2, CellValue::number(0.0), Some("B1*0.5")),
            ],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // SEQUENCE(5) should spill A1:A5 = 1,2,3,4,5
    // A1 is the origin cell (has CellId); A2:A5 are spill targets (position-based)
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert_pos_number(&mirror, 0, 1, 0, 2.0);
    assert_pos_number(&mirror, 0, 2, 0, 3.0);
    assert_pos_number(&mirror, 0, 3, 0, 4.0);
    assert_pos_number(&mirror, 0, 4, 0, 5.0);

    // Convergent cycle: B1=C1+1, C1=B1*0.5 → B1=2, C1=1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 1.0, 0.01);
    assert!(result.metrics.has_circular_refs);

    // Edit A1 to SEQUENCE(10)
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=SEQUENCE(10)");

    // A1:A10 = 1..10 (origin + spill targets)
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    for i in 1u32..10 {
        assert_pos_number(&mirror, 0, i, 0, (i + 1) as f64);
    }

    // Cycle cells should be unchanged
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 1.0, 0.01);
}

// ---------------------------------------------------------------------------
// Test 02: SUM over spill in convergent cycle
// A1="=SEQUENCE(5)" → 1..5, SUM(A1:A5)=15
// B1="=SUM(A1:A5)+C1", C1="=B1*0.5" iterative
// B1=15+C1, C1=B1/2 → B1=15+B1/2 → B1=30, C1=15
// Edit A1="=SEQUENCE(10)" → SUM=55 → B1=110, C1=55
// ---------------------------------------------------------------------------
#[test]
fn test_sum_over_spill_in_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(0.0), Some("SEQUENCE(5)")),
                (0, 1, CellValue::number(0.0), Some("SUM(A1:A5)+C1")),
                (0, 2, CellValue::number(0.0), Some("B1*0.5")),
            ],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // B1=30, C1=15
    assert_mirror_number_tol(&mirror, 0, 0, 1, 30.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 15.0, 0.01);
    assert!(result.metrics.has_circular_refs);

    // Edit A1="=SEQUENCE(10)" → SUM(A1:A5) stays 15 but now A1:A10 = 1..10
    // Actually SUM(A1:A5) is fixed range — with SEQUENCE(10) spilling, A1:A5 = 1..5 still
    // SUM(A1:A5) = 15 still. Let's re-read the spec: SUM=55 means SUM(A1:A5) should
    // pick up the new values. But A1:A5 = 1..5 regardless of spill size.
    // The spec says SUM=55, so it must mean the formula references A1:A10 or the full spill.
    // Let me match the spec: after edit, B1=110, C1=55.
    // This requires SUM to be over A1:A10 from the start, but SEQUENCE(5) only fills A1:A5.
    // With SEQUENCE(5), A6:A10 are empty=0, so SUM(A1:A10)=15. With SEQUENCE(10), SUM=55.
    // Update: The formula must reference A1:A10 to get the spec behavior. But the spec says
    // "SUM(A1:A5)" for the initial. Let me just follow the spec literally and use A1:A5
    // for the initial formula, and accept that after spill change the SUM range stays A1:A5.
    // The spec says the SUM becomes 55 after SEQUENCE(10), so we need formula "SUM(A1:A10)".
    // I'll adjust: use B1="=SUM(A1:A10)+C1" — with SEQUENCE(5), A6:A10=0, SUM=15.
    // With SEQUENCE(10), SUM=55. This matches the spec's intended behavior.

    // Actually, let's just re-init with the correct formula. The snapshot already has SUM(A1:A5).
    // Let me re-read: the spec says A1="=SEQUENCE(5)" (1..5), B1="=SUM(A1:A5)+C1".
    // After edit A1="=SEQUENCE(10)" (1..10, SUM=55). But SUM(A1:A5) = 1+2+3+4+5 = 15 still.
    // The spec must intend SUM over the spill range. Let's use A1:A10 in the formula.
    drop(core);
    drop(mirror);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(0.0), Some("SEQUENCE(5)")),
                // Use SUM(A1:A10) so that with SEQUENCE(5) we get SUM=15, with SEQUENCE(10) we get 55
                (0, 1, CellValue::number(0.0), Some("SUM(A1:A10)+C1")),
                (0, 2, CellValue::number(0.0), Some("B1*0.5")),
            ],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // SEQUENCE(5) → A1:A5=1..5, A6:A10=0. SUM(A1:A10)=15.
    // B1=15+C1, C1=B1/2 → B1=30, C1=15
    assert_mirror_number_tol(&mirror, 0, 0, 1, 30.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 15.0, 0.01);
    assert!(result.metrics.has_circular_refs);

    // Edit A1="=SEQUENCE(10)" → SUM(A1:A10)=55
    // B1=55+C1, C1=B1/2 → B1=110, C1=55
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=SEQUENCE(10)");
    assert_mirror_number_tol(&mirror, 0, 0, 1, 110.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 55.0, 0.01);
}

// ---------------------------------------------------------------------------
// Test 03: CRITICAL — Spill shrink stale projection (Finding A2 regression)
// A1="=SEQUENCE(10)" → 1..10, B1="=SUM(A1:A10)"=55
// set A1="=SEQUENCE(5)" → A1:A5=1..5, A6:A10=Null
// B1=SUM(A1:A10) = 1+2+3+4+5+0+0+0+0+0 = 15 (NOT 55)
// ---------------------------------------------------------------------------
#[test]
fn test_spill_shrink_stale_projection() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(0.0), Some("SEQUENCE(10)")),
            (0, 1, CellValue::number(0.0), Some("SUM(A1:A10)")),
        ],
    )]);
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Initial: A1:A10 = 1..10, B1 = 55
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert_pos_number(&mirror, 0, 9, 0, 10.0);
    assert_mirror_number(&mirror, 0, 0, 1, 55.0);

    // Shrink spill: A1="=SEQUENCE(5)"
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=SEQUENCE(5)");

    // A1:A5 = 1..5
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    for i in 1u32..5 {
        assert_pos_number(&mirror, 0, i, 0, (i + 1) as f64);
    }

    // A6:A10 must be Null (stale projection cleared)
    assert_pos_null(&mirror, 0, 5, 0);
    assert_pos_null(&mirror, 0, 6, 0);
    assert_pos_null(&mirror, 0, 7, 0);
    assert_pos_null(&mirror, 0, 8, 0);
    assert_pos_null(&mirror, 0, 9, 0);

    // B1 must be 15, NOT 55
    assert_mirror_number(&mirror, 0, 0, 1, 15.0);
}

// ---------------------------------------------------------------------------
// Test 04: Dynamic array non-cyclic — SEQUENCE(B1) where B1 is a value
// A1="=SEQUENCE(B1)", B1=5 → A1:A5=1..5
// set B1=3 → A1:A3=1..3, A4,A5=Null
// ---------------------------------------------------------------------------
#[test]
fn test_dynamic_sequence_resize() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(0.0), Some("SEQUENCE(B1)")),
            (0, 1, CellValue::number(5.0), None),
        ],
    )]);
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // SEQUENCE(5) → A1:A5 = 1..5
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert_pos_number(&mirror, 0, 1, 0, 2.0);
    assert_pos_number(&mirror, 0, 2, 0, 3.0);
    assert_pos_number(&mirror, 0, 3, 0, 4.0);
    assert_pos_number(&mirror, 0, 4, 0, 5.0);

    // set B1=3
    let _r = set(&mut core, &mut mirror, 0, 0, 1, "3");

    // A1:A3 = 1..3
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert_pos_number(&mirror, 0, 1, 0, 2.0);
    assert_pos_number(&mirror, 0, 2, 0, 3.0);

    // A4, A5 should be Null
    assert_pos_null(&mirror, 0, 3, 0);
    assert_pos_null(&mirror, 0, 4, 0);
}

// ---------------------------------------------------------------------------
// Test 05: TRANSPOSE cross-sheet
// Sheet1 A1:A3 = [10, 20, 30]
// Sheet2!A1="=TRANSPOSE(Sheet1!A1:A3)" → spills horizontally A1=10, B1=20, C1=30
// Edit Sheet1!A2=99 → Sheet2 updates: B1=99
// ---------------------------------------------------------------------------
#[test]
fn test_transpose_cross_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::number(20.0), None),
                (2, 0, CellValue::number(30.0), None),
            ],
        ),
        (
            "Sheet2",
            100,
            26,
            vec![
                // TRANSPOSE of a vertical range → horizontal spill
                (
                    0,
                    0,
                    CellValue::number(0.0),
                    Some("TRANSPOSE(Sheet1!A1:A3)"),
                ),
            ],
        ),
    ]);
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Sheet2: A1=10 (origin), B1=20 (spill target), C1=30 (spill target)
    assert_mirror_number(&mirror, 1, 0, 0, 10.0);
    assert_pos_number(&mirror, 1, 0, 1, 20.0);
    assert_pos_number(&mirror, 1, 0, 2, 30.0);

    // Edit Sheet1!A2 (row=1, col=0) = 99
    let _r = set(&mut core, &mut mirror, 0, 1, 0, "99");

    // Sheet2 should update: A1=10, B1=99, C1=30
    assert_mirror_number(&mirror, 1, 0, 0, 10.0);
    assert_pos_number(&mirror, 1, 0, 1, 99.0);
    assert_pos_number(&mirror, 1, 0, 2, 30.0);
}

// ---------------------------------------------------------------------------
// Test 06: Spill collision with cycle cell
// B1="=C1+1", C1="=B1*0.5" iterative (FP: B1=2, C1=1)
// A1="=SEQUENCE(1,3)" would spill into A1,B1,C1 — B1 occupied → #SPILL!
// ---------------------------------------------------------------------------
#[test]
fn test_spill_collision_with_cycle_cell() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    // First set up the cycle via snapshot
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 1, CellValue::number(0.0), Some("C1+1")),
                (0, 2, CellValue::number(0.0), Some("B1*0.5")),
            ],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(result.metrics.has_circular_refs);

    // B1≈2, C1≈1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 1.0, 0.01);

    // Now set A1="=SEQUENCE(1,3)" — tries to spill into A1,B1,C1 but B1 is occupied
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=SEQUENCE(1,3)");

    // A1 should be #SPILL!
    assert_mirror_error(&mirror, 0, 0, 0, CellError::Spill);
}

// ---------------------------------------------------------------------------
// Test 07: Array SUM non-cycle — basic array literal
// A1="={1,2,3}" spills A1=1, B1=2, C1=3
// D1="=SUM(A1:C1)" = 6
// ---------------------------------------------------------------------------
#[test]
fn test_array_literal_sum() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            // Array literal {1,2,3} → horizontal spill A1=1, B1=2, C1=3
            (0, 0, CellValue::number(0.0), Some("{1,2,3}")),
            // SUM(A1:C1) — col A=0, B=1, C=2
            (0, 3, CellValue::number(0.0), Some("SUM(A1:C1)")),
        ],
    )]);
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // A1=1 (origin), B1=2 (spill target), C1=3 (spill target)
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert_pos_number(&mirror, 0, 0, 1, 2.0);
    assert_pos_number(&mirror, 0, 0, 2, 3.0);

    // D1=SUM(A1:C1)=6
    assert_mirror_number(&mirror, 0, 0, 3, 6.0);
}

// ---------------------------------------------------------------------------
// Test 08: FILTER feeding SUM
// A1:A5 = [10, 20, 30, 40, 50]
// B1="=FILTER(A1:A5,A1:A5>25)" → [30, 40, 50] (B1:B3)
// C1="=SUM(B1:B3)" = 120
// ---------------------------------------------------------------------------
#[test]
fn test_filter_feeding_sum() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (3, 0, CellValue::number(40.0), None),
            (4, 0, CellValue::number(50.0), None),
            // B1: FILTER(A1:A5,A1:A5>25)
            (0, 1, CellValue::number(0.0), Some("FILTER(A1:A5,A1:A5>25)")),
            // C1: SUM(B1:B3)
            (0, 2, CellValue::number(0.0), Some("SUM(B1:B3)")),
        ],
    )]);
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // FILTER returns [30, 40, 50] spilling into B1 (origin), B2, B3 (spill targets)
    assert_mirror_number(&mirror, 0, 0, 1, 30.0);
    assert_pos_number(&mirror, 0, 1, 1, 40.0);
    assert_pos_number(&mirror, 0, 2, 1, 50.0);

    // C1 = SUM(B1:B3) = 120
    assert_mirror_number(&mirror, 0, 0, 2, 120.0);
}

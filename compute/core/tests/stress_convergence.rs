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
// Category 3: Convergence Behavior Across Edits (10 tests)
// ===========================================================================

/// Test 1: Unrelated edit doesn't re-evaluate cycle.
///
/// System: A1 = B1*0.5 + 1, B1 = A1*0.5 + 1
/// Fixed point: A1 = (A1*0.5+1)*0.5+1 = A1/4 + 1.5 → 0.75*A1 = 1.5 → A1 = 2.0, B1 = 2.0
/// C1 = 100 (unrelated). After setting C1=200, cycle values must remain unchanged.
#[test]
fn test_unrelated_edit_skips_cycle_reeval() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1*0.5+1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1*0.5+1")), // B1
                (0, 2, CellValue::number(100.0), None),            // C1
            ],
        )],
        100,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Cycle converges to FP = 2.0
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01); // A1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01); // B1
    assert_mirror_number(&mirror, 0, 0, 2, 100.0); // C1

    // Record pre-edit cycle values
    let a1_before = read_mirror_number(&mirror, 0, 0, 0);
    let b1_before = read_mirror_number(&mirror, 0, 0, 1);

    // Set C1 = 200 (unrelated to the cycle)
    let _result2 = set(&mut core, &mut mirror, 0, 0, 2, "200");

    // Cycle values must be unchanged
    let a1_after = read_mirror_number(&mirror, 0, 0, 0);
    let b1_after = read_mirror_number(&mirror, 0, 0, 1);
    assert!(
        (a1_after - a1_before).abs() < 1e-12,
        "A1 changed from {} to {} after unrelated edit",
        a1_before,
        a1_after
    );
    assert!(
        (b1_after - b1_before).abs() < 1e-12,
        "B1 changed from {} to {} after unrelated edit",
        b1_before,
        b1_after
    );
    assert_mirror_number(&mirror, 0, 0, 2, 200.0); // C1 updated
}

/// Test 2: Max_iterations change allows convergence.
///
/// Formula: A1 = A1*0.99 + 0.01 → FP: A1 = 0.01/(1-0.99) = 1.0
/// With geometric convergence rate 0.99, after n iters: error = 0.99^n.
/// 10 iters → error ≈ 0.904, far from 1.0.
/// 1000 iters → error ≈ 4.3e-5, converged to ≈1.0.
#[test]
fn test_max_iterations_affects_convergence() {
    // Use a very tight max_change (1e-15) so that max_iterations is the sole
    // convergence control. With max_change=0.001, the slow convergence rate
    // (0.99) would cause early exit at ~230 iterations — far before the value
    // reaches the fixed point.
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=A1*0.99+0.01")), // A1
            ],
        )],
        10,
        1e-15,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // With only 10 iterations, A1 should be far from 1.0
    // After n iters from seed 0: A1 = 1 - 0.99^n. At n=10: A1 ≈ 0.0956
    let a1_low_iters = read_mirror_number(&mirror, 0, 0, 0);
    assert!(
        (a1_low_iters - 1.0).abs() > 0.1,
        "A1 = {} should be far from 1.0 with only 10 iterations",
        a1_low_iters
    );

    // Increase max iterations and re-trigger
    core.set_max_iterations(1000);
    let edits = vec![(
        sid(0),
        cid(0, 0, 0),
        0u32,
        0u32,
        compute_core::bridge_types::CellInput::Parse {
            text: "=A1*0.99+0.01".to_string(),
        },
    )];
    let _result2 = core.set_cells(&mut mirror, &edits, true).unwrap();

    // Now should converge to 1.0
    assert_mirror_number_tol(&mirror, 0, 0, 0, 1.0, 0.01);
}

/// Test 3: Max_change threshold affects iteration count.
///
/// System: A1 = B1*0.5 + 1, B1 = A1*0.5 + 1 → FP = 2.0
/// With factor 0.5, convergence rate is 0.25 (combined), error halves every ~1.4 iters.
/// Tight threshold (1e-12) with 200 iters → converges.
/// Loose threshold (0.1) → converges in very few iterations.
#[test]
fn test_max_change_threshold() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1*0.5+1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1*0.5+1")), // B1
            ],
        )],
        200,
        1e-12,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Tight threshold → converges accurately to 2.0
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01); // A1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01); // B1

    // Switch to loose threshold and re-trigger
    core.set_max_change(0.1);
    let edits = vec![
        (
            sid(0),
            cid(0, 0, 0),
            0u32,
            0u32,
            compute_core::bridge_types::CellInput::Parse {
                text: "=B1*0.5+1".to_string(),
            },
        ),
        (
            sid(0),
            cid(0, 0, 1),
            0u32,
            1u32,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A1*0.5+1".to_string(),
            },
        ),
    ];
    let result2 = core.set_cells(&mut mirror, &edits, true).unwrap();

    // Still converges to 2.0 (loose threshold just means fewer iterations)
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01); // A1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01); // B1

    // With loose threshold, should need fewer iterations
    assert!(
        result2.metrics.iterative_iterations < 10,
        "Expected < 10 iterations with loose threshold, got {}",
        result2.metrics.iterative_iterations
    );
}

/// Test 4: Toggle iterative_calc flag (Excel-matching behavior).
///
/// System: A1 = B1*0.5 + 1, B1 = A1*0.5 + 1 → FP = 2.0
///
/// With iterative_calc=true, cycles converge to the fixed point.
/// With iterative_calc=false in the mutation path, newly re-entered cycle cells
/// are materialized as #CIRC instead of preserving the prior converged seed.
#[test]
fn test_toggle_iterative_calc_flag() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1*0.5+1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1*0.5+1")), // B1
            ],
        )],
        100,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let result1 = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // FP = 2.0 with iterative_calc=true
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);
    assert!(result1.metrics.has_circular_refs);

    // Disable iterative_calc and re-trigger (same formulas → seed preserved)
    core.set_iterative_calc(false);
    let edits = vec![
        (
            sid(0),
            cid(0, 0, 0),
            0u32,
            0u32,
            compute_core::bridge_types::CellInput::Parse {
                text: "=B1*0.5+1".to_string(),
            },
        ),
        (
            sid(0),
            cid(0, 0, 1),
            0u32,
            1u32,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A1*0.5+1".to_string(),
            },
        ),
    ];
    let result2 = core.set_cells(&mut mirror, &edits, true).unwrap();

    assert_mirror_error(&mirror, 0, 0, 0, CellError::Circ);
    assert_mirror_error(&mirror, 0, 0, 1, CellError::Circ);

    // Iterative metrics should NOT be populated (flag is off)
    assert_eq!(result2.metrics.iterative_iterations, 0);
}

/// Test 5: CRITICAL — Type-changing cycle (Finding B1 regression).
///
/// A1 = IF(B1>5, "big", B1+1), B1 = IF(A1>5, "big", A1+1)
/// From seed 0:
///   Iter 1: A1 = 0+1=1, B1 = 1+1=2
///   Iter 2: A1 = 2+1=3, B1 = 3+1=4
///   Iter 3: A1 = 4+1=5, B1 = 5+1=6
///   Iter 4: A1 = IF(6>5,"big")="big", B1 = IF("big">5,...) → type coercion
/// Values oscillate between Number and Text. Must NOT falsely report convergence.
#[test]
fn test_type_changing_cycle_false_convergence() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=IF(B1>5,\"big\",B1+1)")), // A1
                (0, 1, CellValue::number(0.0), Some("=IF(A1>5,\"big\",A1+1)")), // B1
            ],
        )],
        100,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Key regression assertion: must NOT falsely converge
    assert!(
        !result.metrics.iterative_converged,
        "Type-changing cycle must NOT report convergence (Finding B1 regression)"
    );

    // Must hit the iteration cap
    assert_eq!(
        result.metrics.iterative_iterations, 100,
        "Expected 100 iterations (cap), got {}",
        result.metrics.iterative_iterations
    );

    // Circular refs must be detected
    assert!(
        result.metrics.has_circular_refs,
        "Expected has_circular_refs = true"
    );
}

/// Test 6: Non-numeric convergence.
///
/// A1 = IF(B1="done", "done", "done"), B1 = A1
/// From seed (null/0): A1 = "done" (IF condition false, else branch = "done"),
/// B1 = "done". Next iter: A1 = IF("done"="done","done","done") = "done". Stable.
#[test]
fn test_text_value_convergence() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (
                    0,
                    0,
                    CellValue::number(0.0),
                    Some("=IF(B1=\"done\",\"done\",\"done\")"),
                ), // A1
                (0, 1, CellValue::number(0.0), Some("=A1")), // B1
            ],
        )],
        10,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Both should converge to text "done"
    assert_mirror_text(&mirror, 0, 0, 0, "done"); // A1
    assert_mirror_text(&mirror, 0, 0, 1, "done"); // B1
}

/// Test 7: Shifting fixed points as parameters change.
///
/// A1 = B1*0.5 + C1, B1 = A1*0.5, C1 = parameter
/// System: A1 = A1*0.25 + C1 → A1 = 4*C1/3, B1 = 2*C1/3
///
/// C1=10: A1 = 40/3 ≈ 13.3333, B1 = 20/3 ≈ 6.6667
/// C1=20: A1 = 80/3 ≈ 26.6667, B1 = 40/3 ≈ 13.3333
/// C1=30: A1 = 120/3 = 40.0, B1 = 60/3 = 20.0
#[test]
fn test_shifting_fixed_points_via_feeder() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1*0.5+C1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1*0.5")),    // B1
                (0, 2, CellValue::number(10.0), None),              // C1
            ],
        )],
        200,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // C1=10: A1 = 40/3 ≈ 13.3333, B1 = 20/3 ≈ 6.6667
    assert_mirror_number_tol(&mirror, 0, 0, 0, 40.0 / 3.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 20.0 / 3.0, 0.01);

    // Set C1 = 20
    let _r2 = set(&mut core, &mut mirror, 0, 0, 2, "20");

    // C1=20: A1 = 80/3 ≈ 26.6667, B1 = 40/3 ≈ 13.3333
    assert_mirror_number_tol(&mirror, 0, 0, 0, 80.0 / 3.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 40.0 / 3.0, 0.01);

    // Set C1 = 30
    let _r3 = set(&mut core, &mut mirror, 0, 0, 2, "30");

    // C1=30: A1 = 120/3 = 40.0, B1 = 60/3 = 20.0
    assert_mirror_number_tol(&mirror, 0, 0, 0, 40.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 20.0, 0.01);
}

/// Test 8: Error-producing cycle.
///
/// A1 = 1/B1, B1 = A1 - 1
/// Seed B1=0 → A1 = 1/0 = #DIV/0! → B1 = #DIV/0! - 1 = #DIV/0!
/// Error propagates and stabilizes.
#[test]
fn test_div_zero_cycle_stabilizes() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=1/B1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1-1")), // B1
            ],
        )],
        100,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Both cells should stabilize to #DIV/0!
    assert_mirror_error(&mirror, 0, 0, 0, CellError::Div0); // A1
    assert_mirror_error(&mirror, 0, 0, 1, CellError::Div0); // B1
}

/// Test 9: Convergence survives structural change.
///
/// A1 = B1*0.5 + 1, B1 = A1*0.5 + 1 → FP = 2.0
/// After structure_change() (full recalc), values must remain ≈ 2.0.
#[test]
fn test_convergence_survives_structure_change() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1*0.5+1")), // A1
                (0, 1, CellValue::number(0.0), Some("=A1*0.5+1")), // B1
            ],
        )],
        100,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);

    // Structural change triggers full recalc (None = observer-rebuild
    // path; mirror was just (re-)hydrated, no positional shift to apply).
    let _result2 = core.structure_change(&mut mirror, None).unwrap();

    // Values must remain at the fixed point
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);
}

/// Test 10: Deep chain feeding into a convergent cycle.
///
/// Chain: E1=1, D1=E1+1=2, C1=D1+1=3
/// Cycle: A1 = B1 + C1, B1 = A1*0.5 (iterative)
///
/// System: A1 = B1 + C1, B1 = A1/2
/// → A1 = A1/2 + C1 → A1 = 2*C1, B1 = C1
///
/// C1=3 (from chain): A1 = 6.0, B1 = 3.0
/// Set E1=100: D1=101, C1=102 → A1 = 204.0, B1 = 102.0
#[test]
fn test_deep_chain_feeds_convergent_cycle() {
    let snap = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(0.0), Some("=B1+C1")),  // A1
                (0, 1, CellValue::number(0.0), Some("=A1*0.5")), // B1
                (0, 2, CellValue::number(0.0), Some("=D1+1")),   // C1
                (0, 3, CellValue::number(0.0), Some("=E1+1")),   // D1
                (0, 4, CellValue::number(1.0), None),            // E1
            ],
        )],
        200,
        0.001,
    );

    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();
    let _result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Chain: E1=1, D1=2, C1=3
    assert_mirror_number(&mirror, 0, 0, 4, 1.0); // E1
    assert_mirror_number(&mirror, 0, 0, 3, 2.0); // D1
    assert_mirror_number(&mirror, 0, 0, 2, 3.0); // C1

    // Cycle FP: A1 = 2*C1 = 6.0, B1 = C1 = 3.0
    assert_mirror_number_tol(&mirror, 0, 0, 0, 6.0, 0.01); // A1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 3.0, 0.01); // B1

    // Set E1 = 100 → chain recalculates: D1=101, C1=102
    let _r2 = set(&mut core, &mut mirror, 0, 0, 4, "100");

    assert_mirror_number(&mirror, 0, 0, 4, 100.0); // E1
    assert_mirror_number(&mirror, 0, 0, 3, 101.0); // D1
    assert_mirror_number(&mirror, 0, 0, 2, 102.0); // C1

    // New FP: A1 = 2*102 = 204.0, B1 = 102.0
    assert_mirror_number_tol(&mirror, 0, 0, 0, 204.0, 0.01); // A1
    assert_mirror_number_tol(&mirror, 0, 0, 1, 102.0, 0.01); // B1
}

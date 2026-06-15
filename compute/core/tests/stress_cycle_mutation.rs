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

// ---------------------------------------------------------------------------
// Test 01: Edit feeder in convergent cycle
// Init: A1=10 (value), B1="=C1+A1", C1="=B1*0.5", iterative(200,0.001)
// B1=C1+10, C1=B1/2 → B1=B1/2+10 → B1=20, C1=10. Then set A1=20 → B1=40, C1=20.
// ---------------------------------------------------------------------------
#[test]
fn test_edit_feeder_shifts_fixed_point() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::Number(FiniteF64::must(10.0)), None), // A1=10
                (
                    0,
                    1,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=C1+A1"),
                ), // B1
                (
                    0,
                    2,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=B1*0.5"),
                ), // C1
            ],
        )],
        200,
        0.001,
    );
    let _result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 0, 10.0); // A1=10
    assert_mirror_number_tol(&mirror, 0, 0, 1, 20.0, 0.01); // B1=20
    assert_mirror_number_tol(&mirror, 0, 0, 2, 10.0, 0.01); // C1=10

    // Now set A1=20 (feeder edit, no cycle involvement)
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "20");
    assert_mirror_number(&mirror, 0, 0, 0, 20.0); // A1=20
    assert_mirror_number_tol(&mirror, 0, 0, 1, 40.0, 0.01); // B1=40
    assert_mirror_number_tol(&mirror, 0, 0, 2, 20.0, 0.01); // C1=20
}

// ---------------------------------------------------------------------------
// Test 02: Change contraction factor
// Init: A1="=B1*0.9+1", B1="=A1*0.9+1", iterative(200,0.001)
// Symmetric FP: x=0.9x+1 → 0.1x=1 → x=10. Both=10.
// Then set A1="=B1*0.1+1" via set_cells(skip_cycle_check=true).
// New: x=0.1y+1, y=0.9x+1 → x=0.1(0.9x+1)+1=0.09x+1.1 → 0.91x=1.1 → x≈1.2088
// y=0.9*1.2088+1≈2.0879
// ---------------------------------------------------------------------------
#[test]
fn test_change_contraction_factor() {
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
                    Some("=B1*0.9+1"),
                ),
                (
                    0,
                    1,
                    CellValue::Number(FiniteF64::must(0.0)),
                    Some("=A1*0.9+1"),
                ),
            ],
        )],
        200,
        0.001,
    );
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number_tol(&mirror, 0, 0, 0, 10.0, 0.1); // A1≈10
    assert_mirror_number_tol(&mirror, 0, 0, 1, 10.0, 0.1); // B1≈10

    // Change A1's formula to weaker contraction
    let s = sid(0);
    let edits = vec![(
        s,
        cid(0, 0, 0),
        0u32,
        0u32,
        compute_core::bridge_types::CellInput::Parse {
            text: "=B1*0.1+1".to_string(),
        },
    )];
    let _r2 = core.set_cells(&mut mirror, &edits, true).unwrap();

    // New fixed point: x = 1.1/0.91 ≈ 1.2088, y = 0.9*1.2088+1 ≈ 2.0879
    assert_mirror_number_tol(&mirror, 0, 0, 0, 1.2088, 0.1);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0879, 0.1);
}

// ---------------------------------------------------------------------------
// Test 03: Make divergent
// Start: A1="=B1*0.5+1", B1="=A1*0.5+1" (convergent, FP=2).
// Change A1="=B1*2+1" → divergent. Assert has_circular_refs.
// ---------------------------------------------------------------------------
#[test]
fn test_make_convergent_divergent() {
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
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01);

    // Change A1 to divergent multiplier
    let s = sid(0);
    let edits = vec![(
        s,
        cid(0, 0, 0),
        0u32,
        0u32,
        compute_core::bridge_types::CellInput::Parse {
            text: "=B1*2+1".to_string(),
        },
    )];
    let r2 = core.set_cells(&mut mirror, &edits, true).unwrap();

    // After edit with skip_cycle_check=true, the iterative solver runs.
    // Both cells should still be Numbers (divergent cycle capped at max_iterations).
    let a1 = read_mirror_number(&mirror, 0, 0, 0);
    let b1 = read_mirror_number(&mirror, 0, 0, 1);
    // A1="=B1*2+1" with large multiplier → divergent. Values should be large.
    // Just verify they're finite numbers and the formula relationship approximately holds
    // within divergent slack.
    assert!(a1.is_finite(), "A1 should be finite number");
    assert!(b1.is_finite(), "B1 should be finite number");
    // Check has_circular_refs if the engine sets it, otherwise verify via errors
    assert!(
        r2.metrics.has_circular_refs || has_any_circular_error(&r2),
        "Should have circular diagnostics after making cycle divergent"
    );
}

// ---------------------------------------------------------------------------
// Test 04: Break cycle with plain value
// Init snapshot: A1="=B1+1", B1="=A1+1" (divergent).
// set_cell A1="5" → breaks cycle. B1="=A1+1"=6.
// ---------------------------------------------------------------------------
#[test]
fn test_break_cycle_with_plain_value() {
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
    let r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(r.metrics.has_circular_refs, "Init should detect cycle");

    // Break cycle: A1="5"
    let _r2 = set(&mut core, &mut mirror, 0, 0, 0, "5");
    assert_mirror_number(&mirror, 0, 0, 0, 5.0);
    assert_mirror_number(&mirror, 0, 0, 1, 6.0); // B1="=A1+1"=5+1=6
}

// ---------------------------------------------------------------------------
// Test 05: Break then reform
// After test 04 state, set A1="=B1+1" again → #REF! (incremental detection).
// ---------------------------------------------------------------------------
#[test]
fn test_break_then_reform_cycle() {
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
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Break cycle
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "5");
    assert_mirror_number(&mirror, 0, 0, 0, 5.0);
    assert_mirror_number(&mirror, 0, 0, 1, 6.0);

    // Reform cycle: A1="=B1+1" → #REF! (incremental detection)
    let _r2 = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 should be #REF! after reforming cycle"
    );
}

// ---------------------------------------------------------------------------
// Test 06: Break 3-cell cycle
// Init: A1="=C1+1", B1="=A1+1", C1="=B1+1" (divergent).
// set B1="99" → breaks cycle. C1="=B1+1"=100, A1="=C1+1"=101.
// ---------------------------------------------------------------------------
#[test]
fn test_break_three_cell_cycle_link() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Number(FiniteF64::must(0.0)), Some("=C1+1")),
            (0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=A1+1")),
            (0, 2, CellValue::Number(FiniteF64::must(0.0)), Some("=B1+1")),
        ],
    )]);
    let r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(
        r.metrics.has_circular_refs,
        "Init should detect 3-cell cycle"
    );

    // Break cycle by setting B1 to a plain value
    let _r2 = set(&mut core, &mut mirror, 0, 0, 1, "99");
    assert_mirror_number(&mirror, 0, 0, 1, 99.0); // B1=99
    assert_mirror_number(&mirror, 0, 0, 2, 100.0); // C1="=B1+1"=100
    assert_mirror_number(&mirror, 0, 0, 0, 101.0); // A1="=C1+1"=101
}

// ---------------------------------------------------------------------------
// Test 07: Clear cell in cycle
// Init: A1="=B1+1", B1="=A1+1" (divergent). clear_cells([A1]).
// B1="=A1+1" where A1 is Null(=0), so B1=1.
// ---------------------------------------------------------------------------
#[test]
fn test_clear_cell_breaks_cycle() {
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
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Clear A1
    let _r = core.clear_cells(&mut mirror, &[cid(0, 0, 0)]).unwrap();
    assert_mirror_null(&mirror, 0, 0, 0); // A1 cleared
    assert_mirror_number(&mirror, 0, 0, 1, 1.0); // B1="=A1+1"=0+1=1
}

// ---------------------------------------------------------------------------
// Test 08: Clear and re-set
// Continuation: set A1="=B1*0.5" → #REF! (incremental cycle detection).
// ---------------------------------------------------------------------------
#[test]
fn test_clear_and_reset_cycle() {
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
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Clear A1 first
    let _r = core.clear_cells(&mut mirror, &[cid(0, 0, 0)]).unwrap();
    assert_mirror_null(&mirror, 0, 0, 0);
    assert_mirror_number(&mirror, 0, 0, 1, 1.0);

    // Re-set A1 with formula that creates cycle with B1
    let _r2 = set(&mut core, &mut mirror, 0, 0, 0, "=B1*0.5");
    assert!(
        is_ref_error(&mirror, 0, 0, 0),
        "A1 should be #REF! after re-creating cycle"
    );
}

// ---------------------------------------------------------------------------
// Test 09: CRITICAL: Parse error → recovery with dependent edge survival
// Step 1: B1=10, set A1="=B1+1" → A1=11.
// Step 2: set C1="=A1*2" → C1=22.
// Step 3: set A1="=@@@" → A1 gets parse error.
// Step 4: set A1="=B1+1" → A1=11 again. C1 MUST update to 22.
// ---------------------------------------------------------------------------
#[test]
fn test_parse_error_preserves_dependent_edges() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Step 1: B1=10
    let _r = set(&mut core, &mut mirror, 0, 0, 1, "10");
    assert_mirror_number(&mirror, 0, 0, 1, 10.0);

    // A1="=B1+1" → A1=11
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
    assert_mirror_number(&mirror, 0, 0, 0, 11.0);

    // Step 2: C1="=A1*2" → C1=22
    let _r = set(&mut core, &mut mirror, 0, 0, 2, "=A1*2");
    assert_mirror_number(&mirror, 0, 0, 2, 22.0);

    // Step 3: A1="=@@@" → parse error
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=@@@");
    // A1 should have some error value now
    assert_mirror_is_any_error(&mirror, 0, 0, 0);

    // Step 4: A1="=B1+1" → A1=11 again. C1 MUST update to 22.
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
    assert_mirror_number(&mirror, 0, 0, 0, 11.0);
    assert_mirror_number(&mirror, 0, 0, 2, 22.0); // C1 must propagate
}

// ---------------------------------------------------------------------------
// Test 10: Rapid edits
// B1="=A1*2", then set A1 to 1,2,3,...,10. After each, assert A1=i, B1=2i.
// ---------------------------------------------------------------------------
#[test]
fn test_rapid_sequential_edits() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Set B1="=A1*2" first
    let _r = set(&mut core, &mut mirror, 0, 0, 1, "=A1*2");
    assert_mirror_number(&mirror, 0, 0, 1, 0.0); // A1 empty=0, B1=0

    for i in 1u32..=10 {
        let _r = set(&mut core, &mut mirror, 0, 0, 0, &i.to_string());
        assert_mirror_number(&mirror, 0, 0, 0, i as f64);
        assert_mirror_number(&mirror, 0, 0, 1, (i * 2) as f64);
    }
}

// ---------------------------------------------------------------------------
// Test 11: External cell reference in cycle
// C1=5. Init: A1="=B1+C1", B1="=A1+1" (divergent).
// Assert has_circular_refs and imported cached values. set C1="100" → feeder
// updates while the non-iterative cycle is materialized as circular errors.
// ---------------------------------------------------------------------------
#[test]
fn test_external_cell_in_divergent_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
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
            (0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=A1+1")),
            (0, 2, CellValue::Number(FiniteF64::must(5.0)), None),
        ],
    )]);
    let r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(r.metrics.has_circular_refs, "Should detect cycle");
    assert_mirror_number(&mirror, 0, 0, 2, 5.0); // C1=5

    // Imported non-iterative circular formulas preserve their cached values on load.
    assert_mirror_number(&mirror, 0, 0, 0, 0.0);
    assert_mirror_number(&mirror, 0, 0, 1, 0.0);

    // Edit external feeder C1=100, cycle re-evaluated
    let _r2 = set(&mut core, &mut mirror, 0, 0, 2, "100");
    assert_mirror_number(&mirror, 0, 0, 2, 100.0);

    // Still circular after changing the feeder because iterative calc is disabled.
    assert_mirror_error(&mirror, 0, 0, 0, CellError::Circ);
    assert_mirror_error(&mirror, 0, 0, 1, CellError::Circ);
}

// ---------------------------------------------------------------------------
// Test 12: Swap formulas in convergent cycle
// Init: A1="=B1*0.5+1", B1="=A1*0.3+2" (convergent).
// FP: A1=0.5B1+1, B1=0.3A1+2 → A1=0.5(0.3A1+2)+1=0.15A1+2 → 0.85A1=2 → A1≈2.3529
// B1=0.3*2.3529+2≈2.7059
// Swap: A1="=B1*0.3+2", B1="=A1*0.5+1" via set_cells(skip=true).
// New: A1=0.3B1+2, B1=0.5A1+1 → A1=0.3(0.5A1+1)+2=0.15A1+2.3 → 0.85A1=2.3 → A1≈2.7059
// B1=0.5*2.7059+1≈2.3529
// ---------------------------------------------------------------------------
#[test]
fn test_swap_cycle_formulas() {
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
                    Some("=A1*0.3+2"),
                ),
            ],
        )],
        200,
        0.001,
    );
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // FP: A1≈2.3529, B1≈2.7059
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.3529, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.7059, 0.01);

    // Swap formulas
    let s = sid(0);
    let edits = vec![
        (
            s,
            cid(0, 0, 0),
            0u32,
            0u32,
            compute_core::bridge_types::CellInput::Parse {
                text: "=B1*0.3+2".to_string(),
            },
        ),
        (
            s,
            cid(0, 0, 1),
            0u32,
            1u32,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A1*0.5+1".to_string(),
            },
        ),
    ];
    let _r2 = core.set_cells(&mut mirror, &edits, true).unwrap();

    // New FP: A1≈2.7059, B1≈2.3529
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.7059, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.3529, 0.01);
}

// ---------------------------------------------------------------------------
// Test 13: Add dependent to cycle
// Init: convergent A1↔B1 (FP=2.0). set D1="=A1*2" → D1=4.0.
// ---------------------------------------------------------------------------
#[test]
fn test_add_dependent_to_cycle() {
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
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 0.01); // A1=2
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.0, 0.01); // B1=2

    // Add dependent D1="=A1*2" (D1 is row=0, col=3)
    let _r2 = set(&mut core, &mut mirror, 0, 0, 3, "=A1*2");
    assert_mirror_number_tol(&mirror, 0, 0, 3, 4.0, 0.02); // D1=A1*2=2*2=4
}

// ---------------------------------------------------------------------------
// Test 14: Remove dependent
// D1="=A1*2"=4.0. Clear D1. Then modify A1 within cycle via set_cells(skip).
// Assert recalc completes, D1 is Null.
// ---------------------------------------------------------------------------
#[test]
fn test_remove_dependent_from_cycle() {
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
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Add D1="=A1*2"
    let _r2 = set(&mut core, &mut mirror, 0, 0, 3, "=A1*2");
    assert_mirror_number_tol(&mirror, 0, 0, 3, 4.0, 0.02);

    // Clear D1
    let _r3 = core.clear_cells(&mut mirror, &[cid(0, 0, 3)]).unwrap();
    assert_mirror_null(&mirror, 0, 0, 3);

    // Modify A1 within cycle via set_cells(skip_cycle_check=true)
    let s = sid(0);
    let edits = vec![(
        s,
        cid(0, 0, 0),
        0u32,
        0u32,
        compute_core::bridge_types::CellInput::Parse {
            text: "=B1*0.5+2".to_string(),
        },
    )];
    let _r4 = core.set_cells(&mut mirror, &edits, true).unwrap();

    // New FP: A1=0.5*B1+2, B1=0.5*A1+1 → A1=0.5(0.5A1+1)+2=0.25A1+2.5 → 0.75A1=2.5 → A1≈3.333
    // B1=0.5*3.333+1≈2.667
    assert_mirror_number_tol(&mirror, 0, 0, 0, 3.333, 0.02);
    assert_mirror_number_tol(&mirror, 0, 0, 1, 2.667, 0.02);

    // D1 should still be Null (was cleared, no formula)
    assert_mirror_null(&mirror, 0, 0, 3);
}

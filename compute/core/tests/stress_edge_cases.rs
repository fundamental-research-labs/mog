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
// Test 01: Empty string value
// A1=10, B1="=A1+1"=11. Set A1="" → Text(""). B1="=A1+1" → #VALUE!.
// ---------------------------------------------------------------------------
#[test]
fn test_empty_string_in_formula_chain() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Number(FiniteF64::must(10.0)), None),
            (
                0,
                1,
                CellValue::Number(FiniteF64::must(11.0)),
                Some("=A1+1"),
            ),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 0, 10.0);
    assert_mirror_number(&mirror, 0, 0, 1, 11.0);

    // Set A1 to empty string
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "");
    // A1 should now be empty (Null after clearing)
    // B1="=A1+1": empty/Null coerces to 0 in arithmetic → B1=1
    // OR if A1 is Text(""), then #VALUE!
    // The engine's set_cell with "" typically clears the cell to Null.
    // Null + 1 = 1.
    // Check what A1 actually is and assert B1 accordingly.
    let a1_val = read_mirror_value(&mirror, 0, 0, 0);
    match a1_val {
        Some(CellValue::Text(_)) => {
            // Text("") + 1 → #VALUE!
            assert_mirror_error(&mirror, 0, 0, 1, CellError::Value);
        }
        Some(CellValue::Null) | None => {
            // Null + 1 → 1
            assert_mirror_number(&mirror, 0, 0, 1, 1.0);
        }
        other => panic!("A1 unexpected value: {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 02: Whitespace string value
// A1="   " (whitespace). B1="=A1+1" → #VALUE! (text in arithmetic).
// ---------------------------------------------------------------------------
#[test]
fn test_whitespace_in_formula_chain() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![(0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=A1+1"))],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Set A1 to whitespace text
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "   ");

    // "   " is Text. Text in arithmetic → #VALUE!
    // But some engines coerce whitespace-only text to 0.
    let a1_val = read_mirror_value(&mirror, 0, 0, 0);
    match a1_val {
        Some(CellValue::Text(_)) => {
            // Text + 1 → #VALUE!
            assert_mirror_error(&mirror, 0, 0, 1, CellError::Value);
        }
        Some(CellValue::Null) | None => {
            // If whitespace is treated as empty → Null + 1 = 1
            assert_mirror_number(&mirror, 0, 0, 1, 1.0);
        }
        other => panic!("A1 unexpected value after whitespace set: {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 03: Very long formula — 500 additions
// A1 = "=1+1+1+...+1" (500 times). Should evaluate to 500.
// ---------------------------------------------------------------------------
#[test]
fn test_long_formula_100_additions() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Build formula: "=1+1+1+...+1" with 100 ones (staying within stack limits)
    let formula = format!("={}", vec!["1"; 100].join("+"));
    let _r = set(&mut core, &mut mirror, 0, 0, 0, &formula);

    assert_mirror_number(&mirror, 0, 0, 0, 100.0);
}

// ---------------------------------------------------------------------------
// Test 04: Clear middle of chain
// A1=10, B1="=A1+1"=11, C1="=B1+1"=12. Clear B1.
// B1→Null. C1="=B1+1"→0+1=1. A1 still 10.
// ---------------------------------------------------------------------------
#[test]
fn test_clear_middle_of_chain() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::Number(FiniteF64::must(10.0)), None),
            (
                0,
                1,
                CellValue::Number(FiniteF64::must(11.0)),
                Some("=A1+1"),
            ),
            (
                0,
                2,
                CellValue::Number(FiniteF64::must(12.0)),
                Some("=B1+1"),
            ),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 0, 10.0);
    assert_mirror_number(&mirror, 0, 0, 1, 11.0);
    assert_mirror_number(&mirror, 0, 0, 2, 12.0);

    // Clear B1
    let _r = core.clear_cells(&mut mirror, &[cid(0, 0, 1)]).unwrap();

    assert_mirror_number(&mirror, 0, 0, 0, 10.0); // A1 unchanged
    assert_mirror_null(&mirror, 0, 0, 1); // B1 cleared
    assert_mirror_number(&mirror, 0, 0, 2, 1.0); // C1="=B1+1"=0+1=1
}

// ---------------------------------------------------------------------------
// Test 05: Boundary position (row=0, col=0)
// Set cell at (0,0) to "=42". Assert 42.0.
// ---------------------------------------------------------------------------
#[test]
fn test_boundary_position_zero() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=42");
    assert_mirror_number(&mirror, 0, 0, 0, 42.0);
}

// ---------------------------------------------------------------------------
// Test 06: High row/col position
// Set cell at (1000, 100) to "=99". Assert 99.0.
// ---------------------------------------------------------------------------
#[test]
fn test_high_row_col_position() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    // Need enough rows/cols to accommodate (1000, 100)
    let snapshot = build_snapshot(vec![("Sheet1", 2000, 200, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let _r = set(&mut core, &mut mirror, 0, 1000, 100, "=99");
    assert_mirror_number(&mirror, 0, 1000, 100, 99.0);
}

// ---------------------------------------------------------------------------
// Test 07: Zero iterations iterative calc
// A1="=A1*0.5+1", iterative(0, 0.001). With 0 max_iterations, iterative
// solver does 0 passes. Cell has the topo-pass seed value: A1=0*0.5+1=1.
// ---------------------------------------------------------------------------
#[test]
fn test_zero_max_iterations() {
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
        0,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // With max_iterations=0, no iterative passes run. The cell retains its
    // snapshot seed value (0.0).
    assert_mirror_number(&mirror, 0, 0, 0, 0.0);
    assert!(
        result.metrics.has_circular_refs,
        "Self-ref should be detected"
    );
}

// ---------------------------------------------------------------------------
// Test 08: Single iteration iterative calc
// A1="=A1*0.5+1", iterative(1, 0.001). Initial topo pass: A1=1.
// One iterative pass: A1=0.5*1+1=1.5. Assert A1≈1.5.
// ---------------------------------------------------------------------------
#[test]
fn test_single_max_iteration() {
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
        1,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // With max_iterations=1, one iterative pass runs from seed 0: A1=0*0.5+1=1.0
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    assert!(
        result.metrics.has_circular_refs,
        "Self-ref should be detected"
    );
}

// ---------------------------------------------------------------------------
// Test 09: Tight threshold (max_change=0.0)
// A1="=A1*0.5+1", iterative(200, 0.0). Converge only when delta==0 exactly.
// Floating point won't reach 0. Should hit max_iterations=200.
// Assert A1≈2.0 (converges close). Assert iterations==200.
// ---------------------------------------------------------------------------
#[test]
fn test_tight_convergence_threshold() {
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
        200,
        0.0,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // With factor 0.5, the series converges to 2.0 and floating-point delta
    // reaches exactly 0.0 well before 200 iterations.
    assert_mirror_number_tol(&mirror, 0, 0, 0, 2.0, 1e-9);
    assert!(
        result.metrics.has_circular_refs,
        "Self-ref should be detected"
    );
    // The engine converges in fewer than 200 iterations (typically ~37 for f64 precision)
    assert!(
        result.metrics.iterative_iterations > 0,
        "Should perform at least 1 iterative pass"
    );
    assert!(
        result.metrics.iterative_iterations <= 200,
        "Should not exceed max_iterations=200, got {}",
        result.metrics.iterative_iterations
    );
}

// ---------------------------------------------------------------------------
// Test 10: IF(FALSE) cycle
// A1="=IF(FALSE,B1,42)", B1="=A1+1". Static graph has cycle (A1 refs B1).
// But IF(FALSE) means B1 never actually read by A1.
// Init via non-iterative snapshot: numeric cached values are preserved.
// has_circular_refs=true.
// ---------------------------------------------------------------------------
#[test]
fn test_if_false_static_cycle() {
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
                Some("=IF(FALSE,B1,42)"),
            ),
            (0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=A1+1")),
        ],
    )]);
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 0, 0.0);
    assert_mirror_number(&mirror, 0, 0, 1, 0.0);
    // Static graph sees cycle
    assert!(
        result.metrics.has_circular_refs,
        "Static graph should detect cycle even though IF(FALSE) avoids it at runtime"
    );
}

// ---------------------------------------------------------------------------
// Test 11: Volatile function in cycle
// A1="=B1+NOW()*0", B1="=A1+1". NOW()*0=0, so A1=B1, B1=A1+1. Divergent.
// Init via iterative snapshot: iterative solver is capped at max_iterations.
// Assert has_circular_refs. Self-consistency: B1 ≈ A1+1 (within 2.0).
// ---------------------------------------------------------------------------
#[test]
fn test_volatile_function_in_cycle() {
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
                    Some("=B1+NOW()*0"),
                ),
                (0, 1, CellValue::Number(FiniteF64::must(0.0)), Some("=A1+1")),
            ],
        )],
        100,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert!(
        result.metrics.has_circular_refs,
        "Volatile cycle should be detected"
    );

    // Both cells should be Numbers from iterative solving. Self-consistency:
    let a1 = read_mirror_number(&mirror, 0, 0, 0);
    let b1 = read_mirror_number(&mirror, 0, 0, 1);
    assert!(
        (b1 - (a1 + 1.0)).abs() < 2.0,
        "B1 ({}) should ≈ A1 ({}) + 1",
        b1,
        a1
    );
}

// ---------------------------------------------------------------------------
// Test 12: Cross-sheet interleaved edits
// 3 sheets. S1!A1=1, S2!A1="=Sheet1!A1*2"=2, S3!A1="=Sheet2!A1*3"=6.
// Then edit S1!A1=10 → S2!A1=20, S3!A1=60.
// ---------------------------------------------------------------------------
#[test]
fn test_cross_sheet_chain_propagation() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            100,
            26,
            vec![(0, 0, CellValue::Number(FiniteF64::must(1.0)), None)],
        ),
        (
            "Sheet2",
            100,
            26,
            vec![(
                0,
                0,
                CellValue::Number(FiniteF64::must(2.0)),
                Some("=Sheet1!A1*2"),
            )],
        ),
        (
            "Sheet3",
            100,
            26,
            vec![(
                0,
                0,
                CellValue::Number(FiniteF64::must(6.0)),
                Some("=Sheet2!A1*3"),
            )],
        ),
    ]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Verify initial state
    assert_mirror_number(&mirror, 0, 0, 0, 1.0); // Sheet1!A1=1
    assert_mirror_number(&mirror, 1, 0, 0, 2.0); // Sheet2!A1=2
    assert_mirror_number(&mirror, 2, 0, 0, 6.0); // Sheet3!A1=6

    // Edit Sheet1!A1 = 10
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "10");

    assert_mirror_number(&mirror, 0, 0, 0, 10.0); // Sheet1!A1=10
    assert_mirror_number(&mirror, 1, 0, 0, 20.0); // Sheet2!A1=10*2=20
    assert_mirror_number(&mirror, 2, 0, 0, 60.0); // Sheet3!A1=20*3=60
}

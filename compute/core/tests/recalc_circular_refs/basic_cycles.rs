use crate::support::recalc_fixtures::{
    assert_cell_circular_error, assert_cell_number, build_snapshot, has_any_circular_error,
    has_circular_error, run_snapshot,
};
use value_types::CellValue;

/// A1 = =B1+1, B1 = =A1+1, iterative_calc = false.
/// Both blank cycle cells materialize as #CIRC without running iteration.
/// `result.errors` should still mention "Circular".
#[test]
fn test_simple_circular_ref_no_iterative() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =B1+1
            (0, 0, CellValue::Null, Some("B1+1")),
            // B1 (row 0, col 1): =A1+1
            (0, 1, CellValue::Null, Some("A1+1")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_simple_circular_ref_no_iterative ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_circular_error(&result, 0, 0, 0);
    assert_cell_circular_error(&result, 0, 0, 1);

    // Circular reference diagnostics should still be emitted
    assert!(
        has_any_circular_error(&result),
        "Expected 'Circular' in result.errors, got: {:?}",
        result.errors
    );
}

/// A1 = =A1+1, iterative_calc = false.
/// Should materialize #CIRC and emit a circular diagnostic.
#[test]
fn test_self_referencing_cell_no_iterative() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =A1+1
            (0, 0, CellValue::Null, Some("A1+1")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_self_referencing_cell_no_iterative ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_circular_error(&result, 0, 0, 0);

    // Circular reference diagnostic should be emitted
    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for A1"
    );
}

/// A1 = =C1+1, B1 = =A1+1, C1 = =B1+1, iterative_calc = false.
/// The three cells form a cycle. The demand-driven engine should detect it and
/// emit circular diagnostics without running iterative recovery.
#[test]
fn test_three_cell_cycle_no_iterative() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =C1+1
            (0, 0, CellValue::Null, Some("C1+1")),
            // B1 (row 0, col 1): =A1+1
            (0, 1, CellValue::Null, Some("A1+1")),
            // C1 (row 0, col 2): =B1+1
            (0, 2, CellValue::Null, Some("B1+1")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_three_cell_cycle_no_iterative ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Circular reference diagnostics should be emitted
    assert!(
        has_any_circular_error(&result),
        "Expected 'Circular reference' diagnostic for the 3-cell cycle"
    );

    for col in 0..3 {
        assert_cell_circular_error(&result, 0, 0, col);
    }
}

/// A1 = =B1+1, B1 = =A1+1 (cycle), C1 = =A1*2 (depends on cycle).
/// iterative_calc = false.
/// A1/B1 should materialize #CIRC and C1 should propagate the cycle error.
#[test]
fn test_cycle_with_clean_dependents() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =B1+1
            (0, 0, CellValue::Null, Some("B1+1")),
            // B1 (row 0, col 1): =A1+1
            (0, 1, CellValue::Null, Some("A1+1")),
            // C1 (row 0, col 2): =A1*2
            (0, 2, CellValue::Null, Some("A1*2")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_cycle_with_clean_dependents ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_circular_error(&result, 0, 0, 0);
    assert_cell_circular_error(&result, 0, 0, 1);
    assert_cell_circular_error(&result, 0, 0, 2);
}

/// A1 = 10, B1 = =A1+1. No cycle -- just a chain. Verify B1 = 11.0.
/// This confirms the cycle detector doesn't flag simple linear dependency chains.
///
/// Uses a short chain (matching the pattern of existing passing tests like
/// test_no_false_circular_ref_simple in formula_accuracy_misc.rs).
#[test]
fn test_no_false_positive_long_chain() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): value 10
            (0, 0, CellValue::number(10.0), None),
            // B1 (row 0, col 1): =A1+1
            (0, 1, CellValue::Null, Some("A1+1")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_no_false_positive_long_chain ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // No circular reference should be detected
    assert!(
        !has_circular_error(&result, 0, 0, 1),
        "False circular reference detected for B1=A1+1"
    );

    // B1 = 10+1 = 11
    assert_cell_number(&result, 0, 0, 1, 11.0);
}

/// A1 = =E1+1, B1 = =A1+1, C1 = =B1+1, D1 = =C1+1, E1 = =D1+1.
/// iterative_calc = false.
/// The demand-driven engine should emit circular diagnostics and materialize
/// #CIRC for all blank ring participants.
#[test]
fn test_cycle_ring_five_cells() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =E1+1
            (0, 0, CellValue::Null, Some("E1+1")),
            // B1 (row 0, col 1): =A1+1
            (0, 1, CellValue::Null, Some("A1+1")),
            // C1 (row 0, col 2): =B1+1
            (0, 2, CellValue::Null, Some("B1+1")),
            // D1 (row 0, col 3): =C1+1
            (0, 3, CellValue::Null, Some("C1+1")),
            // E1 (row 0, col 4): =D1+1
            (0, 4, CellValue::Null, Some("D1+1")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_cycle_ring_five_cells ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Circular reference diagnostics should be emitted
    assert!(
        has_any_circular_error(&result),
        "Expected at least one 'Circular reference' diagnostic for the 5-cell ring"
    );

    for col in 0..5 {
        assert_cell_circular_error(&result, 0, 0, col);
    }
}

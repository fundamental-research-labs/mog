use crate::support::recalc_fixtures::{
    assert_fixed_point_number_or_preserved, build_iterative_snapshot, build_snapshot,
    find_changed_value, has_any_circular_error, run_snapshot,
};
use value_types::CellValue;

/// Models the PPA Allocation pattern:
///   C1 = 169672 (constant)
///   D1 = =E1-C1
///   E1 = =C1+D1
///
/// Substituting: E1 = C1 + (E1 - C1) = E1 — a tautology with infinitely many
/// solutions. The result is history-dependent. With cached values D1=0, E1=169672,
/// the engine must preserve these values (they are a valid fixed point).
///
/// iterative_calc = true so cycle cells are iterated rather than errored.
#[test]
fn test_stable_equilibrium_preserves_cached_values() {
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // C1 (row 0, col 2): constant 169672
                (0, 2, CellValue::number(169672.0), None),
                // D1 (row 0, col 3): =E1-C1, cached value 0
                (0, 3, CellValue::number(0.0), Some("E1-C1")),
                // E1 (row 0, col 4): =C1+D1, cached value 169672
                (0, 4, CellValue::number(169672.0), Some("C1+D1")),
            ],
        )],
        100,
        0.001,
    );

    let result = run_snapshot(snapshot);

    println!("\n=== test_stable_equilibrium_preserves_cached_values ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Circular reference diagnostics are always emitted (informational)
    assert!(
        has_any_circular_error(&result),
        "Expected circular reference diagnostics for cycle cells"
    );

    // D1 should be ~0 (E1 - C1 = 169672 - 169672 = 0).
    // If the cached value is preserved exactly, D1 won't appear in changed_cells
    // (computed value matches mirror) — that's the SUCCESS case.
    let d1 = find_changed_value(&result, 0, 0, 3);
    assert_fixed_point_number_or_preserved(&result, 0, 0, 3, 0.0);

    // E1 should be ~169672 (C1 + D1 = 169672 + 0 = 169672).
    // Same logic: if cached value is preserved, it won't be in changed_cells.
    assert_fixed_point_number_or_preserved(&result, 0, 0, 4, 169672.0);

    // The key assertion: D1 must NOT be a wrong value like -169672.
    // If it were wrong, it would appear in changed_cells with the wrong number.
    // Either it's absent (preserved) or it's ~0.0 — both correct.
    if let Some(CellValue::Number(n)) = d1 {
        assert!(
            n.get() > -1.0,
            "D1 should not be negative (would indicate 0-seed bug), got {}",
            n.get()
        );
    }
}

/// Extends test 9 to multiple rows, matching the actual PPA file pattern:
///   For each row i (0..3):
///     C_i = constant_i
///     D_i = =E_i - C_i  (cached: 0)
///     E_i = =C_i + D_i  (cached: constant_i)
///
/// All rows should preserve their cached values.
#[test]
fn test_stable_equilibrium_multiple_rows() {
    let constants = [169672.0, 84000.0, 50000.0, 12345.0];
    let mut cells = Vec::new();

    for (row, &c_val) in constants.iter().enumerate() {
        let row = row as u32;
        // C column (col 2): constant
        cells.push((row, 2, CellValue::number(c_val), None));
        // D column (col 3): =E{row+1}-C{row+1}, cached 0
        cells.push((
            row,
            3,
            CellValue::number(0.0),
            Some(format!("E{}-C{}", row + 1, row + 1)),
        ));
        // E column (col 4): =C{row+1}+D{row+1}, cached c_val
        cells.push((
            row,
            4,
            CellValue::number(c_val),
            Some(format!("C{}+D{}", row + 1, row + 1)),
        ));
    }

    // Convert owned Strings to the format build_iterative_snapshot expects
    let cell_data: Vec<(u32, u32, CellValue, Option<&str>)> = cells
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_iterative_snapshot(vec![("Sheet1", 10, 10, cell_data)], 100, 0.001);

    let result = run_snapshot(snapshot);

    println!("\n=== test_stable_equilibrium_multiple_rows ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    // Verify each row preserves its values.
    // If the cached value is preserved exactly, the cell won't appear in
    // changed_cells (computed value matches mirror) — that's the SUCCESS case.
    for (row, &c_val) in constants.iter().enumerate() {
        let row = row as u32;

        assert_fixed_point_number_or_preserved(&result, 0, row, 3, 0.0);

        assert_fixed_point_number_or_preserved(&result, 0, row, 4, c_val);
    }
}

/// Same as Test 9 (PPA pattern) but with iterative_calc = false.
/// With always-converge, cached values should be preserved regardless of the flag.
///   C1 = 169672, D1 = =E1-C1 (cached 0), E1 = =C1+D1 (cached 169672)
#[test]
fn test_stable_equilibrium_no_iterative_flag() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // C1 (row 0, col 2): constant 169672
            (0, 2, CellValue::number(169672.0), None),
            // D1 (row 0, col 3): =E1-C1, cached value 0
            (0, 3, CellValue::number(0.0), Some("E1-C1")),
            // E1 (row 0, col 4): =C1+D1, cached value 169672
            (0, 4, CellValue::number(169672.0), Some("C1+D1")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_stable_equilibrium_no_iterative_flag ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_fixed_point_number_or_preserved(&result, 0, 0, 3, 0.0);

    assert_fixed_point_number_or_preserved(&result, 0, 0, 4, 169672.0);

    // Circular reference diagnostics should be emitted
    assert!(
        has_any_circular_error(&result),
        "Expected circular reference diagnostics"
    );
}

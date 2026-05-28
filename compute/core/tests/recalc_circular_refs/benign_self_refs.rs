use crate::support::recalc_fixtures::{
    assert_cell_number, build_snapshot, has_any_circular_error, has_circular_error, run_snapshot,
};
use value_types::CellValue;

/// A1 contains =IF(A1="Yes",1,0) with cached value "No" (text).
/// iterative_calc = false.
///
/// This is a benign self-reference: the formula reads its own cell, but
/// the result is always 0 regardless of the seed (because a number can
/// never equal the string "Yes"). Excel resolves this to 0 without
/// flagging a circular reference error.
///
/// Our engine runs the convergence loop which resolves this in one pass.
/// The result is 0, and a circular reference diagnostic is emitted.
#[test]
fn test_benign_self_ref_if_eq_string_with_cached_value() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =IF(A1="Yes",1,0), cached value "No"
            (
                0,
                0,
                CellValue::Text("No".into()),
                Some("IF(A1=\"Yes\",1,0)"),
            ),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_benign_self_ref_if_eq_string_with_cached_value ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Circular reference diagnostic is emitted (informational, not an error)
    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for self-referencing cell"
    );

    // Should evaluate to 0 (since 0 != "Yes")
    assert_cell_number(&result, 0, 0, 0, 0.0);
}

/// A1 contains =IF(A1="Yes",1,0) with no cached value (Null).
/// iterative_calc = false.
///
/// Same pattern as test 13 but with no cached value. The formula should
/// still converge to 0 because:
/// - Seed: Null (coerced to 0 in comparison) → IF(Null="Yes",1,0) = 0
/// - Re-eval with seed 0: IF(0="Yes",1,0) = 0 → stable fixed point
/// The convergence loop resolves this in one pass.
#[test]
fn test_benign_self_ref_if_eq_string_null_cached() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =IF(A1="Yes",1,0), no cached value
            (0, 0, CellValue::Null, Some("IF(A1=\"Yes\",1,0)")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_benign_self_ref_if_eq_string_null_cached ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Circular reference diagnostic is emitted (informational, not an error)
    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for self-referencing cell"
    );

    // Should evaluate to 0
    assert_cell_number(&result, 0, 0, 0, 0.0);
}

/// A1 = =IF(A1="Yes",1,0), B1 = =A1*2.
/// iterative_calc = false.
/// A1 is a benign self-reference (converges to 0), B1 depends on it.
/// B1 should see A1=0 and compute 0*2 = 0.
#[test]
fn test_benign_self_ref_with_dependent() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =IF(A1="Yes",1,0), cached "No"
            (
                0,
                0,
                CellValue::Text("No".into()),
                Some("IF(A1=\"Yes\",1,0)"),
            ),
            // B1 (row 0, col 1): =A1*2
            (0, 1, CellValue::Null, Some("A1*2")),
        ],
    )]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_benign_self_ref_with_dependent ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // A1 should converge to 0
    // Circular reference diagnostic is emitted (informational)
    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for self-referencing A1"
    );
    assert_cell_number(&result, 0, 0, 0, 0.0);

    // B1 = A1*2 = 0*2 = 0
    assert_cell_number(&result, 0, 0, 1, 0.0);
}

/// Multiple cells with IF(X="Yes",1,0) pattern, all in the same column.
/// Mirrors the real-world corpus pattern from the XLSX file.
#[test]
fn test_multiple_benign_self_refs() {
    let mut cells = Vec::new();
    // 10 cells, each self-referencing: =IF(A{row}="Yes",1,0)
    for row in 0..10u32 {
        let formula = format!("IF(A{}=\"Yes\",1,0)", row + 1);
        cells.push((row, 0, CellValue::Null, Some(formula)));
    }

    let cell_data: Vec<(u32, u32, CellValue, Option<&str>)> = cells
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 20, 10, cell_data)]);

    let result = run_snapshot(snapshot);

    println!("\n=== test_multiple_benign_self_refs ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Circular reference diagnostics should be emitted (informational)
    assert!(
        has_any_circular_error(&result),
        "Expected circular reference diagnostics for self-referencing cells"
    );

    // All cells should evaluate to 0
    for row in 0..10u32 {
        assert_cell_number(&result, 0, row, 0, 0.0);
    }
}

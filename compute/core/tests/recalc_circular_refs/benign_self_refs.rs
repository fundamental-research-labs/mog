use crate::support::recalc_fixtures::{
    assert_cell_circular_error, build_snapshot, find_changed_value, has_any_circular_error,
    has_circular_error, run_snapshot,
};
use value_types::{CellError, CellValue};

/// A1 contains =IF(A1="Yes",1,0) with cached value "No" (text).
/// iterative_calc = false.
///
/// With iterative calculation disabled, imported circular cells preserve cached
/// values even when the cache is non-numeric.
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

    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for self-referencing cell"
    );
    assert_eq!(
        find_changed_value(&result, 0, 0, 0),
        Some(CellValue::Text("No".into()))
    );
}

/// A1 contains =IF(A1="Yes",1,0) with no cached value (Null).
/// iterative_calc = false.
///
/// Blank non-iterative cycle values are materialized as #CIRC.
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

    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for self-referencing cell"
    );
    assert_cell_circular_error(&result, 0, 0, 0);
}

/// A1 = =IF(A1="Yes",1,0), B1 = =A1*2.
/// iterative_calc = false.
/// A1 preserves its imported text cache, and B1 recalculates from that value.
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

    assert!(
        has_circular_error(&result, 0, 0, 0),
        "Expected circular reference diagnostic for self-referencing A1"
    );
    assert_eq!(
        find_changed_value(&result, 0, 0, 0),
        Some(CellValue::Text("No".into()))
    );
    assert_eq!(
        find_changed_value(&result, 0, 0, 1),
        Some(CellValue::Error(CellError::Value, None))
    );
}

/// Multiple cells with IF(X="Yes",1,0) pattern, all in the same column.
/// Exercises repeated benign self references from imported workbook formulas.
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

    assert!(
        has_any_circular_error(&result),
        "Expected circular reference diagnostics for self-referencing cells"
    );

    for row in 0..10u32 {
        assert_cell_circular_error(&result, 0, row, 0);
    }
}

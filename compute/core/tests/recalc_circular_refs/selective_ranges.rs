use crate::support::recalc_fixtures::{
    assert_cell_number, build_snapshot, has_circular_error, run_snapshot,
};
use value_types::{CellValue, FiniteF64};

/// A1=10, A2=20, A3=CHOOSE(1, A1:A3)
/// CHOOSE only reads A1 (index=1), not A3 itself.
/// Should NOT be flagged as circular. A3 should evaluate to 10.
#[test]
fn test_choose_in_own_range_not_false_cycle() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap()), None), // A1=10
            (1, 0, CellValue::Number(FiniteF64::new(20.0).unwrap()), None), // A2=20
            (2, 0, CellValue::Null, Some("=CHOOSE(1,A1:A3)")),              // A3=CHOOSE(1,A1:A3)
        ],
    )]);
    let result = run_snapshot(snapshot);

    // A3 should NOT have a circular error
    assert!(
        !has_circular_error(&result, 0, 2, 0),
        "CHOOSE(1,A1:A3) in A3 should not be a false cycle"
    );
    // A3 should evaluate to 10 (CHOOSE index 1 picks A1)
    assert_cell_number(&result, 0, 2, 0, 10.0);
}

/// A1="x", A2="y", A3=XLOOKUP("x", A1:A3, B1:B3), B1=100, B2=200, B3=300
/// XLOOKUP searches A1:A3 (contains A3), but finds "x" at A1 — reads a subset.
/// Should NOT be flagged as circular. A3 should evaluate to 100.
#[test]
fn test_xlookup_in_own_range_not_false_cycle() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Text("x".into()), None), // A1="x"
            (1, 0, CellValue::Text("y".into()), None), // A2="y"
            (2, 0, CellValue::Null, Some("=XLOOKUP(\"x\",A1:A3,B1:B3)")), // A3=XLOOKUP(...)
            (
                0,
                1,
                CellValue::Number(FiniteF64::new(100.0).unwrap()),
                None,
            ), // B1=100
            (
                1,
                1,
                CellValue::Number(FiniteF64::new(200.0).unwrap()),
                None,
            ), // B2=200
            (
                2,
                1,
                CellValue::Number(FiniteF64::new(300.0).unwrap()),
                None,
            ), // B3=300
        ],
    )]);
    let result = run_snapshot(snapshot);

    // A3 should NOT have a circular error
    assert!(
        !has_circular_error(&result, 0, 2, 0),
        "XLOOKUP in A3 referencing A1:A3 should not be a false cycle"
    );
    // A3 should evaluate to 100 (XLOOKUP finds "x" at A1, returns B1)
    assert_cell_number(&result, 0, 2, 0, 100.0);
}

/// A1=CHOOSE(SUM(A1:A3), 10, 20, 30), A2=1, A3=1
/// The SUM(A1:A3) reads every cell in A1:A3 — including A1.
/// SUM is Aggregate, so this is a REAL cycle (not suppressed by Selective).
/// The CHOOSE itself has selective args, but SUM's arg is Aggregate.
#[test]
fn test_choose_aggregate_arg_still_cycles() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Null, Some("=CHOOSE(SUM(A1:A3),10,20,30)")), // A1=CHOOSE(SUM(A1:A3),...)
            (1, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()), None), // A2=1
            (2, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()), None), // A3=1
        ],
    )]);
    let result = run_snapshot(snapshot);

    // A1 SHOULD have a circular error — SUM(A1:A3) is Aggregate and A1 is in the range
    assert!(
        has_circular_error(&result, 0, 0, 0),
        "CHOOSE(SUM(A1:A3),...) in A1 should be a real cycle due to Aggregate SUM"
    );
}

/// A5=IFS(SUM(A1:A10)>0, "yes", TRUE, "no"), A1..A4=1
/// SUM(A1:A10) is Aggregate and reads A5 (which is in A1:A10).
/// Even though IFS marks its args as Selective, the inner SUM must
/// reset to Aggregate so the real cycle is detected.
#[test]
fn test_nested_aggregate_inside_selective_still_cycles() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()), None), // A1=1
            (1, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()), None), // A2=1
            (2, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()), None), // A3=1
            (3, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()), None), // A4=1
            (
                4,
                0,
                CellValue::Null,
                Some("=IFS(SUM(A1:A10)>0,\"yes\",TRUE,\"no\")"),
            ), // A5
        ],
    )]);
    let result = run_snapshot(snapshot);

    // A5 SHOULD have a circular error — SUM(A1:A10) reads every cell including A5
    assert!(
        has_circular_error(&result, 0, 4, 0),
        "IFS(SUM(A1:A10)>0,...) in A5 should be a real cycle — nested SUM is Aggregate"
    );
}

/// B1=100, B2=200, B3=300, A1="x", A2="y",
/// A3=VLOOKUP("x", A1:B3, 2, FALSE) — lookup_array A1:B3 contains A3.
/// VLOOKUP only searches the first column and reads one row.
/// Should NOT be flagged as circular. A3 should evaluate to 100.
#[test]
fn test_vlookup_in_own_range_not_false_cycle() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Text("x".into()), None), // A1="x"
            (1, 0, CellValue::Text("y".into()), None), // A2="y"
            (2, 0, CellValue::Null, Some("=VLOOKUP(\"x\",A1:B3,2,FALSE)")), // A3=VLOOKUP(...)
            (
                0,
                1,
                CellValue::Number(FiniteF64::new(100.0).unwrap()),
                None,
            ), // B1=100
            (
                1,
                1,
                CellValue::Number(FiniteF64::new(200.0).unwrap()),
                None,
            ), // B2=200
            (
                2,
                1,
                CellValue::Number(FiniteF64::new(300.0).unwrap()),
                None,
            ), // B3=300
        ],
    )]);
    let result = run_snapshot(snapshot);

    assert!(
        !has_circular_error(&result, 0, 2, 0),
        "VLOOKUP in A3 referencing A1:B3 should not be a false cycle"
    );
    assert_cell_number(&result, 0, 2, 0, 100.0);
}

/// A1=10, A2=20, A3=MATCH(10, A1:A3, 0)
/// MATCH searches A1:A3 for the value 10 and returns position 1.
/// A3 is in the lookup range but MATCH reads a subset.
/// Should NOT be flagged as circular. A3 should evaluate to 1.
#[test]
fn test_match_in_own_range_not_false_cycle() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap()), None), // A1=10
            (1, 0, CellValue::Number(FiniteF64::new(20.0).unwrap()), None), // A2=20
            (2, 0, CellValue::Null, Some("=MATCH(10,A1:A3,0)")),            // A3=MATCH(10,A1:A3,0)
        ],
    )]);
    let result = run_snapshot(snapshot);

    assert!(
        !has_circular_error(&result, 0, 2, 0),
        "MATCH in A3 referencing A1:A3 should not be a false cycle"
    );
    assert_cell_number(&result, 0, 2, 0, 1.0);
}

/// Populate A1:A256 with values, A257=INDEX(A1:A257, 1).
/// Range A1:A257 = 257 cells, exceeding RANGE_EXPANSION_THRESHOLD (256).
/// Exercises the large-range Selective path (no corner deps, Range only).
/// Should NOT be flagged as circular. A257 should evaluate to A1's value (1.0).
#[test]
fn test_large_selective_range_not_false_cycle() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    // A1..A256 = their row number (1-based)
    for row in 0..256 {
        cells.push((
            row,
            0,
            CellValue::Number(FiniteF64::new((row + 1) as f64).unwrap()),
            None,
        ));
    }
    // A257 = INDEX(A1:A257, 1) — range contains A257, 257 cells > threshold
    cells.push((256, 0, CellValue::Null, Some("=INDEX(A1:A257,1)")));

    let snapshot = build_snapshot(vec![("Sheet1", 300, 10, cells)]);
    let result = run_snapshot(snapshot);

    assert!(
        !has_circular_error(&result, 0, 256, 0),
        "INDEX with large range (>256 cells) containing self should not be a false cycle"
    );
    // INDEX(A1:A257, 1) returns A1 = 1.0
    assert_cell_number(&result, 0, 256, 0, 1.0);
}

/// A5 = INDEX(A1:A10, 2) + SUM(A1:A10)
/// INDEX's dep on A1:A10 is Selective, but SUM's dep on A1:A10 is Aggregate.
/// The Aggregate SUM reads A5, so this IS a real cycle.
#[test]
fn test_same_range_selective_plus_aggregate_is_cycle() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for row in 0..10 {
        if row == 4 {
            cells.push((
                row,
                0,
                CellValue::Null,
                Some("=INDEX(A1:A10,2)+SUM(A1:A10)"),
            ));
        } else {
            cells.push((
                row,
                0,
                CellValue::Number(FiniteF64::new((row + 1) as f64).unwrap()),
                None,
            ));
        }
    }

    let snapshot = build_snapshot(vec![("Sheet1", 20, 10, cells)]);
    let result = run_snapshot(snapshot);

    // A5 SHOULD be circular — SUM(A1:A10) is Aggregate and reads A5
    assert!(
        has_circular_error(&result, 0, 4, 0),
        "INDEX(A1:A10,2)+SUM(A1:A10) in A5 should be a real cycle due to Aggregate SUM"
    );
}

/// A1=10, A2=20, A3=30, A4=INDEX(A1:A4, MATCH(10, A1:A4, 0))
/// Both INDEX(arg 0) and MATCH(arg 1) are Selective on overlapping ranges
/// containing A4. Should NOT be a false cycle. A4 = INDEX at position 1 = 10.
#[test]
fn test_multiple_selective_functions_not_false_cycle() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap()), None), // A1=10
            (1, 0, CellValue::Number(FiniteF64::new(20.0).unwrap()), None), // A2=20
            (2, 0, CellValue::Number(FiniteF64::new(30.0).unwrap()), None), // A3=30
            (
                3,
                0,
                CellValue::Null,
                Some("=INDEX(A1:A4,MATCH(10,A1:A4,0))"),
            ), // A4
        ],
    )]);
    let result = run_snapshot(snapshot);

    assert!(
        !has_circular_error(&result, 0, 3, 0),
        "INDEX+MATCH combo with self-containing ranges should not be a false cycle"
    );
    // MATCH(10, A1:A4, 0) = 1, INDEX(A1:A4, 1) = 10
    assert_cell_number(&result, 0, 3, 0, 10.0);
}

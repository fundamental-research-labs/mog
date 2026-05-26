//! Formula accuracy tests for issue #6: IFS + AND engine errors.
//!
//! The bug: `_xlfn.IFS` with `AND()` conditions produces engine errors.
//! All 45 mismatches have category `engine_error_vs_value`, meaning our engine
//! returns an error where Excel returns a valid value.
//!
//! The suspected culprit is AND — when AND is used as a condition inside IFS,
//! something goes wrong. These tests systematically exercise IFS, AND, and
//! their combination to reproduce and isolate the failure.
//!
//! Run:
//!   cd /Users/robertyang/Code/shortcut_mono_repo/shortcut/os && \
//!     cargo test -p compute-core --test formula_accuracy_ifs_and

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helper utilities (same pattern as formula_accuracy_null_mismatch)
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (sheet_idx, row, col).
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a minimal `WorkbookSnapshot` from a description of sheets.
/// Each sheet description is `(name, rows, cols, cells)` where `cells` is a vec
/// of `(row, col, value, formula)`.
fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Find the evaluated value for a specific (sheet_index, row, col) in the RecalcResult.
fn find_changed_value(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target_cell_id)
        .map(|cc| cc.value.clone())
}

/// Assert that a cell evaluated to a specific text value.
fn assert_cell_text(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: &str,
    description: &str,
) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Text(ref s)) => assert_eq!(
            &**s, expected,
            "{}: expected \"{}\", got \"{}\"",
            description, expected, s
        ),
        Some(ref other) => panic!(
            "{}: expected Text(\"{}\"), got {:?}",
            description, expected, other
        ),
        None => panic!(
            "{}: cell ({},{},{}) not in changed_cells (engine did not emit a result)",
            description, sheet_idx, row, col
        ),
    }
}

/// Assert that a cell evaluated to a specific boolean value.
fn assert_cell_bool(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: bool,
    description: &str,
) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Boolean(b)) => assert_eq!(
            b, expected,
            "{}: expected {}, got {}",
            description, expected, b
        ),
        Some(ref other) => panic!(
            "{}: expected Boolean({}), got {:?}",
            description, expected, other
        ),
        None => panic!(
            "{}: cell ({},{},{}) not in changed_cells",
            description, sheet_idx, row, col
        ),
    }
}

/// Assert that a cell evaluated to a specific number.
fn assert_cell_number(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
    description: &str,
) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - expected).abs() < 1e-10,
            "{}: expected {}, got {}",
            description,
            expected,
            n.get()
        ),
        Some(ref other) => panic!(
            "{}: expected Number({}), got {:?}",
            description, expected, other
        ),
        None => panic!(
            "{}: cell ({},{},{}) not in changed_cells",
            description, sheet_idx, row, col
        ),
    }
}

/// Assert that a cell evaluated to an error.
fn assert_cell_error(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    description: &str,
) -> CellValue {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Error(..)) => val.unwrap(),
        Some(ref other) => panic!("{}: expected an Error, got {:?}", description, other),
        None => panic!(
            "{}: cell ({},{},{}) not in changed_cells",
            description, sheet_idx, row, col
        ),
    }
}

// ===========================================================================
// Test 1: IFS basic — first TRUE condition
// ===========================================================================

/// `IFS(TRUE, "yes", TRUE, "no")` should return "yes" (first matching pair).
#[test]
fn test_ifs_basic_true_condition() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1: =IFS(TRUE, "yes", TRUE, "no")
            (
                0,
                0,
                CellValue::Null,
                Some("IFS(TRUE, \"yes\", TRUE, \"no\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_basic_true_condition ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(&result, 0, 0, 0, "yes", "IFS(TRUE, \"yes\", TRUE, \"no\")");
}

// ===========================================================================
// Test 2: IFS — first FALSE, second TRUE
// ===========================================================================

/// `IFS(FALSE, "a", TRUE, "b")` should return "b" (skip first, take second).
#[test]
fn test_ifs_first_false_second_true() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("IFS(FALSE, \"a\", TRUE, \"b\")"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_first_false_second_true ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_text(&result, 0, 0, 0, "b", "IFS(FALSE, \"a\", TRUE, \"b\")");
}

// ===========================================================================
// Test 3: IFS — all FALSE returns #N/A
// ===========================================================================

/// `IFS(FALSE, "a", FALSE, "b")` — no condition matches, should return #N/A.
#[test]
fn test_ifs_all_false_returns_na() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("IFS(FALSE, \"a\", FALSE, \"b\")"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_all_false_returns_na ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_error(&result, 0, 0, 0, "IFS all false -> #N/A");
}

// ===========================================================================
// Test 4: IFS — error in condition propagates
// ===========================================================================

/// `IFS(1/0, "a", TRUE, "b")` — first condition is #DIV/0!, should propagate.
#[test]
fn test_ifs_error_in_condition_propagates() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("IFS(1/0, \"a\", TRUE, \"b\")"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_error_in_condition_propagates ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_error(&result, 0, 0, 0, "IFS(1/0, ...) -> #DIV/0!");
}

// ===========================================================================
// Test 5: AND — all TRUE
// ===========================================================================

/// `AND(TRUE, TRUE, TRUE)` should return TRUE.
#[test]
fn test_and_all_true() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(TRUE, TRUE, TRUE)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_all_true ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_bool(&result, 0, 0, 0, true, "AND(TRUE, TRUE, TRUE)");
}

// ===========================================================================
// Test 6: AND — one FALSE
// ===========================================================================

/// `AND(TRUE, FALSE, TRUE)` should return FALSE.
#[test]
fn test_and_one_false() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(TRUE, FALSE, TRUE)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_one_false ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_bool(&result, 0, 0, 0, false, "AND(TRUE, FALSE, TRUE)");
}

// ===========================================================================
// Test 7: AND — with numbers (non-zero = true)
// ===========================================================================

/// `AND(1, 1, 1)` — non-zero numbers are truthy, should return TRUE.
#[test]
fn test_and_with_numbers() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(1, 1, 1)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_numbers ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_bool(&result, 0, 0, 0, true, "AND(1, 1, 1)");
}

// ===========================================================================
// Test 8: AND — with zero (zero = false)
// ===========================================================================

/// `AND(1, 0, 1)` — zero is falsy, should return FALSE.
#[test]
fn test_and_with_zero() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(1, 0, 1)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_zero ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_bool(&result, 0, 0, 0, false, "AND(1, 0, 1)");
}

// ===========================================================================
// Test 9: IFS + AND — both conditions true
// ===========================================================================

/// IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
/// A1=5, B1=3 => AND(5>0, 3>0) = AND(TRUE, TRUE) = TRUE => "both positive"
#[test]
fn test_ifs_with_and_both_positive() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 3
            (0, 1, CellValue::number(3.0), None),
            // C1 = IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), \"both positive\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_with_and_both_positive ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "both positive",
        "IFS(AND(A1>0,B1>0),...) with A1=5,B1=3",
    );
}

// ===========================================================================
// Test 10: IFS + AND — AND condition false, falls through to TRUE
// ===========================================================================

/// IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
/// A1=5, B1=-1 => AND(TRUE, FALSE) = FALSE => skip to TRUE => "fallback"
#[test]
fn test_ifs_with_and_false_falls_through() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = -1
            (0, 1, CellValue::number(-1.0), None),
            // C1 = IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), \"both positive\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_with_and_false_falls_through ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "fallback",
        "IFS(AND(A1>0,B1>0),...) with A1=5,B1=-1",
    );
}

// ===========================================================================
// Test 11: IFS + AND — error propagation from cell reference
// ===========================================================================

/// IFS(AND(A1>0, B1>0), "ok", TRUE, "fallback")
/// A1=5, B1=#DIV/0! => AND evaluates B1>0 which should propagate the error,
/// and IFS should propagate it through.
#[test]
fn test_ifs_with_and_error_propagation() {
    use value_types::CellError;

    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 1/0 (formula that produces #DIV/0!)
            (0, 1, CellValue::Null, Some("1/0")),
            // C1 = IFS(AND(A1>0, B1>0), "ok", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), \"ok\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_with_and_error_propagation ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    // B1 should be #DIV/0!
    let b1_val = find_changed_value(&result, 0, 0, 1);
    match b1_val {
        Some(CellValue::Error(CellError::Div0, None)) => { /* expected */ }
        other => panic!("B1 should be #DIV/0!, got {:?}", other),
    }

    // C1: AND(A1>0, B1>0) where B1 is an error.
    // The comparison B1>0 should propagate the #DIV/0! error through AND,
    // and IFS should propagate it further.
    let err = assert_cell_error(&result, 0, 0, 2, "IFS+AND error propagation");
    match err {
        CellValue::Error(CellError::Div0, None) => { /* correct: #DIV/0! propagated */ }
        CellValue::Error(other, _) => {
            // The error propagated but was a different type — still note it
            println!(
                "NOTE: Expected #DIV/0! but got a different error: {:?}",
                other
            );
        }
        _ => unreachable!(),
    }
}

// ===========================================================================
// Test 12: Full integration — IFS with multiple AND conditions
// ===========================================================================

/// A multi-branch IFS where each condition uses AND with cell references:
///   D1 = IFS(
///     AND(A1>10, B1>10), "both large",
///     AND(A1>0, B1>0),   "both positive",
///     TRUE,              "fallback"
///   )
/// With A1=5, B1=3: first AND is false (5<10), second AND is true => "both positive"
#[test]
fn test_ifs_multiple_and_conditions() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 3
            (0, 1, CellValue::number(3.0), None),
            // C1 (not used, placeholder)
            // D1 = IFS(AND(A1>10,B1>10),"both large",AND(A1>0,B1>0),"both positive",TRUE,"fallback")
            (
                0,
                3,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>10,B1>10),\"both large\",AND(A1>0,B1>0),\"both positive\",TRUE,\"fallback\")",
                ),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_multiple_and_conditions ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        3,
        "both positive",
        "IFS with multiple AND branches",
    );
}

// ===========================================================================
// Test 13: IFS with AND — comparison against text values
// ===========================================================================

/// Tests AND where the comparisons involve text. This is a common corpus pattern:
///   IFS(AND(A1="yes", B1="yes"), "both yes", TRUE, "not both")
#[test]
fn test_ifs_and_with_text_comparisons() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = "yes"
            (0, 0, CellValue::Text("yes".into()), None),
            // B1 = "yes"
            (0, 1, CellValue::Text("yes".into()), None),
            // C1 = IFS(AND(A1="yes",B1="yes"),"both yes",TRUE,"not both")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1=\"yes\",B1=\"yes\"),\"both yes\",TRUE,\"not both\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_with_text_comparisons ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "both yes",
        "IFS(AND(A1=\"yes\",B1=\"yes\"),...)",
    );
}

// ===========================================================================
// Test 14: IFS with AND — numeric result values
// ===========================================================================

/// IFS can return numeric values, not just text:
///   IFS(AND(A1>0, B1>0), A1+B1, TRUE, 0)
/// A1=10, B1=20 => AND is true => return A1+B1 = 30
#[test]
fn test_ifs_and_with_numeric_results() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 10
            (0, 0, CellValue::number(10.0), None),
            // B1 = 20
            (0, 1, CellValue::number(20.0), None),
            // C1 = IFS(AND(A1>0, B1>0), A1+B1, TRUE, 0)
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), A1+B1, TRUE, 0)"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_with_numeric_results ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_number(
        &result,
        0,
        0,
        2,
        30.0,
        "IFS(AND(A1>0,B1>0), A1+B1,...) with A1=10,B1=20",
    );
}

// ===========================================================================
// Test 15: _xlfn.IFS prefix — parser should strip it
// ===========================================================================

/// The XLSX corpus uses `_xlfn.IFS(...)`. The parser strips `_xlfn.` prefix,
/// so this should work identically to plain `IFS(...)`.
#[test]
fn test_xlfn_ifs_prefix_stripped() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("_xlfn.IFS(TRUE, \"yes\", TRUE, \"no\")"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_xlfn_ifs_prefix_stripped ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "yes",
        "_xlfn.IFS(TRUE, \"yes\", TRUE, \"no\")",
    );
}

// ===========================================================================
// Test 16: _xlfn.IFS with AND — the exact corpus pattern
// ===========================================================================

/// This is the closest reproduction of the corpus pattern:
///   _xlfn.IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
/// Tests that the _xlfn. prefix is correctly stripped AND the IFS+AND combo works.
#[test]
fn test_xlfn_ifs_with_and_condition() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 3
            (0, 1, CellValue::number(3.0), None),
            // C1 = _xlfn.IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("_xlfn.IFS(AND(A1>0, B1>0), \"both positive\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_xlfn_ifs_with_and_condition ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "both positive",
        "_xlfn.IFS(AND(A1>0,B1>0),...) with A1=5,B1=3",
    );
}

// ===========================================================================
// Test 17: IFS with nested AND and OR
// ===========================================================================

/// IFS(AND(A1>0, OR(B1>5, C1>5)), "match", TRUE, "no match")
/// A1=10, B1=2, C1=8 => A1>0=TRUE, OR(FALSE, TRUE)=TRUE, AND(TRUE,TRUE)=TRUE => "match"
#[test]
fn test_ifs_and_or_nested() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 10
            (0, 0, CellValue::number(10.0), None),
            // B1 = 2
            (0, 1, CellValue::number(2.0), None),
            // C1 = 8
            (0, 2, CellValue::number(8.0), None),
            // D1 = IFS(AND(A1>0, OR(B1>5, C1>5)), "match", TRUE, "no match")
            (
                0,
                3,
                CellValue::Null,
                Some("IFS(AND(A1>0, OR(B1>5, C1>5)), \"match\", TRUE, \"no match\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_or_nested ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        3,
        "match",
        "IFS(AND(A1>0, OR(B1>5,C1>5)),...)",
    );
}

// ===========================================================================
// Test 18: AND with cell range reference
// ===========================================================================

/// AND can take a range: AND(A1:A3) where all cells are truthy.
/// A1=1, A2=1, A3=1 => AND(1,1,1) = TRUE
/// This tests eval_and_flatten with range arguments.
#[test]
fn test_and_with_cell_range() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = 1
            (1, 0, CellValue::number(1.0), None),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_cell_range ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_bool(&result, 0, 0, 1, true, "AND(A1:A3) with all 1s");
}

// ===========================================================================
// Test 19: AND with range containing zero (false)
// ===========================================================================

/// AND(A1:A3) where A2=0 => FALSE
#[test]
fn test_and_with_range_containing_zero() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = 0
            (1, 0, CellValue::number(0.0), None),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_range_containing_zero ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_bool(&result, 0, 0, 1, false, "AND(A1:A3) with A2=0");
}

// ===========================================================================
// Test 20: AND with range containing static error value
// ===========================================================================

/// AND(A1:A3) where A2 has a static error value => should propagate the error.
/// Uses a static CellValue::Error rather than a formula to avoid dependency
/// ordering issues.
#[test]
fn test_and_with_range_containing_static_error() {
    use value_types::CellError;

    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = #DIV/0! (static error value, no formula)
            (1, 0, CellValue::Error(CellError::Div0, None), None),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_range_containing_static_error ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_error(&result, 0, 0, 1, "AND(A1:A3) with static error in A2");
}

// ===========================================================================
// Test 20b: AND with range containing formula error (dependency ordering)
// ===========================================================================

/// AND(A1:A3) where A2 has a FORMULA that produces #DIV/0!
/// BUG: If the scheduler evaluates B1 (AND formula) before A2 (1/0 formula),
/// the range A1:A3 sees Null for A2 instead of the computed error. This
/// causes AND to return FALSE (Null coerces to false) instead of #DIV/0!.
/// This test documents this potential dependency ordering issue.
#[test]
fn test_and_with_range_containing_formula_error() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = 1/0 (formula producing #DIV/0!)
            (1, 0, CellValue::Null, Some("1/0")),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_range_containing_formula_error ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    // Ideally AND should propagate the #DIV/0! error from A2.
    // If the scheduler correctly orders A2 before B1, this will be Error(Div0).
    // If there's a dependency ordering bug, it may return Boolean(false) because
    // the range sees Null for A2 before A2's formula is evaluated.
    let val = find_changed_value(&result, 0, 0, 1);
    match val {
        Some(CellValue::Error(..)) => {
            println!("PASS: AND correctly propagated the error from A2's formula");
        }
        Some(CellValue::Boolean(false)) => {
            // This indicates a dependency ordering issue: B1 was evaluated before
            // A2's formula, so the range saw Null instead of #DIV/0!.
            // This is a known issue that may contribute to the IFS+AND corpus errors.
            panic!(
                "BUG: AND(A1:A3) returned FALSE instead of propagating A2's #DIV/0! error. \
                 This suggests the scheduler evaluated B1 before A2, so the range saw \
                 Null for A2 instead of the computed #DIV/0! error. This dependency \
                 ordering issue may be the root cause of the IFS+AND corpus errors."
            );
        }
        other => panic!(
            "AND(A1:A3) with formula error in A2: unexpected result {:?}",
            other
        ),
    }
}

// ===========================================================================
// Test 21: IFS with AND using range in AND
// ===========================================================================

/// IFS(AND(A1:A3), "all true", TRUE, "not all")
/// A1=TRUE, A2=TRUE, A3=TRUE => AND is true => "all true"
#[test]
fn test_ifs_and_with_range_argument() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = TRUE
            (0, 0, CellValue::Boolean(true), None),
            // A2 = TRUE
            (1, 0, CellValue::Boolean(true), None),
            // A3 = TRUE
            (2, 0, CellValue::Boolean(true), None),
            // B1 = IFS(AND(A1:A3), "all true", TRUE, "not all")
            (
                0,
                1,
                CellValue::Null,
                Some("IFS(AND(A1:A3), \"all true\", TRUE, \"not all\")"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_with_range_argument ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        1,
        "all true",
        "IFS(AND(A1:A3),...) with all TRUE",
    );
}

// ===========================================================================
// Test 22: IFS with condition that evaluates to number 1 (truthy)
// ===========================================================================

/// IFS(1, "one is truthy") — the number 1 should coerce to TRUE for IFS.
#[test]
fn test_ifs_numeric_condition_coercion() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("IFS(1, \"one is truthy\")"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_numeric_condition_coercion ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "one is truthy",
        "IFS(1, \"one is truthy\")",
    );
}

// ===========================================================================
// Test 23: IFS with condition that evaluates to number 0 (falsy)
// ===========================================================================

/// IFS(0, "zero", TRUE, "fallback") — 0 coerces to FALSE, should skip to fallback.
#[test]
fn test_ifs_zero_condition_is_false() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("IFS(0, \"zero\", TRUE, \"fallback\")"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_zero_condition_is_false ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "fallback",
        "IFS(0, \"zero\", TRUE, \"fallback\")",
    );
}

// ===========================================================================
// Test 24: Cross-sheet IFS + AND
// ===========================================================================

/// IFS formula on Sheet1 referencing cells on Sheet2:
///   Sheet1!A1 = IFS(AND(Sheet2!A1>0, Sheet2!B1>0), "both pos", TRUE, "no")
///   Sheet2!A1 = 5, Sheet2!B1 = 10
#[test]
fn test_ifs_and_cross_sheet() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(
                0,
                0,
                CellValue::Null,
                Some("IFS(AND(Sheet2!A1>0, Sheet2!B1>0), \"both pos\", TRUE, \"no\")"),
            )],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                // A1 = 5
                (0, 0, CellValue::number(5.0), None),
                // B1 = 10
                (0, 1, CellValue::number(10.0), None),
            ],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_cross_sheet ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "both pos",
        "Cross-sheet IFS(AND(Sheet2!A1>0,Sheet2!B1>0),...)",
    );
}

// ===========================================================================
// Test 25: AND with empty/null cells — Excel skips nulls in boolean logic
// ===========================================================================

/// AND(A1, A2) where A2 is empty (Null). In Excel, AND ignores empty cells
/// in reference arguments, so AND(TRUE, <empty>) => AND(TRUE) => TRUE.
#[test]
fn test_and_with_null_cell() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = TRUE
            (0, 0, CellValue::Boolean(true), None),
            // A2 is empty (not in cells vec)
            // B1 = AND(A1, A2)
            (0, 1, CellValue::Null, Some("AND(A1, A2)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_and_with_null_cell ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    // AND ignores empty cells in reference arguments, so AND(TRUE) = TRUE
    assert_cell_bool(&result, 0, 0, 1, true, "AND(TRUE, <empty>) = TRUE");
}

// ===========================================================================
// Test 26: IFS with AND — complex corpus-like pattern with multiple data rows
// ===========================================================================

/// Simulates a more realistic scenario with data in rows and a formula row:
///   Row 1: data values
///   Row 2: IFS formula referencing row 1 cells
///
///   A1=100, B1=50, C1="Active"
///   A2 = IFS(AND(A1>=100, B1>=50, C1="Active"), "Qualified",
///            AND(A1>=50, B1>=25), "Partial",
///            TRUE, "Not qualified")
/// Expected: "Qualified"
#[test]
fn test_ifs_and_corpus_like_pattern() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 100
            (0, 0, CellValue::number(100.0), None),
            // B1 = 50
            (0, 1, CellValue::number(50.0), None),
            // C1 = "Active"
            (0, 2, CellValue::Text("Active".into()), None),
            // A2 = IFS(AND(A1>=100,B1>=50,C1="Active"),"Qualified",AND(A1>=50,B1>=25),"Partial",TRUE,"Not qualified")
            (
                1,
                0,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>=100,B1>=50,C1=\"Active\"),\"Qualified\",AND(A1>=50,B1>=25),\"Partial\",TRUE,\"Not qualified\")",
                ),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_corpus_like_pattern ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        1,
        0,
        "Qualified",
        "Corpus-like IFS(AND(>=100,>=50,=\"Active\"),...)",
    );
}

// ===========================================================================
// Test 27: Same corpus pattern with values that hit second branch
// ===========================================================================

/// A1=75, B1=30, C1="Inactive"
/// First AND: AND(75>=100, 30>=50, "Inactive"="Active") = AND(FALSE,...) = FALSE
/// Second AND: AND(75>=50, 30>=25) = AND(TRUE, TRUE) = TRUE => "Partial"
#[test]
fn test_ifs_and_corpus_like_second_branch() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(75.0), None),
            (0, 1, CellValue::number(30.0), None),
            (0, 2, CellValue::Text("Inactive".into()), None),
            (
                1,
                0,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>=100,B1>=50,C1=\"Active\"),\"Qualified\",AND(A1>=50,B1>=25),\"Partial\",TRUE,\"Not qualified\")",
                ),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_corpus_like_second_branch ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(&result, 0, 1, 0, "Partial", "Corpus-like IFS second branch");
}

// ===========================================================================
// Test 28: Same corpus pattern falling through to TRUE
// ===========================================================================

/// A1=10, B1=5, C1="Gone"
/// First AND: FALSE (10<100)
/// Second AND: AND(10>=50, 5>=25) = AND(FALSE, FALSE) = FALSE
/// Falls to TRUE => "Not qualified"
#[test]
fn test_ifs_and_corpus_like_fallthrough() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (0, 1, CellValue::number(5.0), None),
            (0, 2, CellValue::Text("Gone".into()), None),
            (
                1,
                0,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>=100,B1>=50,C1=\"Active\"),\"Qualified\",AND(A1>=50,B1>=25),\"Partial\",TRUE,\"Not qualified\")",
                ),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_ifs_and_corpus_like_fallthrough ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_text(
        &result,
        0,
        1,
        0,
        "Not qualified",
        "Corpus-like IFS fallthrough to TRUE",
    );
}

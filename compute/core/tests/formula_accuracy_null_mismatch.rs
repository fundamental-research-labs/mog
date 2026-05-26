//! Integration tests for formula accuracy issue #1: null_mismatch / cross-sheet references.
//!
//! Problem: Simple cross-sheet references like `Events!AY202` return `null` instead of the
//! expected value (typically `0`). Same-sheet references like `N23` also return `null` in
//! some cases. The issue is that cells beyond the snapshot's loaded range aren't being
//! populated, so references to them resolve to `CellValue::Null` instead of their actual values.
//!
//! Corpus examples:
//!   - `P&L!R18C73` has formula `Events!AY202` -> actual=null, expected=0
//!   - `Assumptions!R25C5` has formula `N23` -> actual=null, expected=0
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_null_mismatch -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (row, col, sheet_idx).
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
/// Returns `None` if no change was emitted for that cell (meaning the engine did not
/// recompute it or left it unchanged).
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

// ---------------------------------------------------------------------------
// Test 1: Basic cross-sheet reference to a numeric cell
// ---------------------------------------------------------------------------

/// Sheet1!A1 has formula `=Sheet2!A1`, Sheet2!A1 has value 99.
/// The cross-sheet reference should resolve to 99.
#[test]
fn test_cross_sheet_ref_to_numeric_cell() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![
                // A1 (row 0, col 0): formula referencing Sheet2!A1
                (0, 0, CellValue::Null, Some("Sheet2!A1")),
            ],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                // A1 (row 0, col 0): numeric value
                (0, 0, CellValue::number(99.0), None),
            ],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    // Print diagnostics
    println!("\n=== test_cross_sheet_ref_to_numeric_cell ===");
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }

    let val = find_changed_value(&result, 0, 0, 0);
    assert!(
        val.is_some(),
        "Expected Sheet1!A1 to appear in changed_cells"
    );
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 99.0).abs() < 1e-10,
            "Expected 99, got {}",
            n.get()
        ),
        other => panic!("Expected Number(99), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 2: Cross-sheet reference to an empty cell (coercion in arithmetic)
// ---------------------------------------------------------------------------

/// Sheet1!A1 has formula `=Sheet2!A1+1`, Sheet2!A1 is empty (Null).
/// In Excel, an empty cell referenced in arithmetic coerces to 0, so the result should be 1.
#[test]
fn test_cross_sheet_ref_to_empty_cell() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![
                // A1: =Sheet2!A1+1  (empty + 1 should be 1 in Excel)
                (0, 0, CellValue::Null, Some("Sheet2!A1+1")),
            ],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                // No cells — Sheet2!A1 is genuinely empty
            ],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    println!("\n=== test_cross_sheet_ref_to_empty_cell ===");
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }

    let val = find_changed_value(&result, 0, 0, 0);
    assert!(
        val.is_some(),
        "Expected Sheet1!A1 to appear in changed_cells"
    );
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 1.0).abs() < 1e-10,
            "Expected 1 (empty + 1 = 0 + 1), got {}",
            n.get()
        ),
        other => panic!("Expected Number(1), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 3: Cross-sheet reference to a distant cell (row 200+)
// ---------------------------------------------------------------------------

/// Sheet1!A1 has formula `=Events!AY202`, Events sheet has a value at row 201 col 50
/// (AY = col index 50). This tests resolution of cells far beyond typical buffer ranges.
#[test]
fn test_cross_sheet_ref_to_distant_cell() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![
                // A1: formula referencing Events!AY202  (row 201, col 50 zero-indexed)
                (0, 0, CellValue::Null, Some("Events!AY202")),
            ],
        ),
        (
            "Events",
            300, // large enough row count
            60,  // large enough col count
            vec![
                // AY202 = row 201, col 50 (AY is column 51 in 1-indexed = 50 zero-indexed)
                (201, 50, CellValue::number(42.0), None),
            ],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    println!("\n=== test_cross_sheet_ref_to_distant_cell ===");
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }

    let val = find_changed_value(&result, 0, 0, 0);
    assert!(
        val.is_some(),
        "Expected Sheet1!A1 to appear in changed_cells"
    );
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 42.0).abs() < 1e-10,
            "Expected 42, got {}",
            n.get()
        ),
        other => panic!("Expected Number(42), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 4: Same-sheet reference to empty cell in arithmetic
// ---------------------------------------------------------------------------

/// Formula `=N23+1` where N23 (row 22, col 13) is empty.
/// In Excel, empty cells coerce to 0 in arithmetic, so result should be 1.
/// Also tests bare `=N23` which should return 0 (Excel coerces empty to 0 for display).
#[test]
fn test_same_sheet_ref_to_empty_cell_returns_zero_in_arithmetic() {
    let snapshot = build_snapshot(vec![(
        "Assumptions",
        100,
        20,
        vec![
            // A1 (row 0, col 0): =N23+1  — should evaluate to 1
            (0, 0, CellValue::Null, Some("N23+1")),
            // A2 (row 1, col 0): =N23    — bare reference to empty cell
            (1, 0, CellValue::Null, Some("N23")),
            // N23 is NOT in the cells vec, so it is empty/Null
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    println!("\n=== test_same_sheet_ref_to_empty_cell_returns_zero_in_arithmetic ===");
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }

    // A1: =N23+1 should be 1
    let val_a1 = find_changed_value(&result, 0, 0, 0);
    assert!(val_a1.is_some(), "Expected A1 to appear in changed_cells");
    match val_a1.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 1.0).abs() < 1e-10,
            "Expected 1 (empty + 1), got {}",
            n.get()
        ),
        other => panic!("Expected Number(1), got {:?}", other),
    }

    // A2: =N23 — a bare reference to an empty cell. In Excel this evaluates to 0
    // (the cell displays as empty but the formula result is 0).
    //
    // BUG: The engine evaluates =N23 to Null (same as initial value), so no change
    // is emitted. The corpus expects 0. This is the null_mismatch bug:
    // bare references to empty cells should resolve to Number(0), not Null.
    let val_a2 = find_changed_value(&result, 0, 1, 0);
    match val_a2 {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - 0.0).abs() < 1e-10,
            "Expected 0 for bare ref to empty cell, got {}",
            n.get()
        ),
        Some(other) => panic!("Expected Number(0) for =N23, got {:?}", other),
        None => {
            // No change emitted means the engine kept the value as Null.
            // This IS the null_mismatch bug: =N23 should produce Number(0), not Null.
            panic!(
                "=N23 not in changed_cells — engine returned Null instead of Number(0). \
                 This is the null_mismatch bug: Excel returns 0 for a bare reference \
                 to an empty cell, but our engine returns Null."
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Test 5: Cross-sheet chain (Sheet1 -> Sheet2 -> Sheet3)
// ---------------------------------------------------------------------------

/// Sheet1!A1 = `=Sheet2!A1`, Sheet2!A1 = `=Sheet3!A1`, Sheet3!A1 = 42.
/// The chain should resolve: Sheet1!A1 -> Sheet2!A1 -> Sheet3!A1 = 42.
#[test]
fn test_cross_sheet_chain() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet3!A1"))],
        ),
        (
            "Sheet3",
            10,
            10,
            vec![(0, 0, CellValue::number(42.0), None)],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    println!("\n=== test_cross_sheet_chain ===");
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!(
            "  cell_id={} sheet_id={} value={:?}",
            cc.cell_id, cc.sheet_id, cc.value
        );
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }

    // Sheet2!A1 should resolve to 42 (via Sheet3!A1)
    let val_s2 = find_changed_value(&result, 1, 0, 0);
    assert!(
        val_s2.is_some(),
        "Expected Sheet2!A1 to appear in changed_cells"
    );
    match val_s2.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 42.0).abs() < 1e-10,
            "Expected Sheet2!A1 = 42, got {}",
            n.get()
        ),
        other => panic!("Expected Number(42), got {:?}", other),
    }

    // Sheet1!A1 should also resolve to 42 (via Sheet2!A1 -> Sheet3!A1)
    let val_s1 = find_changed_value(&result, 0, 0, 0);
    assert!(
        val_s1.is_some(),
        "Expected Sheet1!A1 to appear in changed_cells"
    );
    match val_s1.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 42.0).abs() < 1e-10,
            "Expected Sheet1!A1 = 42, got {}",
            n.get()
        ),
        other => panic!("Expected Number(42), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 6: Multiple cross-sheet references in a single formula
// ---------------------------------------------------------------------------

/// Sheet1!A1 = `=Sheet2!A1+Sheet3!A1`, Sheet2!A1 = 10, Sheet3!A1 = 32.
/// Result should be 42.
#[test]
fn test_multiple_cross_sheet_refs_in_formula() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1+Sheet3!A1"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::number(10.0), None)],
        ),
        (
            "Sheet3",
            10,
            10,
            vec![(0, 0, CellValue::number(32.0), None)],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    println!("\n=== test_multiple_cross_sheet_refs_in_formula ===");
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }

    let val = find_changed_value(&result, 0, 0, 0);
    assert!(
        val.is_some(),
        "Expected Sheet1!A1 to appear in changed_cells"
    );
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 42.0).abs() < 1e-10,
            "Expected 42 (10 + 32), got {}",
            n.get()
        ),
        other => panic!("Expected Number(42), got {:?}", other),
    }
}

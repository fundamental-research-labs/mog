//! Integration tests for the dense aggregate fast path and progressive
//! column completion through the full ComputeCore pipeline.
//!
//! These tests exercise SUM, AVERAGE, COUNT, COUNTA, MIN, MAX on large
//! columns of data, verifying correct results and partial recalc behavior.
//!
//! Run:
//!   cargo test -p compute-core --test recalc_dense_aggregate -- --nocapture

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helper utilities
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
    result: &RecalcResult,
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

/// Assert that a cell evaluated to a specific number (within tolerance).
fn assert_cell_number(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell ({},{},{}) expected {}, got {}",
                sheet_idx,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell ({},{},{}) expected Number({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell ({},{},{}) not in changed_cells (expected Number({}))",
            sheet_idx, row, col, expected
        ),
    }
}

// ===========================================================================
// Test 1: SUM over a large numeric column
// ===========================================================================

/// SUM(A1:A1000) over 1000 rows with values 1.0 through 1000.0.
/// Expected: 500500.0
#[test]
fn test_sum_large_numeric_column() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(1001);

    // Col A (col=0): rows 0..999 have values 1.0..1000.0
    for i in 0..1000u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Row 1000, col B (col=1): =SUM(A1:A1000)
    cells.push((1000, 1, CellValue::Null, Some("SUM(A1:A1000)")));

    let snapshot = build_snapshot(vec![("Sheet1", 1001, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_large_numeric_column ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_number(&result, 0, 1000, 1, 500500.0);
}

// ===========================================================================
// Test 2: AVERAGE over a large numeric column
// ===========================================================================

/// AVERAGE(A1:A500) over 500 rows with values 1.0 through 500.0.
/// Expected: 250.5
#[test]
fn test_average_large_numeric_column() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(501);

    for i in 0..500u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Row 500, col B (col=1): =AVERAGE(A1:A500)
    cells.push((500, 1, CellValue::Null, Some("AVERAGE(A1:A500)")));

    let snapshot = build_snapshot(vec![("Sheet1", 501, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_average_large_numeric_column ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_number(&result, 0, 500, 1, 250.5);
}

// ===========================================================================
// Test 3: COUNT with mixed types (numbers, text, nulls)
// ===========================================================================

/// COUNT(A1:A400) with 300 numbers, 50 text cells, and 50 nulls.
/// COUNT only counts numeric values, so expected: 300.0
#[test]
fn test_count_large_numeric_column() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(351);

    // Rows 0..299: numbers
    for i in 0..300u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Rows 300..349: text
    for i in 300..350u32 {
        cells.push((i, 0, CellValue::Text(format!("text{}", i).into()), None));
    }

    // Rows 350..399: nulls (omitted from cells list — they default to Null)

    // Row 400, col B (col=1): =COUNT(A1:A400)
    cells.push((400, 1, CellValue::Null, Some("COUNT(A1:A400)")));

    let snapshot = build_snapshot(vec![("Sheet1", 401, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_count_large_numeric_column ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_number(&result, 0, 400, 1, 300.0);
}

// ===========================================================================
// Test 4: MIN and MAX over a large column
// ===========================================================================

/// 500 rows with values row i = (i+1) * 3.0.
/// MIN = 3.0, MAX = 1500.0
#[test]
fn test_min_max_large_column() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(502);

    for i in 0..500u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64 * 3.0), None));
    }

    // Row 500, col B (col=1): =MIN(A1:A500)
    cells.push((500, 1, CellValue::Null, Some("MIN(A1:A500)")));
    // Row 500, col C (col=2): =MAX(A1:A500)
    cells.push((500, 2, CellValue::Null, Some("MAX(A1:A500)")));

    let snapshot = build_snapshot(vec![("Sheet1", 501, 3, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_min_max_large_column ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    assert_cell_number(&result, 0, 500, 1, 3.0);
    assert_cell_number(&result, 0, 500, 2, 1500.0);
}

// ===========================================================================
// Test 5: SUM with boolean cells (Excel semantics: skip booleans from refs)
// ===========================================================================

/// 100 numeric cells (1.0..100.0) + 10 TRUE cells + 10 FALSE cells.
/// SUM over cell references should SKIP booleans (Excel semantics).
/// Expected: SUM = 1+2+...+100 = 5050.0
#[test]
fn test_sum_with_boolean_cells() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(121);

    // Rows 0..99: numbers 1.0..100.0
    for i in 0..100u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Rows 100..109: TRUE
    for i in 100..110u32 {
        cells.push((i, 0, CellValue::Boolean(true), None));
    }

    // Rows 110..119: FALSE
    for i in 110..120u32 {
        cells.push((i, 0, CellValue::Boolean(false), None));
    }

    // Row 120, col B (col=1): =SUM(A1:A120)
    cells.push((120, 1, CellValue::Null, Some("SUM(A1:A120)")));

    let snapshot = build_snapshot(vec![("Sheet1", 121, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_with_boolean_cells ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // In Excel, SUM over a range ignores boolean values in cells
    assert_cell_number(&result, 0, 120, 1, 5050.0);
}

// ===========================================================================
// Test 6: Progressive column completion via partial recalc
// ===========================================================================

/// Init with 500 numeric cells + SUM formula. Verify initial SUM.
/// Then change ONE cell's value and verify the SUM updates correctly.
#[test]
fn test_sum_partial_recalc_progressive() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(501);

    // Col A (col=0): rows 0..499 have values 1.0..500.0
    for i in 0..500u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Row 500, col B (col=1): =SUM(A1:A500)
    cells.push((500, 1, CellValue::Null, Some("SUM(A1:A500)")));

    let snapshot = build_snapshot(vec![("Sheet1", 501, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_partial_recalc_progressive (init) ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());

    // Initial SUM = 1+2+...+500 = 125250.0
    assert_cell_number(&result, 0, 500, 1, 125250.0);

    // Now change cell A1 (row=0, col=0) from 1.0 to 1001.0 (delta = +1000)
    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("parse sheet uuid");
    let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("parse cell uuid");

    let result2 = core
        .set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, "1001")
        .expect("set_cell failed");

    println!("\n=== test_sum_partial_recalc_progressive (after set_cell) ===");
    println!("  changed_cells: {}", result2.changed_cells.len());
    println!("  errors: {}", result2.errors.len());
    for cc in &result2.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }

    // New SUM = 125250 - 1 + 1001 = 126250.0
    assert_cell_number(&result2, 0, 500, 1, 126250.0);
}

// ===========================================================================
// Test 7: COUNTA with mixed types
// ===========================================================================

/// COUNTA counts everything except Null.
/// 50 numbers + 30 text + 20 booleans + 50 nulls = 100 non-null values.
#[test]
fn test_counta_with_mixed_types() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(101);

    // Rows 0..49: numbers
    for i in 0..50u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Rows 50..79: text
    for i in 50..80u32 {
        cells.push((i, 0, CellValue::Text(format!("item{}", i).into()), None));
    }

    // Rows 80..89: TRUE
    for i in 80..90u32 {
        cells.push((i, 0, CellValue::Boolean(true), None));
    }

    // Rows 90..99: FALSE
    for i in 90..100u32 {
        cells.push((i, 0, CellValue::Boolean(false), None));
    }

    // Rows 100..149: nulls (omitted)

    // Row 150, col B (col=1): =COUNTA(A1:A150)
    cells.push((150, 1, CellValue::Null, Some("COUNTA(A1:A150)")));

    let snapshot = build_snapshot(vec![("Sheet1", 151, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_counta_with_mixed_types ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // 50 numbers + 30 text + 20 booleans = 100 non-null values
    assert_cell_number(&result, 0, 150, 1, 100.0);
}

// ===========================================================================
// Test 8: SUM with multiple range arguments
// ===========================================================================

/// SUM(A1:A100,B1:B100) — two range arguments.
/// Tests that the dense fast path gracefully falls back for multi-arg SUM.
/// A column has values 1..100, B column has values 101..200.
/// Expected: SUM(1..100) + SUM(101..200) = 5050 + 15050 = 20100.0
#[test]
fn test_sum_multi_argument() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(201);

    // Col A (col=0): values 1.0..100.0
    for i in 0..100u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Col B (col=1): values 101.0..200.0
    for i in 0..100u32 {
        cells.push((i, 1, CellValue::number((i + 101) as f64), None));
    }

    // Row 100, col C (col=2): =SUM(A1:A100,B1:B100)
    cells.push((100, 2, CellValue::Null, Some("SUM(A1:A100,B1:B100)")));

    let snapshot = build_snapshot(vec![("Sheet1", 101, 3, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_multi_argument ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // SUM(1..100) = 5050, SUM(101..200) = 15050, total = 20100
    assert_cell_number(&result, 0, 100, 2, 20100.0);
}

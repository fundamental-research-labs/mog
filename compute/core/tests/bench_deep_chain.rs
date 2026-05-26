//! Benchmark for deep dependency chain evaluation.
//!
//! This test exercises the demand-driven evaluator on linear chains of depth
//! 1,000 and 5,000, measuring dispatch overhead. It validates the stacker
//! batching optimization.
//!
//! Run:
//!   cargo test -p compute-core --features perf-tests --release \
//!     --test bench_deep_chain -- --nocapture

#![cfg(feature = "perf-tests")]

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use std::time::Instant;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("d0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("d{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a workbook with a single linear chain of `depth` cells:
///
///   A1 = 1
///   A2 = A1 + 1
///   A3 = A2 + 1
///   ...
///   A[depth] = A[depth-1] + 1
///
/// Expected value of A[depth]: `depth` as f64.
fn snapshot_linear_chain(depth: u32) -> WorkbookSnapshot {
    let mut cells = Vec::with_capacity(depth as usize);

    // A1 (row 0): literal value
    cells.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });

    // A2..A[depth]: each references the previous row
    for row in 1..depth {
        cells.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::Null,
            formula: Some(format!("A{}+1", row)), // A{row} is 1-indexed
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: depth,
            cols: 1,
            cells,
            ranges: vec![],
        }],
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

/// Build a workbook with a linear chain wrapped in IFERROR, matching the
/// real-world pattern: `=IFERROR(A{prev}+1, 0)`.
///
/// Same expected value as the simple chain.
fn snapshot_iferror_chain(depth: u32) -> WorkbookSnapshot {
    let mut cells = Vec::with_capacity(depth as usize);

    cells.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });

    for row in 1..depth {
        cells.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::Null,
            formula: Some(format!("IFERROR(A{}+1,0)", row)),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: depth,
            cols: 1,
            cells,
            ranges: vec![],
        }],
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

/// Build a workbook with a cross-sheet linear chain. Each of `num_sheets`
/// sheets has `rows_per_sheet` rows. The chain continues from the last row
/// of one sheet to the first row of the next via cross-sheet references.
///
///   Sheet1!A1 = 1
///   Sheet1!A2 = Sheet1!A1 + 1
///   ...
///   Sheet2!A1 = Sheet1!A[last] + 1
///   Sheet2!A2 = Sheet2!A1 + 1
///   ...
///
/// Total chain depth: num_sheets * rows_per_sheet.
fn snapshot_cross_sheet_chain(num_sheets: u32, rows_per_sheet: u32) -> WorkbookSnapshot {
    let mut sheets = Vec::with_capacity(num_sheets as usize);

    for si in 0..num_sheets {
        let sheet_name = format!("Sheet{}", si + 1);
        let mut cells = Vec::with_capacity(rows_per_sheet as usize);

        for row in 0..rows_per_sheet {
            if si == 0 && row == 0 {
                // First cell in the entire chain: literal value
                cells.push(CellData {
                    cell_id: cell_uuid(si, row, 0),
                    row,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                });
            } else if row == 0 {
                // First cell of a non-first sheet: cross-sheet reference
                let prev_sheet_name = format!("Sheet{}", si);
                cells.push(CellData {
                    cell_id: cell_uuid(si, row, 0),
                    row,
                    col: 0,
                    value: CellValue::Null,
                    formula: Some(format!("'{}'!A{}+1", prev_sheet_name, rows_per_sheet)),
                    identity_formula: None,
                    array_ref: None,
                });
            } else {
                // Within-sheet chain
                cells.push(CellData {
                    cell_id: cell_uuid(si, row, 0),
                    row,
                    col: 0,
                    value: CellValue::Null,
                    formula: Some(format!("A{}+1", row)), // 1-indexed
                    identity_formula: None,
                    array_ref: None,
                });
            }
        }

        sheets.push(SheetSnapshot {
            id: sheet_uuid(si),
            name: sheet_name,
            rows: rows_per_sheet,
            cols: 1,
            cells,
            ranges: vec![],
        });
    }

    WorkbookSnapshot {
        sheets,
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

fn find_cell_value(
    result: &compute_core::snapshot::RecalcResult,
    cell_id_str: &str,
) -> Option<CellValue> {
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == cell_id_str)
        .map(|cc| cc.value.clone())
}

// ===========================================================================
// Test 1: Linear chain of 1,000 cells
// ===========================================================================

#[test]
fn bench_linear_chain_1000() {
    let depth = 1_000u32;

    println!("\n=== Linear Chain Benchmark (depth={}) ===", depth);

    let t0 = Instant::now();
    let snapshot = snapshot_linear_chain(depth);
    let snapshot_ms = t0.elapsed().as_millis();
    println!("Snapshot build: {}ms", snapshot_ms);

    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let init_ms = t1.elapsed().as_millis();

    println!("ComputeCore init (parse + recalc): {}ms", init_ms);
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in result.errors.iter().take(5) {
        println!("    error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Verify: last cell should equal depth
    let last_cell_id = cell_uuid(0, depth - 1, 0);
    match find_cell_value(&result, &last_cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - depth as f64).abs() < 1e-6,
                "Last cell expected {}, got {}",
                depth,
                n.get()
            );
            println!("  last cell value: {} (correct)", n.get());
        }
        other => panic!("Last cell expected Number({}), got {:?}", depth, other),
    }

    let per_cell_us = (init_ms as f64 * 1000.0) / depth as f64;
    println!("  per-cell cost: {:.1}us", per_cell_us);
}

// ===========================================================================
// Test 2: Linear chain of 5,000 cells (target from plan)
// ===========================================================================

#[test]
fn bench_linear_chain_5000() {
    let depth = 5_000u32;

    println!("\n=== Linear Chain Benchmark (depth={}) ===", depth);

    let t0 = Instant::now();
    let snapshot = snapshot_linear_chain(depth);
    let snapshot_ms = t0.elapsed().as_millis();
    println!("Snapshot build: {}ms", snapshot_ms);

    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let init_ms = t1.elapsed().as_millis();

    println!("ComputeCore init (parse + recalc): {}ms", init_ms);
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in result.errors.iter().take(5) {
        println!("    error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Verify: last cell should equal depth
    let last_cell_id = cell_uuid(0, depth - 1, 0);
    match find_cell_value(&result, &last_cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - depth as f64).abs() < 1e-6,
                "Last cell expected {}, got {}",
                depth,
                n.get()
            );
            println!("  last cell value: {} (correct)", n.get());
        }
        other => panic!("Last cell expected Number({}), got {:?}", depth, other),
    }

    let per_cell_us = (init_ms as f64 * 1000.0) / depth as f64;
    println!("  per-cell cost: {:.1}us", per_cell_us);
    println!("  TARGET: < 5ms total (plan 02 completion criteria)");
}

// ===========================================================================
// Test 3: IFERROR-wrapped chain of 5,000 cells (real-world pattern)
// ===========================================================================

#[test]
fn bench_iferror_chain_5000() {
    let depth = 5_000u32;

    println!("\n=== IFERROR Chain Benchmark (depth={}) ===", depth);

    let t0 = Instant::now();
    let snapshot = snapshot_iferror_chain(depth);
    let snapshot_ms = t0.elapsed().as_millis();
    println!("Snapshot build: {}ms", snapshot_ms);

    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let init_ms = t1.elapsed().as_millis();

    println!("ComputeCore init (parse + recalc): {}ms", init_ms);
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in result.errors.iter().take(5) {
        println!("    error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Verify: last cell should equal depth
    let last_cell_id = cell_uuid(0, depth - 1, 0);
    match find_cell_value(&result, &last_cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - depth as f64).abs() < 1e-6,
                "Last cell expected {}, got {}",
                depth,
                n.get()
            );
            println!("  last cell value: {} (correct)", n.get());
        }
        other => panic!("Last cell expected Number({}), got {:?}", depth, other),
    }

    let per_cell_us = (init_ms as f64 * 1000.0) / depth as f64;
    println!("  per-cell cost: {:.1}us", per_cell_us);
}

// ===========================================================================
// Test 4: Cross-sheet chain (10 sheets × 500 rows = 5,000 depth)
// ===========================================================================

#[test]
fn bench_cross_sheet_chain_5000() {
    let num_sheets = 10u32;
    let rows_per_sheet = 500u32;
    let total_depth = num_sheets * rows_per_sheet;

    println!(
        "\n=== Cross-Sheet Chain Benchmark ({} sheets × {} rows = {} depth) ===",
        num_sheets, rows_per_sheet, total_depth
    );

    let t0 = Instant::now();
    let snapshot = snapshot_cross_sheet_chain(num_sheets, rows_per_sheet);
    let snapshot_ms = t0.elapsed().as_millis();
    println!("Snapshot build: {}ms", snapshot_ms);

    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let init_ms = t1.elapsed().as_millis();

    println!("ComputeCore init (parse + recalc): {}ms", init_ms);
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in result.errors.iter().take(5) {
        println!("    error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Verify: last cell on last sheet should equal total_depth
    let last_cell_id = cell_uuid(num_sheets - 1, rows_per_sheet - 1, 0);
    match find_cell_value(&result, &last_cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - total_depth as f64).abs() < 1e-6,
                "Last cell expected {}, got {}",
                total_depth,
                n.get()
            );
            println!("  last cell value: {} (correct)", n.get());
        }
        other => panic!(
            "Last cell expected Number({}), got {:?}",
            total_depth, other
        ),
    }

    let per_cell_us = (init_ms as f64 * 1000.0) / total_depth as f64;
    println!("  per-cell cost: {:.1}us", per_cell_us);
}

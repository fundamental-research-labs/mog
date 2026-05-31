//! Isolated benchmark for COUNTIFS/SUMIFS with full-column references.
//!
//! This reproduces the exact hot path found by formula-eval profiling:
//! 111K COUNTIFS formulas with full-column references ($A:$A) taking 21s.
//!
//! Run:
//!   cargo test -p compute-core --features perf-tests --release \
//!     --test bench_countifs -- --nocapture
//!
//! The test builds a synthetic workbook (no XLSX parsing, no Yrs overhead)
//! and times just the ComputeCore recalc — the exact bottleneck.

#![cfg(feature = "perf-tests")]

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use std::time::Instant;
use value_types::CellValue;

const SHEET_UUID: &str = "10000000-0000-0000-0000-000000000001";

fn data_cell_uuid(row: u32, col: u32) -> String {
    format!("20000000-0000-{:04x}-0000-{:012x}", col, row as u64)
}

fn formula_cell_uuid(row: u32, col: u32) -> String {
    format!("30000000-0000-{:04x}-0000-{:012x}", col, row as u64)
}

/// Build a synthetic workbook snapshot:
/// - `data_rows` rows of data across 5 columns (A-E, cols 0-4)
/// - `formula_count` COUNTIFS formulas in column F (col 5) with full-column refs
fn build_snapshot(data_rows: u32, formula_count: u32) -> WorkbookSnapshot {
    let mut cells = Vec::with_capacity(data_rows as usize * 5 + formula_count as usize);

    // Data columns:
    // Col 0 (A): Numbers 1..data_rows (like dates — for range comparisons)
    // Col 1 (B): Numbers 1..data_rows (second range criterion)
    // Col 2 (C): Categories "cat0".."cat19" (text match)
    // Col 3 (D): 0 or 1 alternating (numeric match)
    // Col 4 (E): Values to sum (row * 1.5)
    for row in 0..data_rows {
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 0),
            row,
            col: 0,
            value: CellValue::number(row as f64 + 1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 1),
            row,
            col: 1,
            value: CellValue::number(row as f64 + 1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 2),
            row,
            col: 2,
            value: CellValue::Text(format!("cat{}", row % 20).into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 3),
            row,
            col: 3,
            value: CellValue::number((row % 2) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 4),
            row,
            col: 4,
            value: CellValue::number(row as f64 * 1.5),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // Formula cells: COUNTIFS with 4 full-column criteria pairs.
    // Pattern: COUNTIFS(A:A,">="&<lo>,A:A,"<="&<hi>,C:C,"cat<n>",D:D,0)
    // Representative full-column workload with multiple criteria pairs.
    for i in 0..formula_count {
        let lo = (i as f64 / formula_count as f64 * data_rows as f64) as u32 + 1;
        let hi = lo + data_rows / 10; // ~10% window
        let cat = i % 20;

        let formula = format!("COUNTIFS(A:A,\">={lo}\",A:A,\"<={hi}\",C:C,\"cat{cat}\",D:D,0)");

        cells.push(CellData {
            cell_id: formula_cell_uuid(i, 5),
            row: data_rows + i, // Place formulas after data rows
            col: 5,
            value: CellValue::Null, // Will be computed
            formula: Some(formula),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Data".to_string(),
            rows: data_rows + formula_count,
            cols: 6,
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

#[test]
fn bench_countifs_full_column() {
    let data_rows = 50_000u32;
    let formula_count = 200u32;

    println!("\n=== COUNTIFS Full-Column Benchmark ===");
    println!(
        "Data: {} rows x 5 cols = {} cells",
        data_rows,
        data_rows * 5
    );
    println!(
        "Formulas: {} COUNTIFS with 4 full-column criteria each",
        formula_count
    );
    println!();

    // Build snapshot
    let t0 = Instant::now();
    let snapshot = build_snapshot(data_rows, formula_count);
    let snapshot_ms = t0.elapsed().as_millis();
    println!(
        "Snapshot build: {}ms ({} cells)",
        snapshot_ms,
        snapshot.sheets[0].cells.len()
    );

    // Init ComputeCore (parse + full recalc)
    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");
    let init_ms = t1.elapsed().as_millis();

    println!("ComputeCore init (parse + recalc): {}ms", init_ms);
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    if !result.errors.is_empty() {
        for e in result.errors.iter().take(5) {
            println!("    error: {}", e.error);
        }
    }

    // Per-formula cost
    let per_formula_us = (init_ms as f64 * 1000.0) / formula_count as f64;
    println!();
    println!("Per-formula cost: {:.0}us", per_formula_us);
    println!(
        "Projected for 111K formulas: {:.1}s",
        per_formula_us * 111_000.0 / 1_000_000.0
    );

    println!();
    println!("=== To iterate: edit get_range_values / COUNTIFS, rebuild, re-run ===");
    println!(
        "===   cargo test -p compute-core --features perf-tests --release --test bench_countifs -- --nocapture   ==="
    );
}

/// Smaller variant for quick sanity checks during development.
#[test]
fn bench_countifs_small() {
    let data_rows = 5_000u32;
    let formula_count = 50u32;

    let snapshot = build_snapshot(data_rows, formula_count);

    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let init_ms = t1.elapsed().as_millis();

    let per_formula_us = (init_ms as f64 * 1000.0) / formula_count as f64;
    println!(
        "\n[small] {}ms for {} formulas ({:.0}us/formula, {} data rows)",
        init_ms, formula_count, per_formula_us, data_rows
    );
    println!(
        "  changed: {}, errors: {}",
        result.changed_cells.len(),
        result.errors.len()
    );

    // Sanity: should have some changed cells (formulas computed)
    assert!(
        result.changed_cells.len() > 0,
        "Expected some computed formulas"
    );
}

/// SUMIFS variant — same pattern but with sum_range.
#[test]
fn bench_sumifs_full_column() {
    let data_rows = 50_000u32;
    let formula_count = 200u32;

    let mut cells = Vec::with_capacity(data_rows as usize * 5 + formula_count as usize);

    for row in 0..data_rows {
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 0),
            row,
            col: 0,
            value: CellValue::number(row as f64 + 1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 1),
            row,
            col: 1,
            value: CellValue::number(row as f64 + 1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 2),
            row,
            col: 2,
            value: CellValue::Text(format!("cat{}", row % 20).into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 3),
            row,
            col: 3,
            value: CellValue::number((row % 2) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: data_cell_uuid(row, 4),
            row,
            col: 4,
            value: CellValue::number(row as f64 * 1.5),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    for i in 0..formula_count {
        let lo = (i as f64 / formula_count as f64 * data_rows as f64) as u32 + 1;
        let hi = lo + data_rows / 10;
        let cat = i % 20;

        // SUMIFS(E:E,A:A,">={lo}",A:A,"<={hi}",C:C,"cat{cat}",D:D,0)
        let formula = format!("SUMIFS(E:E,A:A,\">={lo}\",A:A,\"<={hi}\",C:C,\"cat{cat}\",D:D,0)");

        cells.push(CellData {
            cell_id: formula_cell_uuid(i, 5),
            row: data_rows + i,
            col: 5,
            value: CellValue::Null,
            formula: Some(formula),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Data".to_string(),
            rows: data_rows + formula_count,
            cols: 6,
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
    };

    println!("\n=== SUMIFS Full-Column Benchmark ===");
    let t1 = Instant::now();
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let init_ms = t1.elapsed().as_millis();

    let per_formula_us = (init_ms as f64 * 1000.0) / formula_count as f64;
    println!(
        "{}ms for {} SUMIFS formulas ({:.0}us/formula, {} data rows)",
        init_ms, formula_count, per_formula_us, data_rows
    );
    println!(
        "  changed: {}, errors: {}",
        result.changed_cells.len(),
        result.errors.len()
    );
    if !result.errors.is_empty() {
        for e in result.errors.iter().take(5) {
            println!("    error: {}", e.error);
        }
    }
    println!(
        "Projected for 111K formulas: {:.1}s",
        per_formula_us * 111_000.0 / 1_000_000.0
    );
}

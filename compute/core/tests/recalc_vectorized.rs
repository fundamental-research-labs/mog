//! Integration tests for vectorized formula evaluation and chained vectorized columns.
//!
//! These tests verify correctness of columnar evaluation through the full ComputeCore pipeline.
//! The vectorized path activates for contiguous runs of 256+ cells sharing the same relative
//! formula pattern; below that threshold, the demand-driven path handles evaluation.
//! Either way, results must be correct.
//!
//! Run:
//!   cargo test -p compute-core --test recalc_vectorized -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

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
// Test 1: Simple multiply column (=A{row}*2 for 500 rows)
// ===========================================================================

#[test]
fn test_simple_multiply_column() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..500u32 {
        // Col A: numeric values 1.0 through 500.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: formula =A{row+1}*2
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*2", i + 1))));
    }
    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 500, 2, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_simple_multiply_column ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // B1 = A1*2 = 1*2 = 2.0
    assert_cell_number(&result, 0, 0, 1, 2.0);
    // B250 = A250*2 = 250*2 = 500.0
    assert_cell_number(&result, 0, 249, 1, 500.0);
    // B500 = A500*2 = 500*2 = 1000.0
    assert_cell_number(&result, 0, 499, 1, 1000.0);
}

// ===========================================================================
// Test 2: Add two columns (=A{row}+B{row} for 500 rows)
// ===========================================================================

#[test]
fn test_add_two_columns() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..500u32 {
        // Col A: values 1.0..500.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: values 1000.0..1499.0
        cells_data.push((i, 1, CellValue::number((i + 1000) as f64), None));
        // Col C: formula =A{row+1}+B{row+1}
        cells_data.push((
            i,
            2,
            CellValue::Null,
            Some(format!("A{}+B{}", i + 1, i + 1)),
        ));
    }
    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 500, 3, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_add_two_columns ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // C1 = A1+B1 = 1+1000 = 1001.0
    assert_cell_number(&result, 0, 0, 2, 1001.0);
    // C250 = A250+B250 = 250+1249 = 1499.0
    assert_cell_number(&result, 0, 249, 2, 1499.0);
    // C500 = A500+B500 = 500+1499 = 1999.0
    assert_cell_number(&result, 0, 499, 2, 1999.0);
}

// ===========================================================================
// Test 3: Chained columns (B=A*2, C=B+1 for 500 rows)
// ===========================================================================

#[test]
fn test_chained_columns() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..500u32 {
        // Col A: values 1.0..500.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: formula =A{row+1}*2
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*2", i + 1))));
        // Col C: formula =B{row+1}+1
        cells_data.push((i, 2, CellValue::Null, Some(format!("B{}+1", i + 1))));
    }
    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 500, 3, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_chained_columns ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // B100 = A100*2 = 100*2 = 200.0
    assert_cell_number(&result, 0, 99, 1, 200.0);
    // C100 = B100+1 = 200+1 = 201.0
    assert_cell_number(&result, 0, 99, 2, 201.0);
    // B500 = A500*2 = 500*2 = 1000.0
    assert_cell_number(&result, 0, 499, 1, 1000.0);
    // C500 = B500+1 = 1000+1 = 1001.0
    assert_cell_number(&result, 0, 499, 2, 1001.0);
}

// ===========================================================================
// Test 4: Chained with downstream SUM (B=A*2, D1=SUM(B1:B500))
// ===========================================================================

#[test]
fn test_chained_with_downstream_sum() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..500u32 {
        // Col A: values 1.0..500.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: formula =A{row+1}*2
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*2", i + 1))));
    }
    // D1 (row=0, col=3): =SUM(B1:B500)
    cells_data.push((0, 3, CellValue::Null, Some("SUM(B1:B500)".to_string())));

    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 500, 4, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_chained_with_downstream_sum ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // SUM(B1:B500) = 2*(1+2+...+500) = 2*125250 = 250500.0
    assert_cell_number(&result, 0, 0, 3, 250500.0);
}

// ===========================================================================
// Test 5: Mixed vectorizable and non-vectorizable formulas
// ===========================================================================

#[test]
fn test_mixed_vectorizable_and_non_vectorizable() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..300u32 {
        // Col A: values 1.0..300.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
    }
    // Col B rows 0-199: formula =A{row+1}*3 (vectorizable pattern)
    for i in 0..200u32 {
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*3", i + 1))));
    }
    // Col B row 200: formula =A201+100 (different pattern, breaks the group)
    cells_data.push((200, 1, CellValue::Null, Some("A201+100".to_string())));
    // Col B rows 201-299: formula =A{row+1}*3 (same pattern, separate group)
    for i in 201..300u32 {
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*3", i + 1))));
    }

    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 300, 2, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_mixed_vectorizable_and_non_vectorizable ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // B1 = A1*3 = 1*3 = 3.0
    assert_cell_number(&result, 0, 0, 1, 3.0);
    // B200 (row 199) = A200*3 = 200*3 = 600.0
    assert_cell_number(&result, 0, 199, 1, 600.0);
    // B201 (row 200) = A201+100 = 201+100 = 301.0
    assert_cell_number(&result, 0, 200, 1, 301.0);
    // B202 (row 201) = A202*3 = 202*3 = 606.0
    assert_cell_number(&result, 0, 201, 1, 606.0);
    // B300 (row 299) = A300*3 = 300*3 = 900.0
    assert_cell_number(&result, 0, 299, 1, 900.0);
}

// ===========================================================================
// Test 6: Negation column (=-A{row} for 300 rows)
// ===========================================================================

#[test]
fn test_negation_column() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..300u32 {
        // Col A: values 1.0..300.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: formula =-A{row+1}
        cells_data.push((i, 1, CellValue::Null, Some(format!("-A{}", i + 1))));
    }
    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 300, 2, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_negation_column ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // B1 = -A1 = -1.0
    assert_cell_number(&result, 0, 0, 1, -1.0);
    // B150 = -A150 = -150.0
    assert_cell_number(&result, 0, 149, 1, -150.0);
    // B300 = -A300 = -300.0
    assert_cell_number(&result, 0, 299, 1, -300.0);
}

// ===========================================================================
// Test 7: Constant multiply plus offset (=A{row}*10+5 for 300 rows)
// ===========================================================================

#[test]
fn test_constant_multiply_plus_offset() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..300u32 {
        // Col A: values 1.0..300.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: formula =A{row+1}*10+5
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*10+5", i + 1))));
    }
    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 300, 2, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_constant_multiply_plus_offset ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // B1 = A1*10+5 = 1*10+5 = 15.0
    assert_cell_number(&result, 0, 0, 1, 15.0);
    // B100 = A100*10+5 = 100*10+5 = 1005.0
    assert_cell_number(&result, 0, 99, 1, 1005.0);
    // B300 = A300*10+5 = 300*10+5 = 3005.0
    assert_cell_number(&result, 0, 299, 1, 3005.0);
}

// ===========================================================================
// Test 8: Large column correctness (1000 rows, verify all cells)
// ===========================================================================

#[test]
fn test_large_column_correctness() {
    let mut cells_data: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();
    for i in 0..1000u32 {
        // Col A: values 1.0..1000.0
        cells_data.push((i, 0, CellValue::number((i + 1) as f64), None));
        // Col B: formula =A{row+1}*2
        cells_data.push((i, 1, CellValue::Null, Some(format!("A{}*2", i + 1))));
    }
    let cells: Vec<(u32, u32, CellValue, Option<&str>)> = cells_data
        .iter()
        .map(|(r, c, v, f)| (*r, *c, v.clone(), f.as_deref()))
        .collect();

    let snapshot = build_snapshot(vec![("Sheet1", 1000, 2, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_large_column_correctness ===");
    println!("  changed_cells count: {}", result.changed_cells.len());
    println!("  errors count: {}", result.errors.len());

    // Verify ALL 1000 cells in column B
    for i in 0..1000u32 {
        let expected = ((i + 1) * 2) as f64;
        assert_cell_number(&result, 0, i, 1, expected);
    }
}

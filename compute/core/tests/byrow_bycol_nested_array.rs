//! Integration tests for the BYROW/BYCOL 1×1 array unwrap fix.
//!
//! BYROW and BYCOL must unwrap 1×1 array results from the lambda to scalars,
//! otherwise aggregate functions like MAX/SUM see nested sub-arrays and return 0.
//!
//! Run:
//!   cargo test -p compute-core --test byrow_bycol_nested_array -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers (same pattern as formula_accuracy_misc.rs)
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
// BYROW tests
// ===========================================================================

/// MAX(BYROW({1;2;3}, LAMBDA(x, x*10))) should return 30, not 0.
/// This was the primary bug: each lambda result was a 1×1 array, so MAX saw
/// nested arrays and returned 0.
#[test]
fn test_byrow_max_scalar_result() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1: =MAX(BYROW({1;2;3},LAMBDA(x,x*10)))
            (
                0,
                0,
                CellValue::Null,
                Some("MAX(BYROW({1;2;3},LAMBDA(x,x*10)))"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_cell_number(&result, 0, 0, 0, 30.0);
}

/// SUM(BYROW({1;2;3}, LAMBDA(x, x*10))) should return 60.
#[test]
fn test_byrow_sum_scalar_result() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("SUM(BYROW({1;2;3},LAMBDA(x,x*10)))"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_cell_number(&result, 0, 0, 0, 60.0);
}

/// SUM(BYROW({1;2;3}, LAMBDA(x, x))) should return 6 (identity unwrapped to scalars).
/// Before the fix, this returned 0 because each element was a 1×1 sub-array.
#[test]
fn test_byrow_identity_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("SUM(BYROW({1;2;3},LAMBDA(x,x)))"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_cell_number(&result, 0, 0, 0, 6.0);
}

// ===========================================================================
// BYCOL tests
// ===========================================================================

/// MAX(BYCOL({1,2,3}, LAMBDA(x, x*10))) should return 30, not 0.
#[test]
fn test_bycol_max_scalar_result() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("MAX(BYCOL({1,2,3},LAMBDA(x,x*10)))"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_cell_number(&result, 0, 0, 0, 30.0);
}

/// SUM(BYCOL({1,2,3}, LAMBDA(x, x*10))) should return 60.
#[test]
fn test_bycol_sum_scalar_result() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("SUM(BYCOL({1,2,3},LAMBDA(x,x*10)))"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_cell_number(&result, 0, 0, 0, 60.0);
}

/// BYROW with multi-column input: BYROW({1,2;3,4;5,6}, LAMBDA(x, SUM(x)))
/// Each row [1,2], [3,4], [5,6] should sum to 3, 7, 11.
/// MAX of that should be 11.
#[test]
fn test_byrow_multicolumn_sum() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("MAX(BYROW({1,2;3,4;5,6},LAMBDA(x,SUM(x))))"),
        )],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_cell_number(&result, 0, 0, 0, 11.0);
}

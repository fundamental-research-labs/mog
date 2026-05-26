//! Integration tests for dynamic array projection formulas and their interaction
//! with the ColumnCompletionTracker / DenseColumnCache.
//!
//! Run:
//!   cargo test -p compute-core --test recalc_projection -- --nocapture

mod control_range_store;
mod cse_array;
mod dynamic_array_reshaping;
mod sequence_spill;
mod transpose_multi_sheet;
mod transpose_spill;
mod xlsx_cascade_repro;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

pub fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

pub fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

pub fn build_snapshot(
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

/// Helper to build a snapshot that supports array_ref on cells.
/// Each cell is (row, col, value, formula, array_ref).
pub fn build_snapshot_with_array_ref(
    sheets: Vec<(
        &str,
        u32,
        u32,
        Vec<(u32, u32, CellValue, Option<&str>, Option<&str>)>,
    )>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula, arr_ref)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: arr_ref.map(|s| s.to_string()),
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

pub fn assert_mirror_number(mirror: &CellMirror, cell_id: &CellId, expected: f64, label: &str) {
    match mirror.get_cell_value(cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "{}: expected {}, got {}",
                label,
                expected,
                n.get()
            );
        }
        Some(other) => panic!("{}: expected Number({}), got {:?}", label, expected, other),
        None => panic!(
            "{}: cell not found in mirror (expected Number({}))",
            label, expected
        ),
    }
}

/// Assert a projected value via col_data (no phantom CellIds).
pub fn assert_col_data_number(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    expected: f64,
    label: &str,
) {
    let sheet_mirror = mirror
        .get_sheet(sheet_id)
        .unwrap_or_else(|| panic!("{}: sheet not found", label));
    let col_slice = sheet_mirror
        .get_column_slice(col)
        .unwrap_or_else(|| panic!("{}: col_data for column {} not found", label, col));
    match &col_slice[row as usize] {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "{}: expected {}, got {}",
                label,
                expected,
                n.get()
            );
        }
        other => panic!(
            "{}: expected Number({}) at ({},{}), got {:?}",
            label, expected, row, col, other
        ),
    }
}

/// Assert that col_data at (row, col) is Null or Number(0).
pub fn assert_col_data_null_or_zero(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    label: &str,
) {
    let sheet_mirror = mirror
        .get_sheet(sheet_id)
        .unwrap_or_else(|| panic!("{}: sheet not found", label));
    if let Some(col_slice) = sheet_mirror.get_column_slice(col) {
        // If row is beyond the col_data extent, it's implicitly Null — OK
        if (row as usize) >= col_slice.len() {
            return;
        }
        match &col_slice[row as usize] {
            CellValue::Null => {}                        // expected
            CellValue::Number(n) if n.get() == 0.0 => {} // also acceptable
            other => panic!(
                "{}: expected Null or 0 at ({},{}), got {:?}",
                label, row, col, other
            ),
        }
    }
    // If col_data doesn't exist for this column, it's implicitly null — OK
}

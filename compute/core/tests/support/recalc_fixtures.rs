use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

/// Deterministic UUID-like string from sheet index.
pub(crate) fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (sheet_idx, row, col).
pub(crate) fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a minimal `WorkbookSnapshot` from a description of sheets.
///
/// Each sheet description is `(name, rows, cols, cells)` where `cells` is a vec
/// of `(row, col, value, formula)`.
pub(crate) fn build_snapshot(
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

/// Build a snapshot with iterative calculation enabled.
pub(crate) fn build_iterative_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
    max_iterations: u32,
    max_change: f64,
) -> WorkbookSnapshot {
    let mut snap = build_snapshot(sheets);
    snap.iterative_calc = true;
    snap.max_iterations = max_iterations;
    snap.max_change = value_types::FiniteF64::must(max_change);
    snap
}

pub(crate) fn run_snapshot(snapshot: WorkbookSnapshot) -> RecalcResult {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed")
}

/// Find the evaluated value for a specific (sheet_index, row, col) in the result.
pub(crate) fn find_changed_value(
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

pub(crate) fn assert_cell_number(
    result: &RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
) {
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

pub(crate) fn assert_fixed_point_number_or_preserved(
    result: &RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
) {
    match find_changed_value(result, sheet_idx, row, col) {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - expected).abs() < 1e-6,
            "Cell ({},{},{}) expected ~{}, got {}",
            sheet_idx,
            row,
            col,
            expected,
            n.get()
        ),
        None => {}
        other => panic!(
            "Cell ({},{},{}) expected Number(~{}) or None, got {:?}",
            sheet_idx, row, col, expected, other
        ),
    }
}

pub(crate) fn has_circular_error(
    result: &RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> bool {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .errors
        .iter()
        .any(|e| e.cell_id == target_cell_id && e.error.contains("Circular"))
}

pub(crate) fn has_any_circular_error(result: &RecalcResult) -> bool {
    result.errors.iter().any(|e| e.error.contains("Circular"))
}

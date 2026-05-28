use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

/// Deterministic UUID-like string from sheet index.
pub fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (sheet_idx, row, col).
pub fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a minimal `WorkbookSnapshot` from a description of sheets.
/// Each sheet description is `(name, rows, cols, cells)` where `cells` is a vec
/// of `(row, col, value, formula)`.
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

pub fn recalc_snapshot(snapshot: WorkbookSnapshot) -> compute_core::RecalcResult {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed")
}

/// Find the evaluated value for a specific (sheet_index, row, col) in the RecalcResult.
pub fn find_changed_value(
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

pub fn print_recalc_diagnostics(label: &str, result: &compute_core::RecalcResult) {
    println!("\n=== {} ===", label);
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  ERROR cell_id={} error={}", e.cell_id, e.error);
    }
}

/// Assert that a cell evaluated to a specific text value.
pub fn assert_cell_text(
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
pub fn assert_cell_bool(
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
pub fn assert_cell_number(
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
pub fn assert_cell_error(
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

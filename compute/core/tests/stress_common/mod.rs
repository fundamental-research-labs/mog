//! Shared helpers for ComputeCore-level stress tests (Categories 1-10).
//!
//! **Engine cycle behavior:**
//!
//! 1. `init_from_snapshot` / `full_recalc` — non-iterative cycles preserve
//!    numeric cached values and materialize non-numeric cycle cells as
//!    `CellError::Circ`. Circular diagnostics are emitted in `result.errors`.
//!    `metrics.has_circular_refs=true`.
//!
//! 2. `set_cell` (incremental) — per-edge cycle detection. Cycle-creating cells get
//!    `CellError::Ref` and their deps are NOT registered.
//!
//! 3. `set_cells(skip_cycle_check=true)` / `apply_changes(skip_cycle_check=true)` —
//!    per-edge detection skipped. Cycles reach the non-iterative circular path
//!    unless workbook iterative calculation is enabled.

use cell_types::{CellId, SheetId, SheetPos};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// UUID generators
// ---------------------------------------------------------------------------

pub fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

pub fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

pub fn sid(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).unwrap()
}

pub fn cid(si: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap()
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

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
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub fn build_iterative_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
    max_iterations: u32,
    max_change: f64,
) -> WorkbookSnapshot {
    let mut snap = build_snapshot(sheets);
    snap.iterative_calc = true;
    snap.max_iterations = max_iterations;
    snap.max_change = FiniteF64::must(max_change);
    snap
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

pub fn set(
    core: &mut ComputeCore,
    mirror: &mut CellMirror,
    si: u32,
    row: u32,
    col: u32,
    input: &str,
) -> RecalcResult {
    core.set_cell(mirror, &sid(si), cid(si, row, col), row, col, input)
        .expect("set_cell failed")
}

pub fn make_edit(si: u32, row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellEdit {
    CellEdit {
        sheet_id: sheet_uuid(si),
        cell_id: cell_uuid(si, row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
    }
}

// ---------------------------------------------------------------------------
// RecalcResult queries
// ---------------------------------------------------------------------------

pub fn find_changed_value(
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

pub fn has_circular_error(result: &RecalcResult, si: u32, row: u32, col: u32) -> bool {
    let target_cell_id = cell_uuid(si, row, col);
    result
        .errors
        .iter()
        .any(|e| e.cell_id == target_cell_id && e.error.contains("Circular"))
}

pub fn has_any_circular_error(result: &RecalcResult) -> bool {
    result.errors.iter().any(|e| e.error.contains("Circular"))
}

// ---------------------------------------------------------------------------
// Mirror read helpers — extract values with panics for type mismatches
// ---------------------------------------------------------------------------

/// Read f64 from mirror. Panics if cell is not a Number.
pub fn read_mirror_number(mirror: &CellMirror, si: u32, row: u32, col: u32) -> f64 {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    match mirror.get_cell_value(&cell_id) {
        Some(CellValue::Number(n)) => n.get(),
        other => panic!(
            "Mirror ({},{},{}) expected Number, got {:?}",
            si, row, col, other
        ),
    }
}

/// Read CellValue from mirror. Returns None if cell doesn't exist.
pub fn read_mirror_value(mirror: &CellMirror, si: u32, row: u32, col: u32) -> Option<CellValue> {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    mirror.get_cell_value(&cell_id).cloned()
}

// ---------------------------------------------------------------------------
// Exact-value assertions — these are the ONLY assertions tests should use
// ---------------------------------------------------------------------------

/// Assert mirror cell == exact Number. Tolerance: 1e-6.
pub fn assert_mirror_number(mirror: &CellMirror, si: u32, row: u32, col: u32, expected: f64) {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    match mirror.get_cell_value(&cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Mirror ({},{},{}) expected {}, got {}",
                si,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Mirror ({},{},{}) expected Number({}), got {:?}",
            si, row, col, expected, other
        ),
        None => panic!(
            "Mirror ({},{},{}) not found (expected Number({}))",
            si, row, col, expected
        ),
    }
}

/// Assert mirror cell == Number within a specified tolerance.
pub fn assert_mirror_number_tol(
    mirror: &CellMirror,
    si: u32,
    row: u32,
    col: u32,
    expected: f64,
    tol: f64,
) {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    match mirror.get_cell_value(&cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < tol,
                "Mirror ({},{},{}) expected {} ±{}, got {}",
                si,
                row,
                col,
                expected,
                tol,
                n.get()
            );
        }
        Some(other) => panic!(
            "Mirror ({},{},{}) expected Number({}), got {:?}",
            si, row, col, expected, other
        ),
        None => panic!(
            "Mirror ({},{},{}) not found (expected Number({}))",
            si, row, col, expected
        ),
    }
}

/// Assert mirror cell == specific CellError variant.
pub fn assert_mirror_error(mirror: &CellMirror, si: u32, row: u32, col: u32, expected: CellError) {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    match mirror.get_cell_value(&cell_id) {
        Some(CellValue::Error(err, _)) => assert_eq!(
            *err, expected,
            "Mirror ({},{},{}) expected {:?}, got {:?}",
            si, row, col, expected, err
        ),
        other => panic!(
            "Mirror ({},{},{}) expected Error({:?}), got {:?}",
            si, row, col, expected, other
        ),
    }
}

/// Assert mirror cell is Null (empty).
pub fn assert_mirror_null(mirror: &CellMirror, si: u32, row: u32, col: u32) {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    match mirror.get_cell_value(&cell_id) {
        Some(CellValue::Null) | None => {} // OK
        Some(other) => panic!(
            "Mirror ({},{},{}) expected Null, got {:?}",
            si, row, col, other
        ),
    }
}

// ---------------------------------------------------------------------------
// Position-based assertions — for spill targets (projected values in col_data)
// ---------------------------------------------------------------------------

/// Assert a projected/spill-target value by sheet position. Uses
/// `get_cell_value_at` which checks col_data (where materialized projection
/// values live) rather than requiring a registered CellId.
pub fn assert_pos_number(mirror: &CellMirror, si: u32, row: u32, col: u32, expected: f64) {
    let sheet_id = sid(si);
    match mirror.get_cell_value_at(&sheet_id, SheetPos::new(row, col)) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Pos ({},{},{}) expected {}, got {}",
                si,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Pos ({},{},{}) expected Number({}), got {:?}",
            si, row, col, expected, other
        ),
        None => panic!(
            "Pos ({},{},{}) not found (expected Number({}))",
            si, row, col, expected
        ),
    }
}

/// Assert a projected value by position within a specified tolerance.
pub fn assert_pos_number_tol(
    mirror: &CellMirror,
    si: u32,
    row: u32,
    col: u32,
    expected: f64,
    tol: f64,
) {
    let sheet_id = sid(si);
    match mirror.get_cell_value_at(&sheet_id, SheetPos::new(row, col)) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < tol,
                "Pos ({},{},{}) expected {} ±{}, got {}",
                si,
                row,
                col,
                expected,
                tol,
                n.get()
            );
        }
        Some(other) => panic!(
            "Pos ({},{},{}) expected Number({}), got {:?}",
            si, row, col, expected, other
        ),
        None => panic!(
            "Pos ({},{},{}) not found (expected Number({}))",
            si, row, col, expected
        ),
    }
}

/// Assert a position is Null (empty) — for cleared spill targets.
pub fn assert_pos_null(mirror: &CellMirror, si: u32, row: u32, col: u32) {
    let sheet_id = sid(si);
    match mirror.get_cell_value_at(&sheet_id, SheetPos::new(row, col)) {
        Some(CellValue::Null) | None => {} // OK
        Some(other) => panic!(
            "Pos ({},{},{}) expected Null, got {:?}",
            si, row, col, other
        ),
    }
}

/// Assert mirror cell is Text with exact content.
pub fn assert_mirror_text(mirror: &CellMirror, si: u32, row: u32, col: u32, expected: &str) {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    match mirror.get_cell_value(&cell_id) {
        Some(CellValue::Text(t)) => assert_eq!(
            &**t, expected,
            "Mirror ({},{},{}) expected text {:?}, got {:?}",
            si, row, col, expected, t
        ),
        other => panic!(
            "Mirror ({},{},{}) expected Text({:?}), got {:?}",
            si, row, col, expected, other
        ),
    }
}

/// Check if mirror cell is #REF! error (incremental cycle detection).
pub fn is_ref_error(mirror: &CellMirror, si: u32, row: u32, col: u32) -> bool {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    matches!(
        mirror.get_cell_value(&cell_id),
        Some(CellValue::Error(CellError::Ref, _))
    )
}

/// Assert that a cell is any Error variant.
pub fn assert_mirror_is_any_error(mirror: &CellMirror, si: u32, row: u32, col: u32) {
    let cell_id = CellId::from_uuid_str(&cell_uuid(si, row, col)).unwrap();
    let val = mirror.get_cell_value(&cell_id);
    assert!(
        matches!(val, Some(CellValue::Error(_, _))),
        "Mirror ({},{},{}) expected Error, got {:?}",
        si,
        row,
        col,
        val
    );
}

/// Assert RecalcResult cell == exact Number. Tolerance: 1e-6.
pub fn assert_result_number(result: &RecalcResult, si: u32, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, si, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Result ({},{},{}) expected {}, got {}",
                si,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Result ({},{},{}) expected Number({}), got {:?}",
            si, row, col, expected, other
        ),
        None => panic!(
            "Result ({},{},{}) not in changed_cells (expected Number({}))",
            si, row, col, expected
        ),
    }
}

/// Assert self-consistency for a divergent cycle cell.
/// For a cycle loaded with iterative calculation enabled, the solver produces
/// Numbers. We verify the formula relationship approximately holds (within `slack`).
/// E.g. if A1's formula is "=B1+1", verify that A1 ≈ B1+1.
pub fn assert_cycle_self_consistent(
    mirror: &CellMirror,
    si: u32,
    // (row, col) of the cell to check
    row: u32,
    col: u32,
    // Expected value as a function of other mirror values
    expected_fn: impl FnOnce() -> f64,
    slack: f64,
    context: &str,
) {
    let actual = read_mirror_number(mirror, si, row, col);
    let expected = expected_fn();
    assert!(
        (actual - expected).abs() < slack,
        "{}: ({},{},{}) expected ≈{} (slack={}), got {}",
        context,
        si,
        row,
        col,
        expected,
        slack,
        actual
    );
}

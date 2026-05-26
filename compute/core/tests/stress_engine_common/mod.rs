//! Shared helpers for YrsComputeEngine-level stress tests (Categories 11-16).

use cell_types::SheetPos;
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const SHEET1_UUID: &str = "a0000000000000000000000000000001";
pub const SHEET2_UUID: &str = "a0000000000000000000000000000002";

// ---------------------------------------------------------------------------
// UUID generators
// ---------------------------------------------------------------------------

pub fn cell_uuid(row: u32, col: u32) -> String {
    format!("c0000000{:04x}{:04x}0000000000000000", row, col)
}

pub fn cell_uuid_sheet2(row: u32, col: u32) -> String {
    format!("c1000000{:04x}{:04x}0000000000000000", row, col)
}

// ---------------------------------------------------------------------------
// Cell/snapshot builders
// ---------------------------------------------------------------------------

pub fn make_cell(row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

pub fn make_cell_s2(row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellData {
    CellData {
        cell_id: cell_uuid_sheet2(row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

pub fn num(v: f64) -> CellValue {
    CellValue::number(v)
}

pub fn make_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 1000,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

pub fn make_snapshot_large(rows: u32, cols: u32, cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows,
            cols,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

pub fn make_two_sheet_snapshot(cells1: Vec<CellData>, cells2: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 1000,
                cols: 26,
                cells: cells1,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Sheet2".to_string(),
                rows: 1000,
                cols: 26,
                cells: cells2,
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

pub fn make_iterative_snapshot(
    cells: Vec<CellData>,
    max_iter: u32,
    max_change: f64,
) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 1000,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        iterative_calc: true,
        max_iterations: max_iter,
        max_change: value_types::FiniteF64::must(max_change),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Operation builders
// ---------------------------------------------------------------------------

pub fn fill_request(
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    tgt_start_row: u32,
    tgt_start_col: u32,
    tgt_end_row: u32,
    tgt_end_col: u32,
    direction: &str,
) -> BridgeAutoFillRequest {
    BridgeAutoFillRequest {
        source_range: BridgeFillRangeSpec {
            start_row: src_start_row,
            start_col: src_start_col,
            end_row: src_end_row,
            end_col: src_end_col,
        },
        target_range: BridgeFillRangeSpec {
            start_row: tgt_start_row,
            start_col: tgt_start_col,
            end_row: tgt_end_row,
            end_col: tgt_end_col,
        },
        direction: direction.to_string(),
        mode: "auto".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: true,
        step_value: 1.0,
    }
}

pub fn sort_asc(col: u32) -> BridgeSortOptions {
    BridgeSortOptions {
        criteria: vec![BridgeSortCriterion {
            column: col,
            direction: SortOrder::Asc,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    }
}

pub fn sort_desc(col: u32) -> BridgeSortOptions {
    BridgeSortOptions {
        criteria: vec![BridgeSortCriterion {
            column: col,
            direction: SortOrder::Desc,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    }
}

// ---------------------------------------------------------------------------
// Value read helpers
// ---------------------------------------------------------------------------

/// Read f64 from engine mirror. Panics if not Number.
pub fn read_num(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
) -> f64 {
    match engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
    {
        Some(CellValue::Number(n)) => n.get(),
        other => panic!("Cell ({},{}) expected Number, got {:?}", row, col, other),
    }
}

/// Read cell value, returning None for empty.
pub fn read_value(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
}

/// Check if recalc errors contain circular diagnostic.
pub fn has_circular(result: &RecalcResult) -> bool {
    result.errors.iter().any(|e| e.error.contains("Circular"))
}

// ---------------------------------------------------------------------------
// Exact-value assertions
// ---------------------------------------------------------------------------

/// Assert cell == exact f64. Tolerance: 1e-6.
pub fn assert_num(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
    expected: f64,
) {
    let actual = read_num(engine, sheet_id, row, col);
    assert!(
        (actual - expected).abs() < 1e-6,
        "Cell ({},{}) expected {}, got {}",
        row,
        col,
        expected,
        actual
    );
}

/// Assert cell == f64 within tolerance.
pub fn assert_num_tol(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
    expected: f64,
    tol: f64,
) {
    let actual = read_num(engine, sheet_id, row, col);
    assert!(
        (actual - expected).abs() < tol,
        "Cell ({},{}) expected {} ±{}, got {}",
        row,
        col,
        expected,
        tol,
        actual
    );
}

/// Assert cell is a specific CellError.
pub fn assert_error(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
    expected: CellError,
) {
    match engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
    {
        Some(CellValue::Error(e, _)) => assert_eq!(
            *e, expected,
            "Cell ({},{}) expected {:?}, got {:?}",
            row, col, expected, e
        ),
        other => panic!(
            "Cell ({},{}) expected Error({:?}), got {:?}",
            row, col, expected, other
        ),
    }
}

/// Assert cell is Null (empty / cleared).
pub fn assert_null(engine: &YrsComputeEngine, sheet_id: &cell_types::SheetId, row: u32, col: u32) {
    match engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
    {
        Some(CellValue::Null) | None => {}
        Some(other) => panic!("Cell ({},{}) expected Null, got {:?}", row, col, other),
    }
}

/// Assert cell is Text with exact content.
pub fn assert_text(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
    expected: &str,
) {
    match engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
    {
        Some(CellValue::Text(t)) => assert_eq!(
            &**t, expected,
            "Cell ({},{}) expected text {:?}, got {:?}",
            row, col, expected, t
        ),
        other => panic!(
            "Cell ({},{}) expected Text({:?}), got {:?}",
            row, col, expected, other
        ),
    }
}

/// Assert cell is any Error (when we care it's an error but not which kind).
pub fn assert_is_error(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
) {
    match engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
    {
        Some(CellValue::Error(_, _)) => {}
        other => panic!(
            "Cell ({},{}) expected some Error, got {:?}",
            row, col, other
        ),
    }
}

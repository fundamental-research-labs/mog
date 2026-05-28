//! Shared mirror test fixtures.

use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, FiniteF64};

use super::cell_mirror::CellMirror;
use super::types::{CellEntry, SheetMirror};

/// Construct a fresh `CellMirror` containing a single sheet sized
/// `rows × cols`. The sheet's `SheetId` is deterministic (`from_raw(1)`)
/// and its name is `"Sheet1"` — both irrelevant to the tests themselves
/// but stable so failures reproduce.
pub(crate) fn fresh_mirror_with_sheet(rows: u32, cols: u32) -> (CellMirror, SheetId) {
    let sheet_id = SheetId::from_raw(1);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), rows, cols);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
    (mirror, sheet_id)
}

pub(crate) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(crate) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

pub(crate) fn simple_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(42.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Hello".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(100.0)),
                    formula: Some("=A1*2+16".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

/// Build a mirror with one sheet and a few cells for structural tests.
pub(crate) fn mirror_with_grid() -> (CellMirror, SheetId) {
    let sheet_id = make_sheet_id(1);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Grid".to_string(), 10, 5);
    mirror.add_sheet_mirror(sheet_id, "Grid".to_string(), sheet_mirror);

    // Insert a 3x3 grid of cells: rows 0-2, cols 0-2
    // cell_id = row * 10 + col + 100 (arbitrary)
    for row in 0..3u32 {
        for col in 0..3u32 {
            let cell_id = make_cell_id((row * 10 + col + 100) as u128);
            let entry = CellEntry {
                value: CellValue::Number(FiniteF64::must((row * 10 + col) as f64)),
                formula: None,
            };
            mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(row, col), entry);
        }
    }

    (mirror, sheet_id)
}

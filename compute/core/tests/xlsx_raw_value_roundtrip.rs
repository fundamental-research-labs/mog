//! XLSX hydration test for `get_raw_value`.
//!
//! Target: `compute/core/src/storage/cells/values.rs:1199` — the code path
//! where `get_raw_value` walks `cellGrid` to find the CellId, then reads the
//! formula off `cells[cell_hex]`. On the XLSX hydration path the legacy
//! `cellGrid` sub-map is intentionally absent, so the function falls through
//! to `mirror_display_value` and returns the cached *display* value instead
//! of the formula text.
//!
//! This is a unit-level test — no export round-trip needed.

use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn one_sheet_snapshot(name: &str, rows: u32, cols: u32, cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: name.to_string(),
            rows,
            cols,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(uuid_suffix: u32, row: u32, col: u32, formula: &str, cached: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(cached)),
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn xlsx_bytes_for(snapshot: WorkbookSnapshot) -> Vec<u8> {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes")
}

#[test]
fn xlsx_hydrated_formula_cell_raw_value_returns_formula_text() {
    // A1=2, B1=3, C1 = =A1+B1 (cached 5).
    let bytes = xlsx_bytes_for(one_sheet_snapshot(
        "Raw",
        5,
        5,
        vec![
            value_cell(1, 0, 0, 2.0),
            value_cell(2, 0, 1, 3.0),
            formula_cell(3, 0, 2, "=A1+B1", 5.0),
        ],
    ));

    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    let raw = engine.get_raw_value(&sid, 0, 2);
    assert_eq!(
        raw, "=A1+B1",
        "get_raw_value on XLSX-hydrated formula cell must return the formula text, not the display value; got {:?}",
        raw
    );
}

#[test]
fn xlsx_hydrated_value_cell_raw_value_returns_value_string() {
    // Sanity: non-formula path still works on the XLSX hydration route.
    let bytes = xlsx_bytes_for(one_sheet_snapshot(
        "RawValue",
        5,
        5,
        vec![value_cell(1, 0, 0, 42.0)],
    ));

    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    let raw = engine.get_raw_value(&sid, 0, 0);
    assert_eq!(raw, "42", "raw value for A1=42; got {:?}", raw);
}

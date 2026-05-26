//! Regression tests for `ws.clear()` dropping formulas on the exported XLSX
//! when the workbook was hydrated from an .xlsx file.
//!
//! Bug: `cell_iter::clear_range` resolved cells via the legacy yrs `cellGrid`
//! sub-map. The XLSX hydration path intentionally leaves that map unset
//! (see `storage/infra/hydration/sheet.rs:148` — `grid_indexes` is the
//! authority for XLSX-imported sheets). The early return meant the yrs
//! `cells` map was never updated; the export path then re-read the untouched
//! formula from `cells` and re-emitted it, so the saved .xlsx still carried
//! every formula the user thought `ws.clear()` had removed.
//!
//! Each test round-trips through `from_xlsx_bytes` on purpose.
//! `from_snapshot` populates `cellGrid` and masks the bug.

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

/// Build bytes for an XLSX that routes through the XLSX hydration path on reload.
/// `from_snapshot` populates `cellGrid`, so we materialize to bytes first and
/// re-parse via `from_xlsx_bytes` in the test body.
fn xlsx_bytes_for(snapshot: WorkbookSnapshot) -> Vec<u8> {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes")
}

#[test]
fn xlsx_clear_range_by_position_removes_formula_on_export() {
    // A1=1, B1=2, A2==A1+B1 (cached 3).
    let bytes = xlsx_bytes_for(one_sheet_snapshot(
        "ClearScalar",
        10,
        5,
        vec![
            value_cell(1, 0, 0, 1.0),
            value_cell(2, 0, 1, 2.0),
            formula_cell(3, 1, 0, "=A1+B1", 3.0),
        ],
    ));

    // Reload via XLSX path — `cellGrid` sub-map is never created.
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Clear A2 (the formula cell) — the user-reported ws.clear() path.
    engine
        .clear_range_by_position(sid, 1, 0, 1, 0)
        .expect("clear_range_by_position");

    // Export and re-parse: the formula must be gone from the saved file.
    let out = engine.export_to_xlsx_bytes().expect("export after clear");
    let parsed = xlsx_api::parse(&out).expect("re-parse cleared XLSX");

    let sheet = &parsed.output.sheets[0];
    let a2 = sheet.cells.iter().find(|c| c.row == 1 && c.col == 0);

    match a2 {
        None => {}
        Some(c) => {
            assert!(
                c.formula.is_none(),
                "A2 formula must be cleared by ws.clear(); still have {:?}",
                c.formula
            );
            assert!(
                matches!(c.value, CellValue::Null)
                    || matches!(&c.value, CellValue::Text(s) if s.is_empty()),
                "A2 value must be empty after clear; got {:?}",
                c.value
            );
        }
    }
}

#[test]
fn xlsx_clear_range_bulk_removes_all_formulas() {
    // Seed A1=10 then N formula cells in column B that all reference A1.
    // Mirrors the agent-driven 3900-formula reproduction at smaller scale.
    const N: u32 = 50;
    let mut cells = vec![value_cell(1, 0, 0, 10.0)];
    for i in 0..N {
        cells.push(formula_cell(100 + i, i, 1, "=A1", 10.0));
    }
    let bytes = xlsx_bytes_for(one_sheet_snapshot("BulkClear", N + 10, 5, cells));

    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Single range clear over the whole column — the user-visible ws.clear() shape.
    engine
        .clear_range_by_position(sid, 0, 1, N - 1, 1)
        .expect("bulk clear");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after bulk clear");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let surviving: Vec<(u32, u32, Option<String>)> = sheet
        .cells
        .iter()
        .filter(|c| c.col == 1 && c.formula.is_some())
        .map(|c| (c.row, c.col, c.formula.clone()))
        .collect();

    assert!(
        surviving.is_empty(),
        "{} of {} formulas survived range clear; first few = {:?}",
        surviving.len(),
        N,
        surviving.iter().take(3).collect::<Vec<_>>()
    );
}

#[test]
fn xlsx_clear_range_contents_only_removes_formula_on_export() {
    // `clear_range` dispatches through EngineMutation::ClearRange →
    // mutation_clear_range → cell_iter::clear_range_contents_only, which has
    // the same cellGrid early-return bug as clear_range.
    let bytes = xlsx_bytes_for(one_sheet_snapshot(
        "ClearContents",
        5,
        5,
        vec![value_cell(1, 0, 0, 7.0), formula_cell(2, 0, 1, "=A1", 7.0)],
    ));

    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine.clear_range(&sid, 0, 1, 0, 1).expect("clear_range");

    let out = engine.export_to_xlsx_bytes().expect("export after clear");
    let parsed = xlsx_api::parse(&out).expect("re-parse");

    let b1 = parsed.output.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 1);

    match b1 {
        None => {}
        Some(c) => {
            assert!(
                c.formula.is_none(),
                "B1 formula must be cleared by clear_range (contents-only); still have {:?}",
                c.formula
            );
        }
    }
}

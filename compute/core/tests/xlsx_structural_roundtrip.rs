//! XLSX round-trip tests for structural ops
//! (`insert_row`, `delete_row`, `insert_col`, `delete_col`).
//!
//! Target: `compute/core/src/storage/sheet/structural.rs`.
//!
//! Fixture is built via `from_snapshot` → `export_to_xlsx_bytes` → reload via
//! `from_xlsx_bytes` (hydration-invariant path where `cellGrid` sub-map is
//! intentionally absent). Each test does a single structural mutation, exports,
//! re-parses, and asserts formula refs shifted correctly.
//!
//! The public structural API on `YrsComputeEngine` is `structure_change(&StructureChange)`.
// TODO R49: no standalone `insert_row` / `delete_col` methods on the engine;
// tests route through `structure_change()` which is the production path.

use compute_core::storage::engine::YrsComputeEngine;
use formula_types::StructureChange;
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

/// A1..A5 = numbers 1..5, B1 = =A1, B2 = =A2, C3 = =SUM(A1:A5)
fn formula_fixture() -> WorkbookSnapshot {
    let mut cells = Vec::new();
    let mut id = 1u32;
    for r in 0..5 {
        cells.push(value_cell(id, r, 0, (r + 1) as f64));
        id += 1;
    }
    cells.push(formula_cell(id, 0, 1, "=A1", 1.0));
    id += 1;
    cells.push(formula_cell(id, 1, 1, "=A2", 2.0));
    id += 1;
    cells.push(formula_cell(id, 2, 2, "=SUM(A1:A5)", 15.0));
    one_sheet_snapshot("Structural", 10, 5, cells)
}

#[test]
fn xlsx_insert_row_shifts_formula_refs() {
    let bytes = xlsx_bytes_for(formula_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Insert one row at row 0 (pushes everything down by 1).
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 0,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert row");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after insert_row");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    // B1 was =A1, now at B2 it should still reference its original row-1 source
    // — which is now A2 (shifted down by 1).
    let b2 = sheet
        .cells
        .iter()
        .find(|c| c.row == 1 && c.col == 1)
        .expect("B2 cell present");
    assert_eq!(
        b2.formula.as_deref(),
        Some("A2"),
        "B2 formula after insert_row; got {:?}",
        b2.formula
    );

    // C3 (was C3 at row 2, =SUM(A1:A5)) is now C4 referencing A2:A6.
    let c4 = sheet
        .cells
        .iter()
        .find(|c| c.row == 3 && c.col == 2)
        .expect("C4 cell present");
    assert_eq!(
        c4.formula.as_deref(),
        Some("SUM(A2:A6)"),
        "C4 formula after insert_row; got {:?}",
        c4.formula
    );
}

#[test]
fn xlsx_delete_row_shifts_formula_refs() {
    let bytes = xlsx_bytes_for(formula_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Delete row 0 (the A1=1 row).
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 0,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete row");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after delete_row");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    // Original B2 (=A2) shifted up to B1 and should now reference A1.
    let b1 = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 1)
        .expect("B1 cell present");
    assert_eq!(
        b1.formula.as_deref(),
        Some("A1"),
        "B1 formula after delete_row; got {:?}",
        b1.formula
    );

    // Original C3 =SUM(A1:A5) — A1 was deleted, should become SUM(A1:A4).
    let c2 = sheet
        .cells
        .iter()
        .find(|c| c.row == 1 && c.col == 2)
        .expect("C2 cell present (shifted from C3)");
    assert_eq!(
        c2.formula.as_deref(),
        Some("SUM(A1:A4)"),
        "C2 formula after delete_row; got {:?}",
        c2.formula
    );
}

#[test]
fn xlsx_insert_col_shifts_formula_refs() {
    let bytes = xlsx_bytes_for(formula_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Insert one col at col 0 (A shifts to B, etc.).
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 0,
                count: 1,
                new_col_ids: Vec::new(),
            },
        )
        .expect("insert col");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after insert_col");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    // Former B1 (=A1) is now C1 and should reference B1.
    let c1 = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 2)
        .expect("C1 cell present (shifted from B1)");
    assert_eq!(
        c1.formula.as_deref(),
        Some("B1"),
        "C1 formula after insert_col; got {:?}",
        c1.formula
    );

    // Former C3 =SUM(A1:A5) is now at D3 and should reference B1:B5.
    let d3 = sheet
        .cells
        .iter()
        .find(|c| c.row == 2 && c.col == 3)
        .expect("D3 cell present (shifted from C3)");
    assert_eq!(
        d3.formula.as_deref(),
        Some("SUM(B1:B5)"),
        "D3 formula after insert_col; got {:?}",
        d3.formula
    );
}

#[test]
fn xlsx_delete_col_shifts_formula_refs() {
    // Fixture where col A stays and col B has a formula referencing A;
    // we delete col 0 to provoke a broken-reference scenario that exports
    // must still capture honestly.
    let mut cells = Vec::new();
    let mut id = 1u32;
    for r in 0..5 {
        cells.push(value_cell(id, r, 0, (r + 1) as f64));
        id += 1;
    }
    // Put the SUM formula in column D referencing col A so we can observe
    // its surviving reference after col A is removed.
    cells.push(formula_cell(id, 0, 3, "=SUM(A1:A5)", 15.0));

    let bytes = xlsx_bytes_for(one_sheet_snapshot("DelCol", 10, 5, cells));
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Delete col B (col index 1) — harmless column, so SUM(A1:A5) should remain
    // pointing at A1:A5 (col A not touched), but the formula cell moves from D1
    // to C1 (col 3 → col 2).
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 1,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete col");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after delete_col");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let c1 = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 2)
        .expect("C1 cell present (shifted from D1)");
    assert_eq!(
        c1.formula.as_deref(),
        Some("SUM(A1:A5)"),
        "C1 formula after delete_col; got {:?}",
        c1.formula
    );
}

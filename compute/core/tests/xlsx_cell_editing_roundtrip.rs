//! XLSX round-trip tests for cell editing
//! (`set_cell_value`, `set_cell_formula`).
//!
//! Target: `compute/core/src/storage/engine/services/cell_editing.rs` and
//! `compute/core/src/storage/cells/data_ops.rs`.
//!
//! Fixture materializes via `from_snapshot` → `export_to_xlsx_bytes` then
//! reloads via `from_xlsx_bytes`. Each edit flows through the production
//! API path (`set_cell_value_parsed`), which is what UI cell editors dispatch.

// TODO R49: no separate `set_cell_formula` public API — `set_cell_value_parsed`
// handles both `=formula` and bare values, which is the production path.

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

fn xlsx_bytes_for(snapshot: WorkbookSnapshot) -> Vec<u8> {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes")
}

fn two_value_fixture() -> WorkbookSnapshot {
    // A1=1, B1=2 — room to add new cells and formulas at C1, D1.
    one_sheet_snapshot(
        "Edit",
        5,
        5,
        vec![value_cell(1, 0, 0, 1.0), value_cell(2, 0, 1, 2.0)],
    )
}

#[test]
fn xlsx_set_cell_value_writes_through_to_export() {
    let bytes = xlsx_bytes_for(two_value_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .set_cell_value_parsed(&sid, 0, 2, "42")
        .expect("set_cell_value_parsed");

    let out = engine.export_to_xlsx_bytes().expect("export after set");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let c1 = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 2)
        .expect("C1 present after set_cell_value");
    assert!(
        matches!(c1.value, CellValue::Number(n) if n.get() == 42.0),
        "C1 value; got {:?}",
        c1.value
    );
}

#[test]
fn xlsx_set_cell_formula_writes_through_to_export() {
    let bytes = xlsx_bytes_for(two_value_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // set_cell_value_parsed treats a "=..." prefix as a formula.
    engine
        .set_cell_value_parsed(&sid, 0, 2, "=A1+B1")
        .expect("set_cell_value_parsed formula");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after set_formula");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let c1 = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 2)
        .expect("C1 present after set_cell_formula");
    assert_eq!(
        c1.formula.as_deref(),
        Some("A1+B1"),
        "C1 formula; got {:?}",
        c1.formula
    );
}

#[test]
fn xlsx_overwrite_existing_cell_replaces_value() {
    // Replace an existing XLSX-hydrated cell's value and verify the old value
    // doesn't leak through on export.
    let bytes = xlsx_bytes_for(two_value_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .set_cell_value_parsed(&sid, 0, 0, "999")
        .expect("overwrite A1");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after overwrite");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let a1 = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("A1 present");
    assert!(
        matches!(a1.value, CellValue::Number(n) if n.get() == 999.0),
        "A1 was not overwritten; got {:?}",
        a1.value
    );
}

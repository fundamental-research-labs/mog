//! XLSX round-trip tests for range operations:
//! `set_range` (bulk set by position), `copy_range`, and `move_range`.
//!
//! Target: `compute/core/src/storage/engine/services/mutation_handlers/range_operations.rs`.
//!
//! Fixture materializes via `from_snapshot` → `export_to_xlsx_bytes` then
//! reloads via `from_xlsx_bytes`. Each mutation is exported and re-parsed.

// TODO R49: no public `move_range` on the engine; `relocate_cells` is the
// closest production equivalent and is what UI move flows dispatch through.
// TODO R49: no public `set_range` on the engine; `set_cell_values_parsed`
// is the batch-set production path used by Ctrl-Enter, paste, and fill.

use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::copy::CopyType;
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

fn basic_fixture() -> WorkbookSnapshot {
    // A1=1, B1=2, C1 = =A1+B1 (cached 3), then some blank region to write into.
    one_sheet_snapshot(
        "Range",
        10,
        5,
        vec![
            value_cell(1, 0, 0, 1.0),
            value_cell(2, 0, 1, 2.0),
            formula_cell(3, 0, 2, "=A1+B1", 3.0),
        ],
    )
}

#[test]
fn xlsx_set_range_writes_multiple_cells() {
    let bytes = xlsx_bytes_for(basic_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Simulate set_range via the production batch-set path.
    let updates = vec![
        (4u32, 0u32, "100".to_string()),
        (4, 1, "200".to_string()),
        (4, 2, "=A5+B5".to_string()),
    ];
    engine
        .set_cell_values_parsed(&sid, updates)
        .expect("set_cell_values_parsed");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after set_range");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let a5 = sheet
        .cells
        .iter()
        .find(|c| c.row == 4 && c.col == 0)
        .expect("A5 present");
    assert!(
        matches!(a5.value, CellValue::Number(n) if n.get() == 100.0),
        "A5 value; got {:?}",
        a5.value
    );
    let c5 = sheet
        .cells
        .iter()
        .find(|c| c.row == 4 && c.col == 2)
        .expect("C5 present");
    assert_eq!(
        c5.formula.as_deref(),
        Some("A5+B5"),
        "C5 formula; got {:?}",
        c5.formula
    );
}

#[test]
fn xlsx_copy_range_duplicates_formulas_with_ref_shift() {
    let bytes = xlsx_bytes_for(basic_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Copy A1:C1 → A3 (so row 0 contents land on row 2).
    engine
        .copy_range(&sid, 0, 0, 0, 2, &sid, 2, 0, CopyType::All, false, false)
        .expect("copy_range");

    let out = engine.export_to_xlsx_bytes().expect("export after copy");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let a3 = sheet
        .cells
        .iter()
        .find(|c| c.row == 2 && c.col == 0)
        .expect("A3 present");
    assert!(
        matches!(a3.value, CellValue::Number(n) if n.get() == 1.0),
        "A3 copied from A1=1; got {:?}",
        a3.value
    );

    // C1 = =A1+B1 copied to C3 should become =A3+B3 (A1-style refs shift
    // relative to the copy delta).
    let c3 = sheet
        .cells
        .iter()
        .find(|c| c.row == 2 && c.col == 2)
        .expect("C3 present");
    assert_eq!(
        c3.formula.as_deref(),
        Some("A3+B3"),
        "C3 formula after copy; got {:?}",
        c3.formula
    );
}

#[test]
fn xlsx_move_range_relocates_values() {
    // `relocate_cells` is a value-only move (clears source, writes display
    // values to the target). Formulas are not preserved, per its doc comment.
    let bytes = xlsx_bytes_for(basic_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Move A1:B1 → A5:B5.
    engine
        .relocate_cells(&sid, 0, 0, 0, 1, 4, 0)
        .expect("relocate_cells");

    let out = engine.export_to_xlsx_bytes().expect("export after move");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    let a5 = sheet.cells.iter().find(|c| c.row == 4 && c.col == 0);
    assert!(a5.is_some(), "A5 must exist after move (source was A1=1)");

    // Source A1 should now be empty/cleared.
    let a1 = sheet.cells.iter().find(|c| c.row == 0 && c.col == 0);
    if let Some(c) = a1 {
        assert!(
            matches!(c.value, CellValue::Null)
                || matches!(&c.value, CellValue::Text(s) if s.is_empty())
                || matches!(c.value, CellValue::Number(n) if n.get() == 0.0 && c.formula.is_none()),
            "A1 should be cleared after move; got value={:?} formula={:?}",
            c.value,
            c.formula
        );
    }
}

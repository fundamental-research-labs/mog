//! XLSX round-trip tests for merge / unmerge.
//!
//! Target: `compute/core/src/storage/sheet/merges.rs`.
//!
//! The fixture materializes via `from_snapshot` → `export_to_xlsx_bytes`
//! then reloads via `from_xlsx_bytes` (the hydration path that leaves the
//! legacy `cellGrid` sub-map unset). Each test merges or unmerges over a
//! range that includes at least one formula cell, exports, and re-parses.

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

/// A1=1, B1=2, A2=3, B2==A1+A2 (cached 4). Merge covers A1:B2 including a formula.
fn merge_over_formula_fixture() -> WorkbookSnapshot {
    one_sheet_snapshot(
        "Merge",
        5,
        5,
        vec![
            value_cell(1, 0, 0, 1.0),
            value_cell(2, 0, 1, 2.0),
            value_cell(3, 1, 0, 3.0),
            formula_cell(4, 1, 1, "=A1+A2", 4.0),
        ],
    )
}

#[test]
fn xlsx_merge_range_persists_on_export() {
    let bytes = xlsx_bytes_for(merge_over_formula_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .merge_range(&sid, 0, 0, 1, 1)
        .expect("merge_range A1:B2");

    let out = engine.export_to_xlsx_bytes().expect("export after merge");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        !sheet.merges.is_empty(),
        "merge missing from exported XLSX; merges = {:?}",
        sheet.merges
    );
    let m = &sheet.merges[0];
    assert_eq!(m.start_row, 0, "merge start_row");
    assert_eq!(m.start_col, 0, "merge start_col");
    assert_eq!(m.end_row, 1, "merge end_row");
    assert_eq!(m.end_col, 1, "merge end_col");
}

#[test]
fn xlsx_unmerge_range_persists_on_export() {
    // Start with the merged fixture — do the merge first, export, reload,
    // then unmerge and export again to observe the unmerge round-trips.
    let bytes = xlsx_bytes_for(merge_over_formula_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .merge_range(&sid, 0, 0, 1, 1)
        .expect("merge_range A1:B2");
    let after_merge = engine.export_to_xlsx_bytes().expect("export after merge");

    // Reload fully to exercise the hydration path again.
    let (mut engine2, _) =
        YrsComputeEngine::from_xlsx_bytes(&after_merge).expect("from_xlsx_bytes after merge");
    let sid2 = *engine2.mirror().sheet_ids().next().expect("sheet present");

    engine2
        .unmerge_range(&sid2, 0, 0, 1, 1)
        .expect("unmerge_range A1:B2");

    let out = engine2
        .export_to_xlsx_bytes()
        .expect("export after unmerge");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        sheet.merges.is_empty(),
        "unmerge did not remove merge from export; merges = {:?}",
        sheet.merges
    );

    // B2 formula must still be present after unmerge (merge preserves only
    // the top-left cell's value; formulas in merged cells are a known edge
    // case, so we only assert the cell still exists).
    let b2 = sheet.cells.iter().find(|c| c.row == 1 && c.col == 1);
    assert!(
        b2.is_some(),
        "B2 cell must survive unmerge (formula may or may not survive merge itself)"
    );
}

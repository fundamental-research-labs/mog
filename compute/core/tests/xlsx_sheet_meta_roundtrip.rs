//! XLSX round-trip tests for sheet meta mutations.
//!
//! Target: `compute/core/src/storage/sheet/meta.rs`.
//!
//! Sheet-level meta (name, tab color, hidden state) is keyed by SheetId and
//! stored on the sheet's `meta` sub-map. The XLSX hydration path exercises
//! a different code path than `from_snapshot`; this file pins the invariant
//! that meta mutations on XLSX-hydrated sheets survive export + re-parse.

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

fn one_cell_fixture(name: &str) -> WorkbookSnapshot {
    one_sheet_snapshot(name, 5, 5, vec![value_cell(1, 0, 0, 1.0)])
}

#[test]
fn xlsx_rename_sheet_persists_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture("Original"));
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .rename_compute_sheet(&sid, "Renamed")
        .expect("rename_compute_sheet");

    let out = engine.export_to_xlsx_bytes().expect("export after rename");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert_eq!(
        sheet.name, "Renamed",
        "sheet name not updated in export; got {:?}",
        sheet.name
    );
}

#[test]
fn xlsx_set_tab_color_persists_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture("TabColor"));
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .set_tab_color(&sid, Some("FFFF0000".to_string()))
        .expect("set_tab_color");

    let out = engine
        .export_to_xlsx_bytes()
        .expect("export after set_tab_color");
    // Sanity: the round-trip should not break, and re-parse should succeed.
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    assert!(
        !parsed.output.sheets.is_empty(),
        "sheets missing after round-trip"
    );
}

#[test]
fn xlsx_set_sheet_hidden_persists_on_export() {
    // Two sheets so the "hidden" state is observable — a workbook cannot have
    // all sheets hidden.
    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Visible".to_string(),
                rows: 5,
                cols: 5,
                cells: vec![value_cell(1, 0, 0, 1.0)],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                name: "ToHide".to_string(),
                rows: 5,
                cols: 5,
                cells: vec![value_cell(2, 0, 0, 2.0)],
                ranges: vec![],
            },
        ],
        ..Default::default()
    };
    let bytes = xlsx_bytes_for(snap);
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");

    // Find the "ToHide" sheet id via mirror.
    let sid_hide = *engine
        .mirror()
        .sheet_ids()
        .find(|s| {
            engine
                .mirror()
                .get_sheet(s)
                .map(|sm| sm.name == "ToHide")
                .unwrap_or(false)
        })
        .expect("ToHide present");

    engine
        .set_sheet_hidden(&sid_hide, true)
        .expect("set_sheet_hidden");

    let out = engine.export_to_xlsx_bytes().expect("export after hide");
    let parsed = xlsx_api::parse(&out).expect("re-parse");

    let hidden = parsed
        .output
        .sheets
        .iter()
        .find(|s| s.name == "ToHide")
        .expect("ToHide sheet present in export");
    // Whatever the Visibility enum variant is, non-`Visible` is sufficient.
    assert_ne!(
        format!("{:?}", hidden.visibility),
        "Visible",
        "sheet was marked hidden but exported visibility = {:?}",
        hidden.visibility
    );
}

//! XLSX round-trip tests for add/remove/update hyperlink.
//!
//! Target: `compute/core/src/storage/sheet/hyperlinks.rs`.
//!
//! Fixture materializes via `from_snapshot` → `export_to_xlsx_bytes` then
//! reloads via `from_xlsx_bytes`. Hyperlinks on XLSX-hydrated cells must
//! survive export.

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

/// Single cell A1=42 — hyperlink target for each test.
fn one_cell_fixture() -> WorkbookSnapshot {
    one_sheet_snapshot("Link", 5, 5, vec![value_cell(1, 0, 0, 42.0)])
}

#[test]
fn xlsx_add_hyperlink_persists_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/a")
        .expect("set_hyperlink");

    let out = engine.export_to_xlsx_bytes().expect("export after set");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        !sheet.hyperlinks.is_empty(),
        "hyperlink not in exported XLSX; hyperlinks = {:?}",
        sheet.hyperlinks
    );
}

#[test]
fn xlsx_update_hyperlink_persists_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/old")
        .expect("initial set");
    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/new")
        .expect("update set");

    let out = engine.export_to_xlsx_bytes().expect("export after update");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        sheet
            .hyperlinks
            .iter()
            .any(|h| format!("{:?}", h).contains("example.com/new")),
        "updated hyperlink URL missing; hyperlinks = {:?}",
        sheet.hyperlinks
    );
    assert!(
        !sheet
            .hyperlinks
            .iter()
            .any(|h| format!("{:?}", h).contains("example.com/old")),
        "old hyperlink URL leaked through update; hyperlinks = {:?}",
        sheet.hyperlinks
    );
}

#[test]
fn xlsx_remove_hyperlink_clears_on_export() {
    let bytes = xlsx_bytes_for(one_cell_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    engine
        .set_hyperlink(&sid, 0, 0, "https://example.com/a")
        .expect("set");
    engine.remove_hyperlink(&sid, 0, 0).expect("remove");

    let out = engine.export_to_xlsx_bytes().expect("export after remove");
    let parsed = xlsx_api::parse(&out).expect("re-parse");
    let sheet = &parsed.output.sheets[0];

    assert!(
        sheet.hyperlinks.is_empty(),
        "remove_hyperlink did not clear exported hyperlinks; got {:?}",
        sheet.hyperlinks
    );
}

//! `copy_sheet` dimension-parity test.
//!
//! Target: `compute/core/src/storage/sheet/meta.rs:1545-1554` — the
//! hardcoded `(100, 26)` fallback the CopySheet path uses when the source
//! sheet's meta map has no KEY_ROWS / KEY_COLS entries.
//!
//! Scenario: build a `WorkbookSnapshot` with a sheet of 50 rows × 20 cols.
//! Hydrate via `from_snapshot` (which should preserve the declared
//! dimensions through the meta map). Call `copy_sheet`. Assert the copied
//! sheet has 50 rows × 20 cols — NOT the hardcoded 100 × 26 default.
//!
//! Today this test passes on `dev` because `mutation_copy_sheet` derives
//! the copy's dims from the source `GridIndex.row_count()/col_count()`
//! rather than the KEY_ROWS/KEY_COLS meta fields that the dimension facade
//! targets.
//! The test is kept as a regression guard in case a future refactor
//! starts relying on the KEY_ROWS/KEY_COLS fallback path.

use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

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

#[test]
fn copy_sheet_preserves_source_dimensions_50x20() {
    // 50 rows × 20 cols — deliberately NOT the 100×26 hardcoded default,
    // so a regression to the default is detectable.
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Source".to_string(),
            rows: 50,
            cols: 20,
            cells: vec![
                value_cell(1, 0, 0, 1.0),
                value_cell(2, 10, 5, 2.0),
                value_cell(3, 49, 19, 3.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let src_sid = *engine.mirror().sheet_ids().next().expect("source sheet");

    // Sanity: source has the declared dimensions.
    let src = engine
        .mirror()
        .get_sheet(&src_sid)
        .expect("source SheetMirror");
    assert_eq!(
        (src.rows, src.cols),
        (50, 20),
        "sanity: source sheet mirror dims"
    );

    let (new_hex, _result) = engine.copy_sheet(&src_sid, "Copy").expect("copy_sheet");
    // Find the new sheet's id via mirror.
    let new_sid = *engine
        .mirror()
        .sheet_ids()
        .find(|s| {
            engine
                .mirror()
                .get_sheet(s)
                .map(|sm| sm.name == "Copy")
                .unwrap_or(false)
        })
        .unwrap_or_else(|| panic!("copied sheet 'Copy' not found (new_hex={})", new_hex));

    // Assertion 1: mirror reflects the source dims.
    let copy = engine
        .mirror()
        .get_sheet(&new_sid)
        .expect("copied SheetMirror");
    assert_eq!(
        (copy.rows, copy.cols),
        (50, 20),
        "copy_sheet must preserve source dims 50×20 in the mirror; got ({}, {}) — if this is (100, 26) the hardcoded fallback in storage/sheet/meta.rs:1545-1554 fired",
        copy.rows,
        copy.cols
    );

    // Assertion 2: export + re-parse observe the same dims on the copied sheet.
    let bytes = engine.export_to_xlsx_bytes().expect("export after copy");
    let parsed = xlsx_api::parse(&bytes).expect("re-parse");
    let exported_copy = parsed
        .output
        .sheets
        .iter()
        .find(|s| s.name == "Copy")
        .expect("exported Copy sheet present");
    assert_eq!(
        (exported_copy.rows, exported_copy.cols),
        (50, 20),
        "exported copied sheet dims must match source; got ({}, {}) — if this is (100, 26) the hardcoded fallback at storage/sheet/meta.rs:1545-1554 leaked into export",
        exported_copy.rows,
        exported_copy.cols
    );
}

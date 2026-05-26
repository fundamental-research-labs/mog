//! Regression tests for named-range A1 display.
//!
//! Named ranges are workbook-scoped: when their `IdentityFormula` is
//! decompiled back to a display string for the formula bar / Name Manager
//! the output must always be sheet-qualified (e.g. `Sheet1!A1:A5`) because
//! there is no implicit sheet context.
//!
//! Bug history: `kernel/src/domain/formulas/named-ranges.ts::getRefersToA1`
//! used to call the sheet-scope `to_a1_display` bridge with a synthetic nil
//! `SheetId` to coax the decompiler into emitting a qualified prefix. The
//! sheet-scope bridge guard validated that the provided sheet exists in
//! the workbook, rejected the nil id, and serialized `()` instead of a
//! `String` — surfaced in TS as `invalid type: unit value, expected a
//! string`. The fix exposes the existing `to_a1_display_qualified` as a
//! workbook-scope bridge command so callers no longer need the nil-sheet
//! hack; this test guards that the qualified path keeps producing the
//! expected output.
//!
//! Run:
//!   cargo test -p compute-core --test named_range_display -- --nocapture

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

const SHEET_UUID: &str = "00000000000000000000000000000001";

fn cell_uuid(row: u32, col: u32) -> String {
    format!("000000000000000000000000{:04x}{:04x}", row, col)
}

fn make_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn make_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                make_cell(0, 0, CellValue::number(10.0)),
                make_cell(1, 0, CellValue::number(20.0)),
                make_cell(2, 0, CellValue::number(30.0)),
                make_cell(3, 0, CellValue::number(40.0)),
                make_cell(4, 0, CellValue::number(50.0)),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// `to_a1_display_qualified` always emits a sheet-qualified A1 string,
/// even when the supplied sheet matches the formula's home sheet (the
/// case where the sheet-scope `to_a1_display` would strip the prefix).
#[test]
fn qualified_display_keeps_sheet_prefix_when_context_matches() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(make_snapshot()).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let identity = engine
        .to_identity_formula(&sheet_id, "Sheet1!A1:A5")
        .expect("parse Sheet1!A1:A5");

    // Plain to_a1_display strips the prefix because the call's sheet
    // matches the formula's home sheet. (The decompiler prepends `=`
    // unconditionally — the kernel callers strip or keep it as needed.)
    let plain = engine.to_a1_display(&sheet_id, &identity);
    assert_eq!(
        plain, "=A1:A5",
        "sanity: to_a1_display drops the sheet prefix when sheet context matches"
    );

    // Qualified variant must keep the sheet prefix even when the same
    // sheet is passed as context — that's the whole point.
    let qualified = engine.to_a1_display_qualified(&sheet_id, &identity);
    assert_eq!(
        qualified, "=Sheet1!A1:A5",
        "to_a1_display_qualified must always emit sheet-qualified output"
    );
}

/// Named-range display path (workbook scope) must work when the caller has
/// no real sheet context. Before the fix, this required a nil `SheetId` to
/// coax the decompiler into qualifying — and the sheet-scope bridge guard
/// rejected the nil id outright. The qualified API tolerates an arbitrary
/// sheet id (including nil) because the output never depends on it
/// existing in the workbook.
#[test]
fn qualified_display_with_nil_sheet_context_is_qualified() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(make_snapshot()).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    let identity = engine
        .to_identity_formula(&sheet_id, "Sheet1!A1:A5")
        .expect("parse Sheet1!A1:A5");

    // Nil sheet id: not a real sheet in the workbook, but `to_a1_display_qualified`
    // does not require one. This is the production path used by named-range
    // display (`getRefersToA1` in kernel/src/domain/formulas/named-ranges.ts).
    let nil_sheet = SheetId::from_raw(0);
    let qualified = engine.to_a1_display_qualified(&nil_sheet, &identity);
    assert_eq!(
        qualified, "=Sheet1!A1:A5",
        "qualified display must succeed and remain qualified with a nil sheet context"
    );
}

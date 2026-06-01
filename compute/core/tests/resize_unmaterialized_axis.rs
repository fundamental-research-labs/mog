//! Regression: resizing a column/row whose physical index lies beyond the
//! sheet's materialized axis-identity extent must succeed (auto-grow), not
//! fail with a (misleading) `SheetNotFound`.
//!
//! Root cause this pins: `set_col_width` / `set_row_height` resolve the
//! physical index to a stable RowId/ColId via the `GridIndex` axis store and,
//! when no identity exists for that index, historically returned
//! `ComputeError::SheetNotFound` — even though the sheet is present and renders
//! fine. Cell writes already auto-grow the axis via
//! `SheetDimensionsMut::ensure_capacity`; the dimension write path did not.
//!
//! Repro shape mirrors the field report (debug recording
//! "SheetNotFoundColumnResizeIssue"): viewport/read calls on the sheet all
//! succeed, only the resize write throws.

use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const SHEET_ID: &str = "550e8400-e29b-41d4-a716-446655440000";

/// A tiny sheet: 3x3 materialized extent, content only near the origin.
/// Columns/rows past index 2 have no materialized axis identity.
fn small_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_ID.to_string(),
            name: "Resize".to_string(),
            rows: 3,
            cols: 3,
            cells: vec![CellData {
                cell_id: "a0000000-0000-0000-0000-000000000001".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(1.0)),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn sheet_id(engine: &YrsComputeEngine) -> cell_types::SheetId {
    *engine.mirror().sheet_ids().next().expect("sheet present")
}

#[test]
fn set_col_width_beyond_materialized_extent_succeeds() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(small_snapshot()).expect("from_snapshot");
    let sid = sheet_id(&engine);

    // Column 8 is well past the 3-column materialized extent.
    let target_col = 8u32;
    let width_px = 188.0;

    let res = engine.set_col_width(&sid, target_col, width_px);
    assert!(
        res.is_ok(),
        "resizing a column beyond the materialized extent must succeed, got {:?}",
        res.err()
    );

    // The new width must be readable back (auto-grow persisted the identity).
    let got = engine.get_col_width_query(&sid, target_col);
    assert!(
        (got - width_px).abs() < 1.0,
        "expected col {target_col} width ~{width_px}px after resize, got {got}px"
    );
}

#[test]
fn set_row_height_beyond_materialized_extent_succeeds() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(small_snapshot()).expect("from_snapshot");
    let sid = sheet_id(&engine);

    let target_row = 8u32;
    let height_px = 94.5;

    let res = engine.set_row_height(&sid, target_row, height_px);
    assert!(
        res.is_ok(),
        "resizing a row beyond the materialized extent must succeed, got {:?}",
        res.err()
    );
}

#[test]
fn set_col_widths_batch_beyond_extent_succeeds() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(small_snapshot()).expect("from_snapshot");
    let sid = sheet_id(&engine);

    // Mix in-extent (col 1) and out-of-extent (col 7) targets in one batch.
    let writes = [(1u32, 137.0f64), (7u32, 211.0f64)];
    let res = engine.set_col_widths(&sid, &writes);
    assert!(
        res.is_ok(),
        "batch resize spanning the materialized extent must succeed, got {:?}",
        res.err()
    );

    let got = engine.get_col_width_query(&sid, 7);
    assert!(
        (got - 211.0).abs() < 1.0,
        "expected col 7 width ~211px after batch resize, got {got}px"
    );
}

/// The auto-grown width must survive a serialize → reload round-trip, i.e. the
/// axis identity is persisted in Yrs (not just in the in-memory GridIndex).
#[test]
fn auto_grown_col_width_persists_across_reload() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(small_snapshot()).expect("from_snapshot");
    let sid = sheet_id(&engine);

    engine
        .set_col_width(&sid, 8, 188.0)
        .expect("resize must succeed");

    let bytes = engine.export_to_xlsx_bytes().expect("export xlsx");
    let (reloaded, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("reload xlsx");
    let rsid = sheet_id(&reloaded);

    let got = reloaded.get_col_width_query(&rsid, 8);
    assert!(
        (got - 188.0).abs() < 2.0,
        "col 8 width must persist across reload, got {got}px"
    );
}

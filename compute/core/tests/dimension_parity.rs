//! Dimension parity between `from_snapshot` and
//! `from_xlsx_bytes`.
//!
//! Target: any reader of KEY_ROWS / KEY_COLS (`storage/sheet/meta.rs`,
//! `storage/infra/hydration/*`).
//!
//! Build two logically-equivalent workbooks — one via `from_snapshot`, one
//! via `from_xlsx_bytes` (by materializing the snapshot → XLSX → reload) —
//! and assert both engines report identical row/col counts for the sheet.
//!
//! If the XLSX hydration path derives dims from a different source than the
//! snapshot path, this test surfaces that divergence as a concrete failure.

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

fn snapshot_30x15() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "DimTest".to_string(),
            rows: 30,
            cols: 15,
            cells: vec![
                value_cell(1, 0, 0, 1.0),
                value_cell(2, 5, 3, 2.0),
                value_cell(3, 29, 14, 3.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn sheet_dims(engine: &YrsComputeEngine) -> (u32, u32) {
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");
    let sm = engine.mirror().get_sheet(&sid).expect("SheetMirror");
    (sm.rows, sm.cols)
}

#[test]
fn dimensions_match_across_snapshot_and_xlsx_hydration() {
    // Path 1: snapshot hydration.
    let (engine_snap, _) =
        YrsComputeEngine::from_snapshot(snapshot_30x15()).expect("from_snapshot");
    let dims_snap = sheet_dims(&engine_snap);

    // Path 2: snapshot → xlsx bytes → xlsx hydration.
    let bytes = engine_snap
        .export_to_xlsx_bytes()
        .expect("export to xlsx bytes");
    let (engine_xlsx, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let dims_xlsx = sheet_dims(&engine_xlsx);

    assert_eq!(
        dims_snap, dims_xlsx,
        "sheet dimensions must be identical across from_snapshot and from_xlsx_bytes; \
         from_snapshot → {:?}, from_xlsx_bytes → {:?}",
        dims_snap, dims_xlsx
    );
}

#[test]
fn dimensions_match_source_declared_30x15() {
    // Stronger: the dims from both paths must also match what the source
    // snapshot declared (30 rows × 15 cols). XLSX writers sometimes pad or
    // compact — this pins the expectation.
    let (engine_snap, _) =
        YrsComputeEngine::from_snapshot(snapshot_30x15()).expect("from_snapshot");
    assert_eq!(
        sheet_dims(&engine_snap),
        (30, 15),
        "from_snapshot dims must match declared 30x15"
    );

    let bytes = engine_snap
        .export_to_xlsx_bytes()
        .expect("export to xlsx bytes");
    let (engine_xlsx, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    assert_eq!(
        sheet_dims(&engine_xlsx),
        (30, 15),
        "from_xlsx_bytes dims must match declared 30x15 after round-trip"
    );
}

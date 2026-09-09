//! Used-range queries include native merge footprints even on blank sheets.

use super::super::*;
use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
use domain_types::CellFormat;

const SHEET_UUID: &str = "aa111111111111111111111111111001";

fn empty_snapshot() -> WorkbookSnapshot {
    // Empty sheet: no pre-populated cells, so the native value store is empty and step 2
    // of `get_data_bounds` (sheet-extent expansion) is skipped — letting us
    // observe the contribution of merges in isolation.
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

// -------------------------------------------------------------------
// Test 1: Bounds include merge footprint (originator path).
// -------------------------------------------------------------------

/// On a fresh sheet with no cell writes, applying a merge A1:B2 must cause
/// `get_data_bounds` to return A1:B2. Before the fix this already held on
/// the originator (by accident — `merge_range` allocates corner CellIds which
/// trips `expand_extent`). We keep the assertion so the behaviour is
/// anchored regardless of whether the originator keeps allocating those
/// placeholder corners.
#[test]
fn test_get_data_bounds_includes_merge_footprint() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();

    // Precondition: empty sheet has no bounds.
    assert!(
        engine.get_data_bounds(&sid).is_none(),
        "fresh empty sheet should report no data bounds",
    );

    // Merge A1:B2.
    engine.merge_range(&sid, 0, 0, 1, 1).expect("merge_range");

    let bounds = engine
        .get_data_bounds(&sid)
        .expect("merge alone must establish bounds");
    assert_eq!(bounds.min_row, 0, "min_row should be 0 (row A)");
    assert_eq!(bounds.min_col, 0, "min_col should be 0 (col A)");
    assert_eq!(bounds.max_row, 1, "max_row should be 1 (row 2)");
    assert_eq!(bounds.max_col, 1, "max_col should be 1 (col B)");
}

#[test]
fn absent_far_clear_does_not_grow_empty_sheet() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();

    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);
    assert!(engine.get_data_bounds(&sid).is_none());

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                99_999,
                9_999,
                crate::storage::engine::mutation::CellInput::Clear,
            )],
            true,
        )
        .unwrap();

    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);
    assert!(engine.get_cell_id_at(&sid, 99_999, 9_999).is_none());
    assert!(engine.get_data_bounds(&sid).is_none());
}

#[test]
fn clearing_far_written_footprint_shrinks_bounds_to_empty() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine
        .set_cell_value_parsed(&sid, 0, 0, "anchor")
        .expect("write A1");
    engine
        .set_cell_value_parsed(&sid, 0, 2, "=ZZ2")
        .expect("write C1 formula");
    engine
        .set_cell_value_parsed(&sid, 0, 2, "formula overwritten")
        .expect("overwrite C1 formula");
    engine
        .set_cell_value_parsed(&sid, 20, 701, "temporary far value")
        .expect("write ZZ21");

    let bounds = engine.get_data_bounds(&sid).expect("bounds before clear");
    assert_eq!(bounds.min_row, 0);
    assert_eq!(bounds.min_col, 0);
    assert_eq!(bounds.max_row, 20);
    assert_eq!(bounds.max_col, 701);

    engine
        .clear_range_by_position(sid, 0, 0, 20, 701)
        .expect("clear used footprint");

    assert!(
        engine.get_data_bounds(&sid).is_none(),
        "cleared null-only dense storage must not keep stale used bounds",
    );
}

#[test]
fn format_only_cells_do_not_establish_data_bounds() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    engine
        .set_format_for_ranges(&sid, &[(0, 16_383, 0, 16_383)], &format)
        .expect("format XFD1");

    assert!(
        engine.get_data_bounds(&sid).is_none(),
        "formatting XFD1 alone must not make the sheet's used/data range reach XFD",
    );
}

#[test]
fn format_only_cells_do_not_expand_existing_data_bounds() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_snapshot()).unwrap();
    let sid = test_sheet_id();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    engine
        .set_cell_value_parsed(&sid, 144, 108, "last data cell")
        .expect("write DE145");
    engine
        .set_format_for_ranges(&sid, &[(144, 16_383, 144, 16_383)], &format)
        .expect("format XFD145");

    let bounds = engine
        .get_data_bounds(&sid)
        .expect("real data should establish bounds");
    assert_eq!(bounds.min_row, 144);
    assert_eq!(bounds.min_col, 108);
    assert_eq!(bounds.max_row, 144);
    assert_eq!(
        bounds.max_col, 108,
        "format-only XFD145 must not expand data bounds beyond DE145",
    );

    let explicit_format_cell = engine.query_range(&sid, 144, 16_383, 144, 16_383);
    assert_eq!(
        explicit_format_cell.cells.len(),
        1,
        "explicit range queries should still expose the format-only cell",
    );
}

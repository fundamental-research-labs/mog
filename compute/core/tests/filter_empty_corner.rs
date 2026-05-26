//! Regression test for the filter "empty corner" bug.
//!
//! Symptom (FIX-001 / FIX-007 working note):
//!   `setAutoFilter(A1:C100)` on a column with text headers in row 1 and
//!   numeric data only in column A would silently hide nothing when a
//!   subsequent column filter was applied. Root cause: the kernel asked
//!   Rust `create_filter` to record the bottom-right corner (row 99, col
//!   2). The grid had no cell at that position, so the lookup returned
//!   `None` and the engine stored `data_end_cell_id == ""`. Downstream,
//!   `evaluate_filter` couldn't resolve the "" reference and bailed out
//!   with an empty result set — every row stayed visible.
//!
//! Fix: `services::create_filter` calls `ensure_cell_id` (allocating a
//! CellId at the corner if one doesn't exist) instead of falling back
//! silently to "". This test pins the contract:
//!
//!   1. After `create_filter` with empty corners, all three corner
//!      reference fields (`header_start_cell_id`, `header_end_cell_id`,
//!      `data_end_cell_id`) are non-empty 32-char hex IDs.
//!
//!   2. After applying a column-values filter, the rows whose values are
//!      not in the allow-list end up hidden — i.e. `evaluate_filter`
//!      actually visits the data range.
//!
//! Run:
//!   cargo test -p compute-core --test filter_empty_corner

use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::YrsComputeEngine;
use serde_json::json;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn text_cell(id_suffix: u32, row: u32, col: u32, t: &str) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Text(t.to_string().into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// Sheet shaped like a typical filter target:
///   - row 0 is a 3-column header (cols 0..=2)
///   - rows 1..=4 have data in column 0 only (col 0 = numbers 10/20/30/40)
///   - cols 1 and 2 in data rows are intentionally empty so the
///     bottom-right corner (row 4, col 2) is unmaterialised. This is the
///     scenario that produced data_end_cell_id == "" before the fix.
fn snapshot_with_empty_corner() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                // Header row
                text_cell(100, 0, 0, "Amount"),
                text_cell(101, 0, 1, "Category"),
                text_cell(102, 0, 2, "Note"),
                // Data column A only — B and C are empty in every data row
                number_cell(110, 1, 0, 10.0),
                number_cell(111, 2, 0, 20.0),
                number_cell(112, 3, 0, 30.0),
                number_cell(113, 4, 0, 40.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn is_row_hidden(engine: &YrsComputeEngine, sid: &SheetId, row: u32) -> bool {
    engine.is_row_hidden_query(sid, row)
}

// ---------------------------------------------------------------------------
// 1. create_filter must allocate CellIds at empty corners
// ---------------------------------------------------------------------------

#[test]
fn create_filter_allocates_cell_ids_for_empty_corners() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_empty_corner()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    // Pre-condition: corner cells (1..=4, 1..=2) are *all* empty in the mirror.
    for row in 1..=4u32 {
        for col in 1..=2u32 {
            let v = engine
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(row, col))
                .cloned()
                .unwrap_or(CellValue::Null);
            assert!(
                matches!(v, CellValue::Null),
                "pre: ({},{}) should be empty, got {:?}",
                row,
                col,
                v
            );
        }
    }

    // Create a filter spanning the empty bottom-right corner.
    let result = engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 2u32,
            }),
        )
        .expect("create_filter");

    // The bridge returns (Vec<u8>, MutationResult); MutationResult.data
    // carries the FilterState as JSON. Pull it back via get_filters_in_sheet
    // for clarity instead of decoding the wire payload.
    let _ = result;
    let filters = engine.get_filters_in_sheet(&sid);
    assert_eq!(filters.len(), 1, "exactly one filter created");
    let f = &filters[0];

    // The lie this test catches: a stored "" because the corner was empty.
    assert!(
        !f.header_start_cell_id.is_empty(),
        "header_start_cell_id must be a real CellId"
    );
    assert!(
        !f.header_end_cell_id.is_empty(),
        "header_end_cell_id must be a real CellId"
    );
    assert!(
        !f.data_end_cell_id.is_empty(),
        "data_end_cell_id must be a real CellId, was empty (the FIX-007 bug)"
    );

    // All three CellIds should be 32-char hex (id_to_hex output).
    assert_eq!(f.header_start_cell_id.len(), 32);
    assert_eq!(f.header_end_cell_id.len(), 32);
    assert_eq!(f.data_end_cell_id.len(), 32);

    // The data-end corner reference must round-trip back to its position.
    let resolved_end = f.end_row;
    assert_eq!(
        resolved_end,
        Some(4),
        "data_end resolves to the row we asked for"
    );
    let resolved_end_col = f.end_col;
    assert_eq!(
        resolved_end_col,
        Some(2),
        "header_end resolves to the col we asked for"
    );
}

// ---------------------------------------------------------------------------
// 2. apply_filter must hide the right rows even with empty corners
// ---------------------------------------------------------------------------

#[test]
fn apply_filter_hides_rows_after_empty_corner_create() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_empty_corner()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 2u32,
            }),
        )
        .expect("create_filter");

    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();

    // Filter column 0 (Amount) to allow only the value 20.
    // After apply_filter, rows with Amount != 20 must be hidden;
    // before the fix, no rows would be hidden because evaluate_filter
    // bailed out on the empty data_end corner.
    let criteria = ColumnFilter::Values {
        values: vec![serde_json::json!(20.0)],
        include_blanks: false,
    };

    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");
    engine.apply_filter(&sid, &filter_id).expect("apply_filter");

    // Header row stays visible; data rows other than row 2 (Amount=20)
    // must be hidden.
    assert!(!is_row_hidden(&engine, &sid, 0), "header row 0 visible");
    assert!(is_row_hidden(&engine, &sid, 1), "row 1 (10) hidden");
    assert!(!is_row_hidden(&engine, &sid, 2), "row 2 (20) visible");
    assert!(is_row_hidden(&engine, &sid, 3), "row 3 (30) hidden");
    assert!(is_row_hidden(&engine, &sid, 4), "row 4 (40) hidden");
}

// ---------------------------------------------------------------------------
// 3. Row-dim binary marks filter-hidden rows with hidden=true
// ---------------------------------------------------------------------------
//
// Hack B (right-fix/rust-event-emit): the renderer reads `hidden` from each
// `RenderRowDimension` to decide whether to draw a row. Earlier behaviour
// (commit c3947ed87) was that `applyFilter` only marked rows hidden in the
// `KEY_HIDDEN_ROWS` Yrs map but the row-dim records emitted to the viewport
// binary still reported `hidden=false`. The TS layer compensated by deleting
// filter-hidden cells from the snapshot post-hoc. This test pins the
// contract that the viewport binary itself reports `hidden=true` for every
// filter-hidden row, eliminating the need for snapshot post-processing.

#[test]
fn row_dim_binary_marks_filter_hidden_rows() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_empty_corner()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 2u32,
            }),
        )
        .expect("create_filter");

    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();
    let criteria = ColumnFilter::Values {
        values: vec![serde_json::json!(20.0)],
        include_blanks: false,
    };
    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");
    engine.apply_filter(&sid, &filter_id).expect("apply_filter");

    // Build the viewport render data covering rows 0..=4 and inspect the
    // row-dim records. Each row dim must report `hidden` in agreement with
    // is_row_hidden_query.
    let viewport = engine.build_viewport_render_data(&sid, 0, 0, 5, 3);
    assert_eq!(
        viewport.row_dimensions.len(),
        5,
        "expected one row-dim record per row in the viewport"
    );

    // For each visible/hidden expectation, the row-dim must agree.
    let expected: [(u32, bool); 5] = [
        (0, false), // header
        (1, true),  // 10 hidden
        (2, false), // 20 visible
        (3, true),  // 30 hidden
        (4, true),  // 40 hidden
    ];

    for (row, hidden) in expected {
        let rd = viewport
            .row_dimensions
            .iter()
            .find(|rd| rd.row == row)
            .unwrap_or_else(|| panic!("row-dim record for row {row} not present"));
        assert_eq!(
            rd.hidden, hidden,
            "row {row}: row-dim hidden={} expected {hidden}",
            rd.hidden
        );
        if hidden {
            // Hidden rows should also report a height of 0 so the renderer
            // collapses them in the layout pass.
            assert_eq!(rd.height, 0.0, "row {row} hidden but height={}", rd.height);
        }
        // The row-dim's `hidden` flag must agree with the engine query
        // function — they are the two ends of the same contract.
        assert_eq!(
            engine.is_row_hidden_query(&sid, row),
            hidden,
            "is_row_hidden_query disagrees with row-dim binary for row {row}"
        );
    }
}

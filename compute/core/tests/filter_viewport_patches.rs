//! Regression tests for filter viewport R5.1 — filter mutations emit
//! full-viewport patches that include row-visibility state.
//!
//! Before R5.1 the filter handlers (`set_column_filter`, `clear_column_filter`,
//! `apply_filter`, `create_filter`, `delete_filter`,
//! `clear_all_column_filters`) returned an empty `serialize_multi_viewport_patches(&[])`.
//! The TS kernel had to call `forceRefreshAllViewports()` after every
//! filter op to make the viewport buffer reflect post-filter row visibility.
//!
//! These tests pin the contract: every filter mutation returns a non-empty
//! multi-viewport patch blob whenever a viewport is registered on the sheet.
//!
//! Run:
//!   cargo test -p compute-core --test filter_viewport_patches

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use serde_json::json;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

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

fn snapshot_with_filter_data() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                text_cell(100, 0, 0, "Amount"),
                text_cell(101, 0, 1, "Bucket"),
                number_cell(110, 1, 0, 10.0),
                text_cell(120, 1, 1, "Keep"),
                number_cell(111, 2, 0, 20.0),
                text_cell(121, 2, 1, "Drop"),
                number_cell(112, 3, 0, 30.0),
                text_cell(122, 3, 1, "Keep"),
                number_cell(113, 4, 0, 40.0),
                text_cell(123, 4, 1, "Drop"),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn register_viewport(engine: &mut YrsComputeEngine, sheet_id: &SheetId) -> String {
    let viewport_id = "viewport-1".to_string();
    engine
        .register_viewport(&viewport_id, sheet_id, 0, 0, 9, 5)
        .expect("register_viewport");
    viewport_id
}

/// A multi-viewport patch blob is a leading u16 viewport count followed by
/// per-viewport entries. The empty-patch sentinel is `[0u8, 0u8]`. This
/// helper returns the parsed viewport count.
fn viewport_count(patches: &[u8]) -> u16 {
    assert!(patches.len() >= 2, "patch blob must carry header");
    u16::from_le_bytes([patches[0], patches[1]])
}

/// A header-only single-viewport patch (16 bytes header + sheet id) is the
/// "no cell changes" wire shape produced by `serialize_mutation_result_for_viewport`
/// when nothing intersects the viewport bounds. We assert the *full* viewport
/// rebuild path (`produce_cf_viewport_patches`) which writes a
/// `serialize_viewport_binary` blob — much larger than the empty-patch
/// header. Anything bigger than 32 bytes is the rebuild signature.
fn first_viewport_payload_size(patches: &[u8]) -> usize {
    let count = viewport_count(patches);
    if count == 0 {
        return 0;
    }
    let id_len = patches[2] as usize;
    let len_off = 3 + id_len;
    let payload_len = u32::from_le_bytes([
        patches[len_off],
        patches[len_off + 1],
        patches[len_off + 2],
        patches[len_off + 3],
    ]);
    payload_len as usize
}

#[test]
fn create_filter_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    let (patches, _result) = engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create_filter");

    assert_eq!(viewport_count(&patches), 1, "one viewport registered");
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "full viewport rebuild expected (filter viewport R5.1), got {} bytes",
        first_viewport_payload_size(&patches)
    );
}

#[test]
fn apply_filter_emits_full_viewport_patches_with_hidden_rows() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create_filter");
    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();

    // Set a column filter that excludes 30, then apply.
    let criteria: ColumnFilter = serde_json::from_value(json!({
        "type": "values",
        "values": [10, 20, 40],
    }))
    .expect("ColumnFilter");
    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");

    let (patches, _result) = engine.apply_filter(&sid, &filter_id).expect("apply_filter");

    // The full viewport rebuild must include hidden-row state; reading back
    // is_row_hidden_query at row 3 (value 30) confirms the engine state
    // changed, and the patch payload size confirms a real rebuild was sent.
    assert!(engine.is_row_hidden_query(&sid, 3), "row 30 must be hidden");
    assert!(!engine.is_row_hidden_query(&sid, 1), "row 10 visible");
    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "full viewport rebuild expected after apply_filter (filter viewport R5.1)"
    );
}

#[test]
fn clear_column_filter_emits_full_viewport_patches() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create_filter");
    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();

    let criteria: ColumnFilter = serde_json::from_value(json!({
        "type": "values",
        "values": [10],
    }))
    .expect("ColumnFilter");
    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");

    let (patches, _) = engine
        .clear_column_filter(&sid, &filter_id, 0)
        .expect("clear_column_filter");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "full viewport rebuild expected after clear_column_filter (filter viewport R5.1)"
    );
}

#[test]
fn clear_all_column_filters_clears_criteria_and_filter_hidden_rows() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create_filter");
    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();

    let criteria: ColumnFilter = serde_json::from_value(json!({
        "type": "values",
        "values": [10],
    }))
    .expect("ColumnFilter");
    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");
    assert!(engine.is_row_hidden_query(&sid, 2), "row 20 hidden");
    assert!(engine.is_row_hidden_query(&sid, 3), "row 30 hidden");
    assert!(engine.is_row_hidden_query(&sid, 4), "row 40 hidden");

    let (patches, result) = engine
        .clear_all_column_filters(&sid, &filter_id)
        .expect("clear_all_column_filters");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "full viewport rebuild expected after clear_all_column_filters"
    );
    assert!(!engine.is_row_hidden_query(&sid, 2), "row 20 visible");
    assert!(!engine.is_row_hidden_query(&sid, 3), "row 30 visible");
    assert!(!engine.is_row_hidden_query(&sid, 4), "row 40 visible");

    let filter = engine
        .get_filters_in_sheet(&sid)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("filter remains after clearing criteria");
    assert!(filter.column_filters.is_empty());

    let change = result.filter_changes.first().expect("filter change");
    assert_eq!(change.action.as_deref(), Some("cleared"));
    assert_eq!(change.has_active_filter, Some(false));
    assert_eq!(change.hidden_row_count, Some(0));
    assert_eq!(change.visible_row_count, Some(4));
}

#[test]
fn delete_filter_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create_filter");
    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();

    let (patches, _) = engine
        .delete_filter(&sid, &filter_id)
        .expect("delete_filter");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "full viewport rebuild expected after delete_filter (filter viewport R5.1)"
    );
}

/// Helper: drive a full apply_filter cycle without registering a viewport.
/// The mutation handler must still succeed (and emit a 0-viewport patch
/// blob, since no viewports are registered).
#[test]
fn apply_filter_no_registered_viewport_returns_zero_viewport_blob() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    // No register_viewport — the patch blob carries 0 viewports.

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create_filter");
    let filter_id = engine.get_filters_in_sheet(&sid)[0].id.clone();

    let criteria: ColumnFilter = serde_json::from_value(json!({
        "type": "values",
        "values": [10],
    }))
    .expect("ColumnFilter");
    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");

    let (patches, _) = engine.apply_filter(&sid, &filter_id).expect("apply_filter");
    assert_eq!(viewport_count(&patches), 0, "no viewports registered");
    // Row visibility still updates regardless of viewport registration.
    assert!(
        engine.is_row_hidden_query(&sid, 2),
        "row 20 hidden after apply_filter"
    );
    assert!(
        !engine.is_row_hidden_query(&sid, 1),
        "row 10 visible (matches the values filter)"
    );
}

#[test]
fn clear_all_filters_emits_deleted_changes_for_each_filter() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 4u32,
                "endCol": 0u32,
            }),
        )
        .expect("create amount filter");
    engine
        .create_filter(
            &sid,
            json!({
                "startRow": 0u32,
                "startCol": 1u32,
                "endRow": 4u32,
                "endCol": 1u32,
            }),
        )
        .expect("create bucket filter");
    let filter_ids: Vec<_> = engine
        .get_filters_in_sheet(&sid)
        .into_iter()
        .map(|filter| filter.id)
        .collect();
    assert_eq!(filter_ids.len(), 2, "test setup should create two filters");

    let (patches, result) = engine.clear_all_filters(&sid).expect("clear_all_filters");

    assert!(engine.get_filters_in_sheet(&sid).is_empty());
    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "full viewport rebuild expected after clear_all_filters"
    );
    assert_eq!(result.filter_changes.len(), 2);
    for filter_id in filter_ids {
        let change = result
            .filter_changes
            .iter()
            .find(|change| change.filter_id == filter_id)
            .unwrap_or_else(|| panic!("missing deleted change for {filter_id}"));
        assert_eq!(change.action.as_deref(), Some("deleted"));
        assert_eq!(change.kind, snapshot_types::ChangeKind::Removed);
        assert_eq!(change.filter_kind.as_deref(), Some("autoFilter"));
    }
}

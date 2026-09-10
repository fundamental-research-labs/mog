//! Filter mutations preserve criteria and row visibility.

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
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
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
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

fn register_viewport(engine: &mut ComputeEngine, sheet_id: &SheetId) -> String {
    let viewport_id = "viewport-1".to_string();
    engine
        .register_viewport(&viewport_id, sheet_id, 0, 0, 9, 5)
        .expect("register_viewport");
    viewport_id
}

#[test]
fn apply_filter_updates_visibility_and_cached_pixels() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("Sheet1").expect("Sheet1");
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
    assert_eq!(engine.get_row_position(&sid, 5), 100.0);
    let criteria: ColumnFilter = serde_json::from_value(json!({
        "type": "values",
        "values": [10, 20, 40],
    }))
    .expect("ColumnFilter");
    engine
        .set_column_filter(&sid, &filter_id, 0, criteria)
        .expect("set_column_filter");

    let _result = engine.apply_filter(&sid, &filter_id).expect("apply_filter");
    assert!(engine.is_row_hidden_query(&sid, 3), "row 30 must be hidden");
    assert!(!engine.is_row_hidden_query(&sid, 1), "row 10 visible");
    assert_eq!(engine.get_row_position(&sid, 5), 80.0);
    assert_eq!(engine.get_row_at_pixel(&sid, 60.0), 4);
}

#[test]
fn clear_all_column_filters_clears_criteria_and_filter_hidden_rows() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("Sheet1").expect("Sheet1");
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

    let result = engine
        .clear_all_column_filters(&sid, &filter_id)
        .expect("clear_all_column_filters");

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
fn apply_filter_without_registered_viewports_updates_visibility() {
    use domain_types::domain::filter::ColumnFilter;

    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("Sheet1").expect("Sheet1");

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

    let _ = engine.apply_filter(&sid, &filter_id).expect("apply_filter");
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
        ComputeEngine::from_snapshot(snapshot_with_filter_data()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("Sheet1").expect("Sheet1");
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

    let result = engine.clear_all_filters(&sid).expect("clear_all_filters");

    assert!(engine.get_filters_in_sheet(&sid).is_empty());

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

//! Engine-level tests for Rust-backed Advanced Filter.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use crate::storage::sheet::filters;
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "af000000-0000-4000-8000-000000000000";

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn cell(suffix: u32, row: u32, col: u32, value: impl Into<CellValue>) -> CellData {
    CellData {
        cell_id: format!("af000000-0000-4000-8000-{suffix:012x}"),
        row,
        col,
        value: value.into(),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn advanced_filter_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 10,
            cells: vec![
                cell(1, 0, 0, "Region"),
                cell(2, 0, 1, "Amount"),
                cell(3, 1, 0, "East"),
                cell(4, 1, 1, 10_i32),
                cell(5, 2, 0, "West"),
                cell(6, 2, 1, 20_i32),
                cell(7, 3, 0, "East"),
                cell(8, 3, 1, 30_i32),
                cell(9, 4, 0, "East"),
                cell(10, 4, 1, 30_i32),
                cell(11, 0, 3, "Region"),
                cell(12, 1, 3, "East"),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn advanced_filter_request(mode: filters::AdvancedFilterMode) -> filters::AdvancedFilterRequest {
    filters::AdvancedFilterRequest {
        list_range: "A1:B5".to_string(),
        criteria_range: Some("D1:D2".to_string()),
        mode,
        copy_to_range: None,
        unique_records_only: true,
        filter_id: None,
    }
}

#[test]
fn advanced_filter_in_place_tracks_filter_owned_hidden_rows() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(advanced_filter_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine.hide_rows(&sid, &[1]).unwrap();

    let (_, result) = engine
        .apply_advanced_filter(
            &sid,
            advanced_filter_request(filters::AdvancedFilterMode::InPlace),
        )
        .unwrap();
    let receipt: filters::AdvancedFilterResult =
        serde_json::from_value(result.data.clone().unwrap()).unwrap();

    assert_eq!(receipt.rows_matched, 2);
    assert_eq!(receipt.rows_hidden, Some(2));
    assert_eq!(receipt.mode, filters::AdvancedFilterMode::InPlace);
    assert_eq!(receipt.criteria_range.as_deref(), Some("D1:D2"));

    let change = result.filter_changes.first().expect("filter change");
    assert_eq!(change.filter_kind.as_deref(), Some("advancedFilter"));
    assert_eq!(change.action.as_deref(), Some("applied"));
    assert_eq!(change.hidden_row_count, Some(2));
    assert_eq!(change.visible_row_count, Some(2));
    assert_eq!(engine.get_hidden_rows(&sid), vec![1, 2, 4]);

    engine.delete_filter(&sid, &change.filter_id).unwrap();
    assert_eq!(engine.get_hidden_rows(&sid), vec![1]);
}

#[test]
fn manual_unhide_keeps_rows_hidden_by_advanced_filter() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(advanced_filter_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine.hide_rows(&sid, &[2]).unwrap();

    let (_, apply_result) = engine
        .apply_advanced_filter(
            &sid,
            advanced_filter_request(filters::AdvancedFilterMode::InPlace),
        )
        .unwrap();
    let change = apply_result.filter_changes.first().expect("filter change");
    assert_eq!(engine.get_hidden_rows(&sid), vec![2, 4]);

    let (_, unhide_result) = engine.unhide_rows(&sid, &[2]).unwrap();
    assert!(unhide_result.visibility_changes.is_empty());
    assert_eq!(engine.get_hidden_rows(&sid), vec![2, 4]);

    engine.delete_filter(&sid, &change.filter_id).unwrap();
    assert!(engine.get_hidden_rows(&sid).is_empty());
}

#[test]
fn clear_all_column_filters_clears_advanced_filter_activity() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(advanced_filter_snapshot()).unwrap();
    let sid = test_sheet_id();

    engine.hide_rows(&sid, &[1]).unwrap();

    let (_, apply_result) = engine
        .apply_advanced_filter(
            &sid,
            advanced_filter_request(filters::AdvancedFilterMode::InPlace),
        )
        .unwrap();
    let filter_id = apply_result
        .filter_changes
        .first()
        .expect("filter change")
        .filter_id
        .clone();
    assert_eq!(engine.get_hidden_rows(&sid), vec![1, 2, 4]);

    let (_, clear_result) = engine
        .clear_all_column_filters(&sid, &filter_id)
        .expect("clear advanced filter criteria");

    assert_eq!(engine.get_hidden_rows(&sid), vec![1]);
    let filter = engine
        .get_filters_in_sheet(&sid)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("advanced filter structure remains");
    assert_eq!(filter.filter_kind, filters::FilterKind::AdvancedFilter);
    assert!(filter.column_filters.is_empty());
    assert!(filter.advanced_filter.is_none());

    let clear_change = clear_result.filter_changes.first().expect("clear change");
    assert_eq!(clear_change.filter_kind.as_deref(), Some("advancedFilter"));
    assert_eq!(clear_change.action.as_deref(), Some("cleared"));
    assert_eq!(clear_change.has_active_filter, Some(false));
}

#[test]
fn advanced_filter_copy_to_writes_matching_rows_without_hiding_source() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(advanced_filter_snapshot()).unwrap();
    let sid = test_sheet_id();
    let mut request = advanced_filter_request(filters::AdvancedFilterMode::CopyTo);
    request.copy_to_range = Some("F1".to_string());
    request.unique_records_only = false;

    let (_, result) = engine.apply_advanced_filter(&sid, request).unwrap();
    let receipt: filters::AdvancedFilterResult =
        serde_json::from_value(result.data.clone().unwrap()).unwrap();

    assert_eq!(receipt.rows_matched, 3);
    assert_eq!(receipt.rows_copied, Some(3));
    assert_eq!(receipt.columns_copied, Some(2));
    assert_eq!(receipt.destination_range.as_deref(), Some("F1:G4"));
    assert!(engine.get_hidden_rows(&sid).is_empty());

    assert_eq!(engine.get_cell_value(&sid, 0, 5), CellValue::from("Region"));
    assert_eq!(engine.get_cell_value(&sid, 0, 6), CellValue::from("Amount"));
    assert_eq!(engine.get_cell_value(&sid, 1, 5), CellValue::from("East"));
    assert_eq!(
        engine.get_cell_value(&sid, 1, 6),
        CellValue::Number(FiniteF64::must(10.0))
    );
    assert_eq!(engine.get_cell_value(&sid, 2, 5), CellValue::from("East"));
    assert_eq!(
        engine.get_cell_value(&sid, 2, 6),
        CellValue::Number(FiniteF64::must(30.0))
    );
    assert_eq!(engine.get_cell_value(&sid, 3, 5), CellValue::from("East"));
    assert_eq!(
        engine.get_cell_value(&sid, 3, 6),
        CellValue::Number(FiniteF64::must(30.0))
    );
}

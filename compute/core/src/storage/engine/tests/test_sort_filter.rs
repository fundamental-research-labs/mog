//! Sort/filter interaction regressions.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot};
use cell_types::SheetPos;
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "71000000-0000-4000-8000-000000000001";

fn sid() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn text(value: &'static str) -> CellValue {
    CellValue::Text(std::sync::Arc::from(value))
}

fn num(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

fn cell_id(row: u32, col: u32) -> String {
    format!("71000000-0000-4000-8000-{:012x}", row * 16 + col + 2)
}

fn cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_id(row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn sort_filter_snapshot() -> WorkbookSnapshot {
    let rows = [
        [text("Name"), text("Dept"), text("Score")],
        [text("Alice"), text("Eng"), num(90.0)],
        [text("Bob"), text("Sales"), num(80.0)],
        [text("Carol"), text("Eng"), num(70.0)],
        [text("Dave"), text("Sales"), num(60.0)],
        [text("Eve"), text("Eng"), num(85.0)],
    ];

    let cells = rows
        .into_iter()
        .enumerate()
        .flat_map(|(row, values)| {
            values
                .into_iter()
                .enumerate()
                .map(move |(col, value)| cell(row as u32, col as u32, value))
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn text_at(engine: &YrsComputeEngine, row: u32, col: u32) -> String {
    match engine
        .mirror()
        .get_cell_value_at(&sid(), SheetPos::new(row, col))
    {
        Some(CellValue::Text(value)) => value.to_string(),
        Some(CellValue::Number(value)) => f64::from(*value).to_string(),
        other => panic!("expected text/number at ({row},{col}), got {other:?}"),
    }
}

#[test]
fn sort_range_visible_rows_only_preserves_hidden_slots() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(sort_filter_snapshot()).unwrap();
    let sheet_id = sid();

    engine
        .hide_rows(&sheet_id, &[2, 4])
        .expect("hide filtered-out rows");

    let options = mutation::BridgeSortOptions {
        criteria: vec![mutation::BridgeSortCriterion {
            column: 2,
            direction: domain_types::domain::filter::SortOrder::Asc,
            case_sensitive: false,
            mode: mutation::BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: true,
        visible_rows_only: true,
    };

    engine
        .sort_range(&sheet_id, 0, 0, 5, 2, options)
        .expect("visible-row sort");

    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![2, 4]);
    assert!(engine.is_row_hidden_query(&sheet_id, 2));
    assert!(engine.is_row_hidden_query(&sheet_id, 4));

    assert_eq!(text_at(&engine, 0, 0), "Name");
    assert_eq!(text_at(&engine, 1, 0), "Carol");
    assert_eq!(text_at(&engine, 2, 0), "Bob");
    assert_eq!(text_at(&engine, 3, 0), "Eve");
    assert_eq!(text_at(&engine, 4, 0), "Dave");
    assert_eq!(text_at(&engine, 5, 0), "Alice");

    assert_eq!(text_at(&engine, 1, 2), "70");
    assert_eq!(text_at(&engine, 3, 2), "85");
    assert_eq!(text_at(&engine, 5, 2), "90");
}

#[test]
fn headered_sort_resolves_blank_header_column_from_body_cells() {
    let cells = vec![
        cell(0, 0, text("Section Title")),
        cell(1, 0, text("Large")),
        cell(1, 1, num(30.0)),
        cell(2, 0, text("Small")),
        cell(2, 1, num(10.0)),
        cell(3, 0, text("Medium")),
        cell(3, 1, num(20.0)),
    ];
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = sid();

    let options = mutation::BridgeSortOptions {
        criteria: vec![mutation::BridgeSortCriterion {
            column: 1,
            direction: domain_types::domain::filter::SortOrder::Asc,
            case_sensitive: false,
            mode: mutation::BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: true,
        visible_rows_only: false,
    };

    engine
        .sort_range(&sheet_id, 0, 0, 3, 1, options)
        .expect("sort with blank criterion header cell");

    assert_eq!(text_at(&engine, 0, 0), "Section Title");
    assert_eq!(text_at(&engine, 1, 0), "Small");
    assert_eq!(text_at(&engine, 2, 0), "Medium");
    assert_eq!(text_at(&engine, 3, 0), "Large");
}

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

fn add_score_highlight_cf(engine: &mut YrsComputeEngine, sheet_id: &SheetId, fill: &str) {
    engine
        .add_cf_rule(
            sheet_id,
            serde_json::json!({
                "id": "score-highlight",
                "sheetId": sheet_id.to_uuid_string(),
                "ranges": [{
                    "startRow": 1u32,
                    "startCol": 2u32,
                    "endRow": 5u32,
                    "endCol": 2u32,
                }],
                "rules": [{
                    "type": "cellValue",
                    "id": "score-over-80",
                    "priority": 1,
                    "operator": "greaterThan",
                    "value1": 80,
                    "style": {
                        "backgroundColor": fill,
                    },
                }],
            }),
        )
        .expect("add conditional format rule");
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

#[test]
fn color_filter_matches_conditional_format_fill() {
    use crate::storage::sheet::filters::ColumnFilter;

    let (mut engine, _) = YrsComputeEngine::from_snapshot(sort_filter_snapshot()).unwrap();
    let sheet_id = sid();
    let fill = "#ffde59";

    add_score_highlight_cf(&mut engine, &sheet_id, fill);
    assert_eq!(
        engine
            .get_resolved_format(&sheet_id, 1, 2)
            .background_color
            .as_deref(),
        Some(fill),
        "CF fill should be visible through the resolved-format read path"
    );

    engine
        .create_filter(
            &sheet_id,
            serde_json::json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 5u32,
                "endCol": 2u32,
            }),
        )
        .expect("create filter");
    let filter_id = engine.get_filters_in_sheet(&sheet_id)[0].id.clone();

    engine
        .set_column_filter(
            &sheet_id,
            &filter_id,
            2,
            ColumnFilter::Color {
                color: fill.to_string(),
                by_font: false,
            },
        )
        .expect("apply color filter");

    assert!(!engine.is_row_hidden_query(&sheet_id, 1), "Alice visible");
    assert!(engine.is_row_hidden_query(&sheet_id, 2), "Bob hidden");
    assert!(engine.is_row_hidden_query(&sheet_id, 3), "Carol hidden");
    assert!(engine.is_row_hidden_query(&sheet_id, 4), "Dave hidden");
    assert!(!engine.is_row_hidden_query(&sheet_id, 5), "Eve visible");

    engine
        .hide_rows(&sheet_id, &[1])
        .expect("hide visible row manually");
    assert_eq!(engine.get_hidden_rows(&sheet_id), vec![1, 2, 3, 4]);
    assert_eq!(engine.get_filter_hidden_rows(&sheet_id), vec![2, 3, 4]);
}

#[test]
fn multiple_filters_on_empty_interior_headers_keep_distinct_criteria() {
    use crate::storage::sheet::filters::ColumnFilter;

    let (mut engine, _) = YrsComputeEngine::from_snapshot(sort_filter_snapshot()).unwrap();
    let sheet_id = sid();

    engine
        .create_filter(
            &sheet_id,
            serde_json::json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 5u32,
                "endCol": 9u32,
            }),
        )
        .expect("create wide filter");
    let filter_id = engine.get_filters_in_sheet(&sheet_id)[0].id.clone();

    engine
        .set_column_filter(
            &sheet_id,
            &filter_id,
            7,
            ColumnFilter::Values {
                values: vec![serde_json::Value::String("High".to_string())],
                include_blanks: false,
            },
        )
        .expect("set first empty-header filter");
    engine
        .set_column_filter(
            &sheet_id,
            &filter_id,
            3,
            ColumnFilter::Values {
                values: vec![serde_json::Value::String("May 2026".to_string())],
                include_blanks: false,
            },
        )
        .expect("set second empty-header filter");

    let filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("filter remains");
    assert_eq!(filter.column_filters.len(), 2);
    assert!(
        !filter.column_filters.contains_key(""),
        "empty fallback key would collapse distinct columns"
    );
}

#[test]
fn color_sort_matches_conditional_format_fill() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(sort_filter_snapshot()).unwrap();
    let sheet_id = sid();
    let fill = "#ffde59";

    add_score_highlight_cf(&mut engine, &sheet_id, fill);

    let options = mutation::BridgeSortOptions {
        criteria: vec![mutation::BridgeSortCriterion {
            column: 2,
            direction: domain_types::domain::filter::SortOrder::Asc,
            case_sensitive: false,
            mode: mutation::BridgeSortMode::CellColor {
                target: fill.to_string(),
                position: domain_types::domain::filter::ColorPosition::Top,
            },
        }],
        has_headers: true,
        visible_rows_only: false,
    };

    engine
        .sort_range(&sheet_id, 0, 0, 5, 2, options)
        .expect("sort by resolved CF fill");

    assert_eq!(text_at(&engine, 1, 0), "Alice");
    assert_eq!(text_at(&engine, 2, 0), "Eve");
    assert_eq!(text_at(&engine, 3, 0), "Bob");
    assert_eq!(text_at(&engine, 4, 0), "Carol");
    assert_eq!(text_at(&engine, 5, 0), "Dave");
}

#[test]
fn sort_preserves_filter_range_for_later_criteria() {
    use crate::storage::sheet::filters::{
        ColumnFilter, FilterCondition, FilterLogic, FilterOperator,
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(sort_filter_snapshot()).unwrap();
    let sheet_id = sid();

    engine
        .create_filter(
            &sheet_id,
            serde_json::json!({
                "startRow": 0u32,
                "startCol": 0u32,
                "endRow": 5u32,
                "endCol": 2u32,
            }),
        )
        .expect("create filter");
    let filter_id = engine.get_filters_in_sheet(&sheet_id)[0].id.clone();

    let options = mutation::BridgeSortOptions {
        criteria: vec![mutation::BridgeSortCriterion {
            column: 2,
            direction: domain_types::domain::filter::SortOrder::Desc,
            case_sensitive: false,
            mode: mutation::BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: true,
        visible_rows_only: false,
    };

    engine
        .sort_range(&sheet_id, 0, 0, 5, 2, options)
        .expect("sort filtered range");

    let filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| filter.id == filter_id)
        .expect("filter remains after sort");
    assert_eq!(filter.start_row, Some(0));
    assert_eq!(filter.start_col, Some(0));
    assert_eq!(filter.end_row, Some(5));
    assert_eq!(filter.end_col, Some(2));

    engine
        .set_column_filter(
            &sheet_id,
            &filter_id,
            2,
            ColumnFilter::Condition {
                conditions: vec![FilterCondition {
                    operator: FilterOperator::GreaterThan,
                    value: Some(num(80.0)),
                    value2: None,
                }],
                logic: FilterLogic::And,
            },
        )
        .expect("apply condition after sort");

    assert!(!engine.is_row_hidden_query(&sheet_id, 1), "Alice visible");
    assert!(!engine.is_row_hidden_query(&sheet_id, 2), "Eve visible");
    assert!(engine.is_row_hidden_query(&sheet_id, 3), "Bob hidden");
    assert!(engine.is_row_hidden_query(&sheet_id, 4), "Carol hidden");
    assert!(engine.is_row_hidden_query(&sheet_id, 5), "Dave hidden");
}

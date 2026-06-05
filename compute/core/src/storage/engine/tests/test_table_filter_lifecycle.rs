//! Table-owned filter lifecycle regressions.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot};
use snapshot_types::Axis;
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "7b000000-0000-4000-8000-000000000001";

fn sid() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn text(value: &'static str) -> CellValue {
    CellValue::Text(std::sync::Arc::from(value))
}

fn cell_id(row: u32, col: u32) -> String {
    format!("7b000000-0000-4000-8000-{:012x}", row * 16 + col + 2)
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

fn table_filter_snapshot() -> WorkbookSnapshot {
    let rows = [
        [text("Name"), text("Dept")],
        [text("Alice"), text("Eng")],
        [text("Bob"), text("Sales")],
        [text("Carol"), text("Eng")],
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

fn create_filtered_table(engine: &mut YrsComputeEngine) -> String {
    let sheet_id = sid();
    engine
        .create_table(
            &sheet_id,
            "People".into(),
            0,
            0,
            3,
            1,
            vec!["Name".into(), "Dept".into()],
            true,
        )
        .expect("create table");
    let table_filter = engine
        .get_filters_in_sheet(&sheet_id)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .expect("table filter");
    let filter_id = table_filter.id;

    let (_, result) = engine
        .set_column_filter(
            &sheet_id,
            &filter_id,
            1,
            crate::storage::sheet::filters::ColumnFilter::Values {
                values: vec![serde_json::json!("Eng")],
                include_blanks: false,
            },
        )
        .expect("set table filter");
    assert!(
        result
            .visibility_changes
            .iter()
            .any(|change| { change.axis == Axis::Row && change.index == 2 && change.hidden })
    );
    assert_eq!(
        engine.get_hidden_rows(&sheet_id),
        vec![2],
        "table filter should hide the non-matching data row"
    );

    filter_id
}

#[test]
fn delete_table_clears_owned_table_filter_visibility() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    let filter_id = create_filtered_table(&mut engine);

    let (_, result) = engine.delete_table("People").expect("delete table");

    assert!(
        engine.get_filters_in_sheet(&sheet_id).is_empty(),
        "deleting a table must remove its owned table filter"
    );
    assert!(
        engine.get_hidden_rows(&sheet_id).is_empty(),
        "deleting a table must clear rows hidden only by its table filter"
    );
    assert!(result.filter_changes.iter().any(|change| {
        change.filter_id == filter_id
            && change.filter_kind.as_deref() == Some("tableFilter")
            && change.action.as_deref() == Some("deleted")
    }));
    assert!(
        result
            .visibility_changes
            .iter()
            .any(|change| { change.axis == Axis::Row && change.index == 2 && !change.hidden })
    );
}

#[test]
fn convert_table_to_range_clears_owned_table_filter_visibility() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    let filter_id = create_filtered_table(&mut engine);

    let (_, result) = engine
        .convert_table_to_range("People")
        .expect("convert table");

    assert!(
        engine.get_filters_in_sheet(&sheet_id).is_empty(),
        "converting a table must remove its owned table filter"
    );
    assert!(
        engine.get_hidden_rows(&sheet_id).is_empty(),
        "converting a table must clear rows hidden only by its table filter"
    );
    assert!(result.filter_changes.iter().any(|change| {
        change.filter_id == filter_id
            && change.filter_kind.as_deref() == Some("tableFilter")
            && change.action.as_deref() == Some("deleted")
    }));
    assert!(
        result
            .visibility_changes
            .iter()
            .any(|change| { change.axis == Axis::Row && change.index == 2 && !change.hidden })
    );
}

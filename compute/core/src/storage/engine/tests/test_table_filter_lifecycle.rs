//! Table-owned filter lifecycle regressions.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot};
use snapshot_types::{Axis, ChangeKind};
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

fn visible_filter_columns(engine: &YrsComputeEngine, sheet_id: &SheetId) -> Vec<u32> {
    let mut cols: Vec<u32> = engine
        .get_filter_header_info(sheet_id)
        .into_iter()
        .filter(|entry| entry.button_visible)
        .map(|entry| entry.col)
        .collect();
    cols.sort_unstable();
    cols
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
fn delete_filtered_table_is_single_undo_step() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    create_filtered_table(&mut engine);
    let table_id = engine
        .get_table_by_name("People")
        .expect("created table")
        .id
        .clone();
    let before_depth = engine.get_undo_state().undo_depth;

    engine.delete_table("People").expect("delete table");

    assert_eq!(
        engine.get_undo_state().undo_depth,
        before_depth + 1,
        "table, filter, and filter-hidden-row removal must be one undoable edit"
    );

    engine.undo().expect("undo delete table");
    assert_eq!(
        engine
            .get_table_by_name("People")
            .expect("restored table")
            .id,
        table_id
    );
    assert!(
        engine
            .get_filters_in_sheet(&sheet_id)
            .iter()
            .any(|filter| filter.table_id.as_deref() == Some(table_id.as_str())),
        "one undo must restore the table-owned filter"
    );
    assert_eq!(
        engine.get_hidden_rows(&sheet_id),
        vec![2],
        "one undo must restore the table filter's row visibility ownership"
    );
}

#[test]
fn redo_delete_table_emits_sheet_scoped_table_removal() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    let expected_sheet_id = sheet_id.to_uuid_string();
    create_filtered_table(&mut engine);
    let expected_table_id = engine
        .get_table_by_name("People")
        .expect("created table")
        .id
        .clone();

    engine.delete_table("People").expect("delete table");

    let (_, undo_result) = engine.undo().expect("undo delete table");
    assert!(undo_result.table_changes.iter().any(|change| {
        change.name == "People"
            && change.table_id.as_deref() == Some(expected_table_id.as_str())
            && change.sheet_id == expected_sheet_id
            && change.kind == ChangeKind::Set
    }));
    assert!(!undo_result.table_changes.iter().any(|change| {
        change.name == "People"
            && change.sheet_id == expected_sheet_id
            && change.kind == ChangeKind::Removed
    }));

    let (_, redo_result) = engine.redo().expect("redo delete table");
    assert!(
        redo_result.table_changes.iter().any(|change| {
            change.name == "People"
                && change.table_id.as_deref() == Some(expected_table_id.as_str())
                && change.sheet_id == expected_sheet_id
                && change.kind == ChangeKind::Removed
        }),
        "redo table changes: {:?}",
        redo_result.table_changes
    );
    assert!(!redo_result.table_changes.iter().any(|change| {
        change.name == "People"
            && change.sheet_id == expected_sheet_id
            && change.kind == ChangeKind::Set
    }));
    assert!(
        engine.get_filters_in_sheet(&sheet_id).is_empty(),
        "redoing the table delete must remove the owned table filter"
    );
}

#[test]
fn table_delete_undo_redo_restores_owned_filter_headers_atomically() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();

    engine
        .create_table_lifecycle(
            &sheet_id,
            Some("Left".into()),
            0,
            0,
            3,
            1,
            vec!["Name".into(), "Dept".into()],
            true,
            None,
        )
        .expect("create left table");
    engine
        .create_table_lifecycle(
            &sheet_id,
            Some("Right".into()),
            0,
            3,
            3,
            4,
            vec!["Product".into(), "Units".into()],
            true,
            None,
        )
        .expect("create right table");

    assert_eq!(visible_filter_columns(&engine, &sheet_id), vec![0, 1, 3, 4]);

    engine.begin_undo_group().expect("begin delete group");
    engine.delete_table("Left").expect("delete left table");
    engine.end_undo_group().expect("end delete group");

    assert_eq!(visible_filter_columns(&engine, &sheet_id), vec![3, 4]);

    engine.undo().expect("undo delete table");
    assert!(
        engine.get_table_by_name("Left").is_some(),
        "undo must restore the deleted table"
    );
    assert_eq!(
        visible_filter_columns(&engine, &sheet_id),
        vec![0, 1, 3, 4],
        "undo must restore the table-owned filter headers with the table"
    );

    engine.redo().expect("redo delete table");
    assert!(
        engine.get_table_by_name("Left").is_none(),
        "redo must remove the table again"
    );
    assert_eq!(
        visible_filter_columns(&engine, &sheet_id),
        vec![3, 4],
        "redo must remove only the deleted table's filter headers"
    );
}

#[test]
fn hidden_table_header_suppresses_filter_button_visibility() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    create_filtered_table(&mut engine);

    let before = engine.get_filter_header_info(&sheet_id);
    assert!(
        before.iter().any(|entry| entry.button_visible),
        "table filters should expose visible header buttons before hiding the header"
    );

    engine
        .toggle_header_row("People")
        .expect("toggle header row");

    let after = engine.get_filter_header_info(&sheet_id);
    assert!(
        !after.is_empty(),
        "filter metadata should remain available after hiding the table header"
    );
    assert!(
        after.iter().all(|entry| !entry.button_visible),
        "hidden table headers must suppress rendered filter buttons"
    );
}

#[test]
fn hidden_table_filter_buttons_suppress_filter_button_visibility() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    create_filtered_table(&mut engine);

    engine
        .set_table_bool_option("People", "showFilterButtons", false)
        .expect("hide filter buttons");

    let after = engine.get_filter_header_info(&sheet_id);
    assert!(
        !after.is_empty(),
        "filter metadata should remain available after hiding filter buttons"
    );
    assert!(
        after.iter().all(|entry| !entry.button_visible),
        "hidden table filter buttons must suppress rendered filter buttons"
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

#[test]
fn convert_filtered_table_to_range_is_single_undo_step() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(table_filter_snapshot()).unwrap();
    let sheet_id = sid();
    create_filtered_table(&mut engine);
    let table_id = engine
        .get_table_by_name("People")
        .expect("created table")
        .id
        .clone();
    let before_depth = engine.get_undo_state().undo_depth;

    engine
        .convert_table_to_range("People")
        .expect("convert table");

    assert_eq!(
        engine.get_undo_state().undo_depth,
        before_depth + 1,
        "table conversion must remove table, filter, and filter-hidden rows in one undoable edit"
    );

    engine.undo().expect("undo convert table");
    assert_eq!(
        engine
            .get_table_by_name("People")
            .expect("restored table")
            .id,
        table_id
    );
    assert!(
        engine
            .get_filters_in_sheet(&sheet_id)
            .iter()
            .any(|filter| filter.table_id.as_deref() == Some(table_id.as_str())),
        "one undo must restore the table-owned filter"
    );
    assert_eq!(
        engine.get_hidden_rows(&sheet_id),
        vec![2],
        "one undo must restore the table filter's row visibility ownership"
    );
}

use super::super::{CellChange, CellChangeKind};
use super::assertions::assert_cell_change_base;
use super::fixtures::*;
use crate::hex::id_to_hex;
use crate::schema::{
    KEY_CELL_PROPERTIES, KEY_COMMENTS, KEY_FILTERS, KEY_FLOATING_OBJECTS, KEY_HIDDEN_ROWS,
    KEY_MERGES, KEY_PIVOT_TABLES, KEY_ROW_HEIGHTS, KEY_TABLES,
};
use crate::undo::{ORIGIN_FORMULA_RESULT, ORIGIN_REMOTE, ORIGIN_USER_EDIT};
use std::sync::Arc;
use yrs::{Any, Map, MapPrelim, MapRef, Out, Transact};

#[test]
fn test_observer_ignores_formula_result_origin() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let cell_id = make_cell_id(400);
    insert_cell_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        cell_id,
        42.0,
        None,
        Some(ORIGIN_FORMULA_RESULT),
    );

    let changes = observer.drain_changes();
    assert!(
        changes.is_empty(),
        "formula-result changes should be ignored, got: {:?}",
        changes
    );

    // Verify the cell was actually written
    let txn = doc.transact();
    let sheet_hex_str = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex_str) {
        if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
            assert!(
                cells_map.get(&txn, &cell_hex).is_some(),
                "cell should exist in yrs despite observer ignoring it"
            );
        }
    }
}

#[test]
fn test_user_edit_origin_is_observed() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let cell_id = make_cell_id(700);
    insert_cell_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        cell_id,
        42.0,
        None,
        Some(ORIGIN_USER_EDIT),
    );

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
}

#[test]
fn test_remote_origin_is_observed() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let cell_id = make_cell_id(800);
    insert_cell_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        cell_id,
        99.0,
        None,
        Some(ORIGIN_REMOTE),
    );

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_eq!(
        changes[0],
        CellChange {
            sheet_id,
            cell_id,
            kind: CellChangeKind::Modified,
            old_value: None,
        }
    );
}

#[test]
fn test_no_origin_is_observed() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let cell_id = make_cell_id(1100);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 55.0, None);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
}

#[test]
fn test_formula_result_filtering_all_sub_maps() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_HEIGHTS);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_MERGES);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_HIDDEN_ROWS);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_COMMENTS);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_FLOATING_OBJECTS);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_FILTERS);

    let observer = new_observer(&sheets, &workbook);

    // Write to all sub-maps with ORIGIN_FORMULA_RESULT — all should be filtered.
    let cell_hex = id_to_hex(make_cell_id(5006).as_u128());
    insert_sub_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_CELL_PROPERTIES,
        &cell_hex,
        Any::String(Arc::from("fmt")),
        Some(ORIGIN_FORMULA_RESULT),
    );
    insert_sub_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_ROW_HEIGHTS,
        "r1",
        Any::Number(20.0),
        Some(ORIGIN_FORMULA_RESULT),
    );
    insert_sub_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_MERGES,
        "A1:B2",
        Any::Bool(true),
        Some(ORIGIN_FORMULA_RESULT),
    );
    insert_sub_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_HIDDEN_ROWS,
        "r5",
        Any::Bool(true),
        Some(ORIGIN_FORMULA_RESULT),
    );
    insert_sub_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COMMENTS,
        &cell_hex,
        Any::String(Arc::from("comment")),
        Some(ORIGIN_FORMULA_RESULT),
    );
    insert_sub_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FILTERS,
        "autoFilter",
        Any::String(Arc::from("{}")),
        Some(ORIGIN_FORMULA_RESULT),
    );

    // Insert pivot and floating object entries with ORIGIN_FORMULA_RESULT
    insert_sub_map_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-fr",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        Some(ORIGIN_FORMULA_RESULT),
    );
    insert_sub_map_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FLOATING_OBJECTS,
        "chart-fr",
        &[("type", Any::String(Arc::from("bar")))],
        Some(ORIGIN_FORMULA_RESULT),
    );

    let changes = observer.drain_all_changes();
    assert!(
        changes.is_empty(),
        "all formula-result changes should be filtered, got non-empty: cells={}, props={}, rows={}, merges={}, hidden={}, comments={}, pivots={}, floats={}, filters={}",
        changes.cells.len(),
        changes.properties.len(),
        changes.row_heights.len(),
        changes.merges.len(),
        changes.hidden_rows.len(),
        changes.comments.len(),
        changes.pivot_tables.len(),
        changes.floating_objects.len(),
        changes.filters.len(),
    );
}

#[test]
fn test_workbook_table_formula_result_filtered() {
    let (doc, sheets, workbook) = setup_doc();

    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_TABLES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    {
        let mut txn = doc.transact_mut_with(ORIGIN_FORMULA_RESULT);
        if let Some(Out::YMap(tables_map)) = workbook.get(&txn, KEY_TABLES) {
            tables_map.insert(&mut txn, "table-fr", Any::String(Arc::from("data")));
        }
    }

    let changes = observer.drain_all_changes();
    assert!(
        changes.tables.is_empty(),
        "formula-result workbook table changes should be filtered"
    );
}

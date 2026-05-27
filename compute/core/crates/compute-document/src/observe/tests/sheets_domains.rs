use super::super::CellChangeKind;
use super::fixtures::*;
use crate::hex::id_to_hex;
use crate::schema::{
    KEY_CELL_PROPERTIES, KEY_COL_FORMATS, KEY_COL_WIDTHS, KEY_COMMENTS, KEY_CONDITIONAL_FORMAT,
    KEY_FILTERS, KEY_FLOATING_OBJECTS, KEY_GROUPING, KEY_HIDDEN_COLS, KEY_HIDDEN_ROWS, KEY_MERGES,
    KEY_PROPERTIES, KEY_ROW_FORMATS, KEY_ROW_HEIGHTS, KEY_SORTING, KEY_SPARKLINES,
};
use std::sync::Arc;
use yrs::Any;

#[test]
fn test_property_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);

    let observer = new_observer(&sheets, &workbook);

    let cell_id = make_cell_id(5002);
    let cell_hex = id_to_hex(cell_id.as_u128());
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_CELL_PROPERTIES,
        &cell_hex,
        Any::String(Arc::from("{\"bold\":true}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.properties.len(), 1);
    assert_eq!(changes.properties[0].sheet_id, sheet_id);
    assert_eq!(changes.properties[0].cell_id, cell_id);
    assert_eq!(changes.properties[0].kind, CellChangeKind::Modified);
    assert!(changes.has_non_cell_changes());
}

#[test]
fn test_row_height_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_HEIGHTS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_ROW_HEIGHTS,
        "row_5",
        Any::Number(30.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.row_heights.len(), 1);
    assert_eq!(changes.row_heights[0].sheet_id, sheet_id);
    assert_eq!(changes.row_heights[0].key, "row_5");
    assert_eq!(changes.row_heights[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_merge_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_MERGES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_MERGES,
        "A1:C3",
        Any::Bool(true),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.merges.len(), 1);
    assert_eq!(changes.merges[0].sheet_id, sheet_id);
    assert_eq!(changes.merges[0].key, "A1:C3");
    assert_eq!(changes.merges[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_property_change_undo_simulation() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);

    let cell_id = make_cell_id(5005);
    let cell_hex = id_to_hex(cell_id.as_u128());

    // Write property before observer
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_CELL_PROPERTIES,
        &cell_hex,
        Any::String(Arc::from("{\"bold\":true}")),
    );

    let observer = new_observer(&sheets, &workbook);

    // "Undo" by removing the property
    remove_sub_map_entry(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES, &cell_hex);

    let changes = observer.drain_all_changes();
    assert_eq!(changes.properties.len(), 1);
    assert_eq!(changes.properties[0].sheet_id, sheet_id);
    assert_eq!(changes.properties[0].cell_id, cell_id);
    assert_eq!(changes.properties[0].kind, CellChangeKind::Removed);
}

#[test]
fn test_floating_object_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_FLOATING_OBJECTS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FLOATING_OBJECTS,
        "chart-001",
        &[("type", Any::String(Arc::from("bar")))],
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.floating_objects.len(), 1);
    assert_eq!(changes.floating_objects[0].sheet_id, sheet_id);
    assert_eq!(changes.floating_objects[0].object_id, "chart-001");
    assert_eq!(changes.floating_objects[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_hidden_rows_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_HIDDEN_ROWS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_HIDDEN_ROWS,
        "row_3",
        Any::Bool(true),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.hidden_rows.len(), 1);
    assert_eq!(changes.hidden_rows[0].sheet_id, sheet_id);
    assert_eq!(changes.hidden_rows[0].key, "row_3");
}

#[test]
fn test_hidden_cols_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_HIDDEN_COLS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_HIDDEN_COLS,
        "col_B",
        Any::Bool(true),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.hidden_cols.len(), 1);
    assert_eq!(changes.hidden_cols[0].sheet_id, sheet_id);
    assert_eq!(changes.hidden_cols[0].key, "col_B");
}

#[test]
fn test_comment_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_COMMENTS);

    let observer = new_observer(&sheets, &workbook);

    let cell_hex = id_to_hex(make_cell_id(6001).as_u128());
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COMMENTS,
        &cell_hex,
        Any::String(Arc::from("This is a comment")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.comments.len(), 1);
    assert_eq!(changes.comments[0].sheet_id, sheet_id);
    assert_eq!(cell_hex, changes.comments[0].key);
}

#[test]
fn test_filter_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_FILTERS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FILTERS,
        "autoFilter",
        Any::String(Arc::from("{\"range\":\"A1:D10\"}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.filters.len(), 1);
    assert_eq!(changes.filters[0].sheet_id, sheet_id);
    assert_eq!(changes.filters[0].key, Some("autoFilter".to_string()));
}

#[test]
fn test_grouping_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_GROUPING);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_GROUPING,
        "group1",
        Any::String(Arc::from("{\"rows\":[1,5]}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.grouping.len(), 1);
    assert_eq!(changes.grouping[0].sheet_id, sheet_id);
}

#[test]
fn test_sparkline_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_SPARKLINES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_SPARKLINES,
        "spark1",
        Any::String(Arc::from("{\"type\":\"line\"}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.sparklines.len(), 1);
    assert_eq!(changes.sparklines[0].sheet_id, sheet_id);
}

#[test]
fn test_conditional_format_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_CONDITIONAL_FORMAT);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_CONDITIONAL_FORMAT,
        "cf1",
        Any::String(Arc::from("{\"type\":\"colorScale\"}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.conditional_formats.len(), 1);
    assert_eq!(changes.conditional_formats[0].sheet_id, sheet_id);
}

#[test]
fn test_sheet_meta_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PROPERTIES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PROPERTIES,
        "name",
        Any::String(Arc::from("Sheet1")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.sheet_meta.len(), 1);
    assert_eq!(changes.sheet_meta[0].sheet_id, sheet_id);
    assert_eq!(changes.sheet_meta[0].field, Some("name".to_string()));
}

#[test]
fn test_col_width_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_COL_WIDTHS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COL_WIDTHS,
        "col_A",
        Any::Number(120.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.col_widths.len(), 1);
    assert_eq!(changes.col_widths[0].sheet_id, sheet_id);
    assert_eq!(changes.col_widths[0].key, "col_A");
}

#[test]
fn test_row_format_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_FORMATS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_ROW_FORMATS,
        "row_1",
        Any::String(Arc::from("{\"bold\":true}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.row_formats.len(), 1);
    assert_eq!(changes.row_formats[0].sheet_id, sheet_id);
}

#[test]
fn test_col_format_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_COL_FORMATS);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COL_FORMATS,
        "col_A",
        Any::String(Arc::from("{\"italic\":true}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.col_formats.len(), 1);
    assert_eq!(changes.col_formats[0].sheet_id, sheet_id);
}

#[test]
fn test_sorting_change() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_SORTING);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_SORTING,
        "sortState",
        Any::String(Arc::from("{\"col\":0,\"asc\":true}")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.sorting.len(), 1);
    assert_eq!(changes.sorting[0].sheet_id, sheet_id);
}

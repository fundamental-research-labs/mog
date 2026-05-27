use super::super::CellChangeKind;
use super::fixtures::*;
use crate::hex::id_to_hex;
use crate::schema::{
    KEY_CELL_PROPERTIES, KEY_COL_FORMATS, KEY_COMMENTS, KEY_CONDITIONAL_FORMAT, KEY_FILTERS,
    KEY_FLOATING_OBJECTS, KEY_GROUPING, KEY_MERGES, KEY_PROPERTIES, KEY_ROW_FORMATS, KEY_SORTING,
    KEY_SPARKLINES,
};
use cell_types::CellId;
use std::sync::Arc;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Out, Transact};

fn modify_property_field(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    field: &str,
    value: Any,
) {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = doc.transact_mut();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(props_map)) = sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
            if let Some(Out::YMap(cell_map)) = props_map.get(&txn, &cell_hex) {
                cell_map.insert(&mut txn, field, value);
            }
        }
    }
}

#[test]
fn test_property_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);

    let cell_id = make_cell_id(902);
    // Insert a property entry at depth 2
    let cell_hex = id_to_hex(cell_id.as_u128());
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex) {
            if let Some(Out::YMap(props_map)) = sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
                props_map.insert(
                    &mut txn,
                    &*cell_hex,
                    MapPrelim::from([("bold", Any::Bool(false))]),
                );
            }
        }
    }

    let observer = new_observer(&sheets, &workbook);

    // Modify property field in place (depth 3)
    modify_property_field(&doc, &sheets, &sheet_hex, cell_id, "bold", Any::Bool(true));

    let changes = observer.drain_all_changes();
    assert_eq!(
        changes.properties.len(),
        1,
        "in-place property modification should produce exactly one change"
    );
    assert_eq!(changes.properties[0].sheet_id, sheet_id);
    assert_eq!(changes.properties[0].cell_id, cell_id);
    assert_eq!(changes.properties[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_merge_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_MERGES);

    // Insert a merge entry as a nested map
    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_MERGES,
        "A1:B2",
        &[("rows", Any::Number(2.0))],
    );

    let observer = new_observer(&sheets, &workbook);

    // Modify merge field in place (depth 3)
    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_MERGES,
        "A1:B2",
        "rows",
        Any::Number(3.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(
        changes.merges.len(),
        1,
        "in-place merge modification should produce exactly one change"
    );
    assert_eq!(changes.merges[0].sheet_id, sheet_id);
    assert_eq!(changes.merges[0].key, "A1:B2");
    assert_eq!(changes.merges[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_comment_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_COMMENTS);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COMMENTS,
        "comment-1",
        &[("text", Any::String(Arc::from("hello")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COMMENTS,
        "comment-1",
        "text",
        Any::String(Arc::from("updated")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.comments.len(), 1);
    assert_eq!(changes.comments[0].sheet_id, sheet_id);
    assert_eq!(changes.comments[0].key, "comment-1");
    assert_eq!(changes.comments[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_floating_object_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_FLOATING_OBJECTS);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FLOATING_OBJECTS,
        "chart-1",
        &[("type", Any::String(Arc::from("line")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FLOATING_OBJECTS,
        "chart-1",
        "type",
        Any::String(Arc::from("bar")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.floating_objects.len(), 1);
    assert_eq!(changes.floating_objects[0].sheet_id, sheet_id);
    assert_eq!(changes.floating_objects[0].object_id, "chart-1");
    assert_eq!(changes.floating_objects[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_sheet_meta_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PROPERTIES);

    // Insert meta as a nested map with a field
    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PROPERTIES,
        "settings",
        &[("zoom", Any::Number(100.0))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PROPERTIES,
        "settings",
        "zoom",
        Any::Number(150.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.sheet_meta.len(), 1);
    assert_eq!(changes.sheet_meta[0].sheet_id, sheet_id);
    assert_eq!(changes.sheet_meta[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_filter_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_FILTERS);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FILTERS,
        "filter-1",
        &[("col", Any::Number(0.0))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_FILTERS,
        "filter-1",
        "col",
        Any::Number(1.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.filters.len(), 1);
    assert_eq!(changes.filters[0].sheet_id, sheet_id);
    assert_eq!(changes.filters[0].key, Some("filter-1".to_string()));
    assert_eq!(changes.filters[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_grouping_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_GROUPING);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_GROUPING,
        "group-1",
        &[("level", Any::Number(1.0))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_GROUPING,
        "group-1",
        "level",
        Any::Number(2.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.grouping.len(), 1);
    assert_eq!(changes.grouping[0].sheet_id, sheet_id);
    assert_eq!(changes.grouping[0].key, Some("group-1".to_string()));
    assert_eq!(changes.grouping[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_sparkline_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_SPARKLINES);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_SPARKLINES,
        "spark-1",
        &[("type", Any::String(Arc::from("line")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_SPARKLINES,
        "spark-1",
        "type",
        Any::String(Arc::from("bar")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.sparklines.len(), 1);
    assert_eq!(changes.sparklines[0].sheet_id, sheet_id);
    assert_eq!(changes.sparklines[0].key, Some("spark-1".to_string()));
    assert_eq!(changes.sparklines[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_conditional_format_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_CONDITIONAL_FORMAT);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_CONDITIONAL_FORMAT,
        "cf-1",
        &[("rule", Any::String(Arc::from("greaterThan")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_CONDITIONAL_FORMAT,
        "cf-1",
        "rule",
        Any::String(Arc::from("lessThan")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.conditional_formats.len(), 1);
    assert_eq!(changes.conditional_formats[0].sheet_id, sheet_id);
    assert_eq!(changes.conditional_formats[0].key, Some("cf-1".to_string()));
    assert_eq!(
        changes.conditional_formats[0].kind,
        CellChangeKind::Modified
    );
}

#[test]
fn test_sorting_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_SORTING);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_SORTING,
        "sort-1",
        &[("order", Any::String(Arc::from("asc")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_SORTING,
        "sort-1",
        "order",
        Any::String(Arc::from("desc")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.sorting.len(), 1);
    assert_eq!(changes.sorting[0].sheet_id, sheet_id);
    assert_eq!(changes.sorting[0].key, Some("sort-1".to_string()));
    assert_eq!(changes.sorting[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_row_format_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_FORMATS);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_ROW_FORMATS,
        "row-0",
        &[("bold", Any::Bool(false))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_ROW_FORMATS,
        "row-0",
        "bold",
        Any::Bool(true),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.row_formats.len(), 1);
    assert_eq!(changes.row_formats[0].sheet_id, sheet_id);
    assert_eq!(changes.row_formats[0].key, Some("row-0".to_string()));
    assert_eq!(changes.row_formats[0].kind, CellChangeKind::Modified);
}

#[test]
fn test_col_format_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_COL_FORMATS);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COL_FORMATS,
        "col-A",
        &[("width", Any::Number(100.0))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_COL_FORMATS,
        "col-A",
        "width",
        Any::Number(200.0),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.col_formats.len(), 1);
    assert_eq!(changes.col_formats[0].sheet_id, sheet_id);
    assert_eq!(changes.col_formats[0].key, Some("col-A".to_string()));
    assert_eq!(changes.col_formats[0].kind, CellChangeKind::Modified);
}

use super::*;
use crate::hex::{hex_to_id, id_to_hex, parse_cell_id, parse_sheet_id};
use crate::schema::*;
use crate::undo::{ORIGIN_FORMULA_RESULT, ORIGIN_REMOTE, ORIGIN_USER_EDIT};
use cell_types::{CellId, SheetId};
use std::sync::Arc;
use value_types::CellValue;
use yrs::{Any, Doc, Map, MapPrelim, Out, Transact};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Assert that a `CellChange` matches the expected base fields (ignoring `old_value`).
fn assert_cell_change_base(
    actual: &CellChange,
    sheet_id: SheetId,
    cell_id: CellId,
    kind: CellChangeKind,
) {
    assert_eq!(actual.sheet_id, sheet_id, "sheet_id mismatch");
    assert_eq!(actual.cell_id, cell_id, "cell_id mismatch");
    assert_eq!(actual.kind, kind, "kind mismatch");
}

/// Check if a `Vec<CellChange>` contains an entry matching the base fields.
fn contains_cell_change(
    changes: &[CellChange],
    sheet_id: SheetId,
    cell_id: CellId,
    kind: CellChangeKind,
) -> bool {
    changes
        .iter()
        .any(|c| c.sheet_id == sheet_id && c.cell_id == cell_id && c.kind == kind)
}

/// Set up a Doc with the standard schema and return (doc, sheets_map, workbook_map).
fn setup_doc() -> (Doc, MapRef, MapRef) {
    let doc = Doc::new();
    let sheets = doc.get_or_insert_map("sheets");
    let workbook = doc.get_or_insert_map("workbook");
    (doc, sheets, workbook)
}

/// Add a sheet with a "cells" sub-map to the sheets map.
fn add_sheet(doc: &Doc, sheets: &MapRef, sheet_id: SheetId) -> String {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut();
    let sheet_map: MapRef = sheets.insert(
        &mut txn,
        &*sheet_hex,
        MapPrelim::from([] as [(&str, Any); 0]),
    );
    let _cells_map: MapRef =
        sheet_map.insert(&mut txn, "cells", MapPrelim::from([] as [(&str, Any); 0]));
    sheet_hex.to_string()
}

/// Add a sub-map to a sheet (for properties, merges, etc.).
fn add_sub_map(doc: &Doc, sheets: &MapRef, sheet_hex: &str, sub_map_key: &str) {
    let mut txn = doc.transact_mut();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        let _: MapRef = sheet_map.insert(
            &mut txn,
            sub_map_key,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }
}

/// Insert a cell into the cells map of a sheet.
fn insert_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    value: f64,
    formula: Option<&str>,
) {
    insert_cell_with_origin(doc, sheets, sheet_hex, cell_id, value, formula, None);
}

/// Insert a cell with a specific origin.
fn insert_cell_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    value: f64,
    formula: Option<&str>,
    origin: Option<&[u8]>,
) {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = match origin {
        Some(o) => doc.transact_mut_with(o),
        None => doc.transact_mut(),
    };
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
            let cell_prelim = match formula {
                Some(f) => {
                    MapPrelim::from([("v", Any::Number(value)), ("f", Any::String(Arc::from(f)))])
                }
                None => MapPrelim::from([("v", Any::Number(value))]),
            };
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }
    }
}

/// Remove a cell from the cells map of a sheet.
fn remove_cell(doc: &Doc, sheets: &MapRef, sheet_hex: &str, cell_id: CellId) {
    remove_cell_with_origin(doc, sheets, sheet_hex, cell_id, None);
}

/// Remove a cell with a specific origin.
fn remove_cell_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    origin: Option<&[u8]>,
) {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = match origin {
        Some(o) => doc.transact_mut_with(o),
        None => doc.transact_mut(),
    };
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
            cells_map.remove(&mut txn, &cell_hex);
        }
    }
}

/// Modify a cell's value in-place (depth 3 — updates the "v" key within the
/// existing cell map, rather than replacing the whole cell entry).
fn modify_cell_value_in_place(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    new_value: f64,
) {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = doc.transact_mut();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
            if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &*cell_hex) {
                cell_map.insert(&mut txn, crate::schema::KEY_VALUE, Any::Number(new_value));
            }
        }
    }
}

/// Insert an entry into a sub-map of a sheet.
fn insert_sub_map_entry(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
    value: Any,
) {
    insert_sub_map_entry_with_origin(doc, sheets, sheet_hex, sub_map_key, entry_key, value, None);
}

fn insert_sub_map_entry_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
    value: Any,
    origin: Option<&[u8]>,
) {
    let mut txn = match origin {
        Some(o) => doc.transact_mut_with(o),
        None => doc.transact_mut(),
    };
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
            sub_map.insert(&mut txn, entry_key, value);
        }
    }
}

/// Insert a nested map entry into a sub-map (for pivotTables, floatingObjects, etc.).
fn insert_sub_map_map_entry(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
    fields: &[(&str, Any)],
) {
    insert_sub_map_map_entry_with_origin(
        doc,
        sheets,
        sheet_hex,
        sub_map_key,
        entry_key,
        fields,
        None,
    );
}

fn insert_sub_map_map_entry_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
    fields: &[(&str, Any)],
    origin: Option<&[u8]>,
) {
    let mut txn = match origin {
        Some(o) => doc.transact_mut_with(o),
        None => doc.transact_mut(),
    };
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
            let entry: MapRef =
                sub_map.insert(&mut txn, entry_key, MapPrelim::from([] as [(&str, Any); 0]));
            for (k, v) in fields {
                entry.insert(&mut txn, *k, v.clone());
            }
        }
    }
}

/// Remove an entry from a sub-map.
fn remove_sub_map_entry(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
) {
    let mut txn = doc.transact_mut();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
            sub_map.remove(&mut txn, entry_key);
        }
    }
}

/// Update a field within a nested map entry in a sub-map.
fn update_sub_map_map_field(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
    field: &str,
    value: Any,
) {
    let mut txn = doc.transact_mut();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
            if let Some(Out::YMap(entry_map)) = sub_map.get(&txn, entry_key) {
                entry_map.insert(&mut txn, field, value);
            }
        }
    }
}

fn new_observer(sheets: &MapRef, workbook: &MapRef) -> DocumentObserver {
    DocumentObserver::new(sheets, workbook)
}

// -----------------------------------------------------------------------
// Test 1: Observer detects cell addition
// -----------------------------------------------------------------------

#[test]
fn test_observer_detects_cell_addition() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);
    assert!(!observer.has_changes());

    let cell_id = make_cell_id(100);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
    // Insert has no old value.
    assert!(changes[0].old_value.is_none());
}

// -----------------------------------------------------------------------
// Test 2: Observer detects cell modification
// -----------------------------------------------------------------------

#[test]
fn test_observer_detects_cell_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let cell_id = make_cell_id(200);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 10.0, None);

    let observer = new_observer(&sheets, &workbook);

    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 20.0, Some("=A1+10"));

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
    // Depth-2 update: old YMap is orphaned after replacement, so old_value is None.
    // Old values are captured at depth 3 (in-place field modifications) instead.
    assert!(changes[0].old_value.is_none());
}

// -----------------------------------------------------------------------
// Test 3: Observer detects cell removal
// -----------------------------------------------------------------------

#[test]
fn test_observer_detects_cell_removal() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let cell_id = make_cell_id(300);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

    let observer = new_observer(&sheets, &workbook);

    remove_cell(&doc, &sheets, &sheet_hex, cell_id);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Removed);
    // Depth-2 removal: old YMap is orphaned, so old_value is None.
    assert!(changes[0].old_value.is_none());
}

// -----------------------------------------------------------------------
// Test 4: Observer ignores formula-result origin changes
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 5: Observer handles multiple cell changes in one transaction
// -----------------------------------------------------------------------

#[test]
fn test_observer_multiple_changes_one_transaction() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let cell_remove = make_cell_id(503);
    insert_cell(&doc, &sheets, &sheet_hex, cell_remove, 0.0, None);

    let observer = new_observer(&sheets, &workbook);

    {
        let cell_hex_1 = id_to_hex(make_cell_id(501).as_u128());
        let cell_hex_2 = id_to_hex(make_cell_id(502).as_u128());
        let cell_hex_3 = id_to_hex(cell_remove.as_u128());

        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                cells_map.insert(
                    &mut txn,
                    &*cell_hex_1,
                    MapPrelim::from([("v", Any::Number(1.0))]),
                );
                cells_map.insert(
                    &mut txn,
                    &*cell_hex_2,
                    MapPrelim::from([("v", Any::Number(2.0))]),
                );
                cells_map.remove(&mut txn, &cell_hex_3);
            }
        }
    }

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 3, "expected 3 changes, got: {:?}", changes);

    let modified_count = changes
        .iter()
        .filter(|c| c.kind == CellChangeKind::Modified)
        .count();
    let removed_count = changes
        .iter()
        .filter(|c| c.kind == CellChangeKind::Removed)
        .count();
    assert_eq!(modified_count, 2);
    assert_eq!(removed_count, 1);

    assert!(contains_cell_change(
        &changes,
        sheet_id,
        make_cell_id(501),
        CellChangeKind::Modified
    ));
    assert!(contains_cell_change(
        &changes,
        sheet_id,
        make_cell_id(502),
        CellChangeKind::Modified
    ));
    assert!(contains_cell_change(
        &changes,
        sheet_id,
        cell_remove,
        CellChangeKind::Removed
    ));
}

// -----------------------------------------------------------------------
// Test 6: drain_changes clears the buffer
// -----------------------------------------------------------------------

#[test]
fn test_drain_clears_buffer() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    insert_cell(&doc, &sheets, &sheet_hex, make_cell_id(600), 1.0, None);
    assert_eq!(observer.pending_count(), 1);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);

    assert!(!observer.has_changes());
    assert_eq!(observer.pending_count(), 0);
    assert!(observer.drain_changes().is_empty());
}

// -----------------------------------------------------------------------
// Test 7: User-edit origin is observed
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 8: Remote origin is observed
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 9: Changes across multiple sheets
// -----------------------------------------------------------------------

#[test]
fn test_changes_across_multiple_sheets() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet1 = make_sheet_id(1);
    let sheet2 = make_sheet_id(2);
    let hex1 = add_sheet(&doc, &sheets, sheet1);
    let hex2 = add_sheet(&doc, &sheets, sheet2);

    let observer = new_observer(&sheets, &workbook);

    insert_cell(&doc, &sheets, &hex1, make_cell_id(901), 1.0, None);
    insert_cell(&doc, &sheets, &hex2, make_cell_id(902), 2.0, None);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 2);

    assert!(changes.contains(&CellChange {
        sheet_id: sheet1,
        cell_id: make_cell_id(901),
        kind: CellChangeKind::Modified,
        old_value: None,
    }));
    assert!(changes.contains(&CellChange {
        sheet_id: sheet2,
        cell_id: make_cell_id(902),
        kind: CellChangeKind::Modified,
        old_value: None,
    }));
}

// -----------------------------------------------------------------------
// Test 10: Debug formatting
// -----------------------------------------------------------------------

#[test]
fn test_debug_format() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let debug = format!("{:?}", observer);
    assert!(debug.contains("DocumentObserver"));
    assert!(debug.contains("pending_changes: 0"));

    insert_cell(&doc, &sheets, &sheet_hex, make_cell_id(1000), 1.0, None);
    let debug = format!("{:?}", observer);
    assert!(debug.contains("pending_changes: 1"));
}

// -----------------------------------------------------------------------
// Test: Old value capture — depth 3 (in-place value modification)
// -----------------------------------------------------------------------

#[test]
fn test_old_value_capture_depth3_modify_in_place() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let cell_id = make_cell_id(5000);
    // Insert initial cell with value 42.0 (before observer starts).
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

    let observer = new_observer(&sheets, &workbook);

    // Modify the "v" key in-place (depth 3 change).
    modify_cell_value_in_place(&doc, &sheets, &sheet_hex, cell_id, 100.0);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
    assert_eq!(
        changes[0].old_value,
        Some(CellValue::number(42.0)),
        "depth-3 modification should capture old value from 'v' field"
    );
}

// -----------------------------------------------------------------------
// Test: Old value capture — depth 2 (cell re-insertion / full replacement)
// -----------------------------------------------------------------------

#[test]
fn test_old_value_capture_depth2_cell_replacement() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let cell_id = make_cell_id(5001);
    // Insert initial cell with text value before observer.
    {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                cells_map.insert(
                    &mut txn,
                    &*cell_hex,
                    MapPrelim::from([("v", Any::String(Arc::from("hello")))]),
                );
            }
        }
    }

    let observer = new_observer(&sheets, &workbook);

    // Replace with a numeric value (depth 2 — whole cell entry replaced).
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);
    assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
    // Depth-2 replacement: old YMap is orphaned after replacement, old_value is None.
    assert!(changes[0].old_value.is_none());
}

// -----------------------------------------------------------------------
// Test 11: No origin (None) is observed
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 12: Hex parsing helpers
// -----------------------------------------------------------------------

#[test]
fn test_hex_parsing() {
    let id: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
    let hex = format!("{:032x}", id);
    assert_eq!(hex_to_id(&hex), Some(id));

    assert!(parse_sheet_id(&hex).is_some());
    assert!(parse_cell_id(&hex).is_some());

    assert_eq!(hex_to_id("not_hex"), None);
    assert!(parse_sheet_id("zzz").is_none());
    assert!(parse_cell_id("zzz").is_none());
}

// ===================================================================
// Step 5: Domain-specific tests
// ===================================================================

// -----------------------------------------------------------------------
// Test 5a: Cell change via drain_all_changes (regression)
// -----------------------------------------------------------------------

#[test]
fn test_drain_all_changes_cells() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let cell_id = make_cell_id(5001);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

    let changes = observer.drain_all_changes();
    assert_eq!(changes.cells.len(), 1);
    assert_eq!(changes.cells[0].sheet_id, sheet_id);
    assert_eq!(changes.cells[0].cell_id, cell_id);
    assert_eq!(changes.cells[0].kind, CellChangeKind::Modified);
    assert!(!changes.has_non_cell_changes());
}

// -----------------------------------------------------------------------
// Test 5b: Property change
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 5c: Row height change
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 5d: Merge change
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 5e: Undo property change detection
// (simulated: write then remove = undo-like behavior)
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 5f: ORIGIN_FORMULA_RESULT filtering for ALL sub-maps
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Test 5g: Workbook-level table change
// -----------------------------------------------------------------------

#[test]
fn test_workbook_table_change() {
    let (doc, sheets, workbook) = setup_doc();

    // Create tables sub-map in workbook
    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_TABLES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    // Insert a table entry
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(tables_map)) = workbook.get(&txn, KEY_TABLES) {
            let table_entry: MapRef = tables_map.insert(
                &mut txn,
                "table-001",
                MapPrelim::from([] as [(&str, Any); 0]),
            );
            table_entry.insert(&mut txn, "name", Any::String(Arc::from("SalesData")));
        }
    }

    let changes = observer.drain_all_changes();
    assert!(
        !changes.tables.is_empty(),
        "expected table change, got empty"
    );
    assert!(changes.tables.iter().any(|t| t.key == "table-001"));
}

#[test]
fn test_workbook_table_range_binding_change() {
    let (doc, sheets, workbook) = setup_doc();

    // Table metadata is now persisted primarily in workbook.rangeBindings
    // using table:<name> keys. The observer must route those entries through
    // the table domain so engines rebuild their table mirror after sync.
    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_RANGE_BINDINGS,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(bindings)) = workbook.get(&txn, KEY_RANGE_BINDINGS) {
            bindings.insert(
                &mut txn,
                "table:SalesData",
                Any::String(Arc::from(r#"{"name":"SalesData"}"#)),
            );
            bindings.insert(
                &mut txn,
                "cf:rule-1",
                Any::String(Arc::from(r#"{"ruleRef":"rule-1"}"#)),
            );
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.tables.len(), 1);
    assert_eq!(changes.tables[0].key, "table:SalesData");
    assert_eq!(changes.tables[0].kind, CellChangeKind::Modified);
}

// -----------------------------------------------------------------------
// Test 5h: Pivot changes detected via DocumentObserver (PivotObserver absorbed)
// -----------------------------------------------------------------------

#[test]
fn test_pivot_changes_via_document_observer() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

    let observer = new_observer(&sheets, &workbook);
    assert!(!observer.has_changes());

    // Insert a pivot table
    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-001",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.pivot_tables.len(), 1);
    assert_eq!(changes.pivot_tables[0].sheet_id, sheet_id);
    assert_eq!(changes.pivot_tables[0].pivot_id, "pivot-001");
    assert_eq!(changes.pivot_tables[0].kind, CellChangeKind::Modified);
}

// -----------------------------------------------------------------------
// Pivot backward compat: drain_pivot_changes
// -----------------------------------------------------------------------

#[test]
fn test_drain_pivot_changes_backward_compat() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-002",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );

    let legacy_changes = observer.drain_pivot_changes();
    assert_eq!(legacy_changes.len(), 1);
    assert_eq!(
        legacy_changes[0],
        PivotChange {
            sheet_id,
            pivot_id: "pivot-002".into(),
            kind: PivotChangeKind::Set,
        }
    );
}

// -----------------------------------------------------------------------
// Pivot removal via DocumentObserver
// -----------------------------------------------------------------------

#[test]
fn test_pivot_removal_via_document_observer() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);
    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-003",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );

    let observer = new_observer(&sheets, &workbook);

    remove_sub_map_entry(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES, "pivot-003");

    let legacy_changes = observer.drain_pivot_changes();
    assert_eq!(legacy_changes.len(), 1);
    assert_eq!(
        legacy_changes[0],
        PivotChange {
            sheet_id,
            pivot_id: "pivot-003".into(),
            kind: PivotChangeKind::Removed,
        }
    );
}

// -----------------------------------------------------------------------
// Pivot update (in-place field change)
// -----------------------------------------------------------------------

#[test]
fn test_pivot_update_via_document_observer() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);
    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-004",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-004",
        "sourceRange",
        Any::String(Arc::from("A1:F20")),
    );

    let legacy_changes = observer.drain_pivot_changes();
    assert_eq!(legacy_changes.len(), 1);
    assert_eq!(
        legacy_changes[0],
        PivotChange {
            sheet_id,
            pivot_id: "pivot-004".into(),
            kind: PivotChangeKind::Set,
        }
    );
}

// -----------------------------------------------------------------------
// Pivot: formula-result origin filtered
// -----------------------------------------------------------------------

#[test]
fn test_pivot_ignores_formula_result() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-fr",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        Some(ORIGIN_FORMULA_RESULT),
    );

    let changes = observer.drain_pivot_changes();
    assert!(
        changes.is_empty(),
        "formula-result pivot changes should be ignored"
    );
}

// -----------------------------------------------------------------------
// Pivot: user-edit origin is observed
// -----------------------------------------------------------------------

#[test]
fn test_pivot_user_edit_observed() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_map_entry_with_origin(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-ue",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        Some(ORIGIN_USER_EDIT),
    );

    let changes = observer.drain_pivot_changes();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].kind, PivotChangeKind::Set);
}

// -----------------------------------------------------------------------
// Pivot: multiple pivots across sheets
// -----------------------------------------------------------------------

#[test]
fn test_pivot_multiple_sheets() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet1 = make_sheet_id(1);
    let sheet2 = make_sheet_id(2);
    let hex1 = add_sheet(&doc, &sheets, sheet1);
    let hex2 = add_sheet(&doc, &sheets, sheet2);
    add_sub_map(&doc, &sheets, &hex1, KEY_PIVOT_TABLES);
    add_sub_map(&doc, &sheets, &hex2, KEY_PIVOT_TABLES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &hex1,
        KEY_PIVOT_TABLES,
        "pA",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );
    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &hex2,
        KEY_PIVOT_TABLES,
        "pB",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );

    let changes = observer.drain_pivot_changes();
    assert_eq!(changes.len(), 2);

    assert!(changes.contains(&PivotChange {
        sheet_id: sheet1,
        pivot_id: "pA".into(),
        kind: PivotChangeKind::Set,
    }));
    assert!(changes.contains(&PivotChange {
        sheet_id: sheet2,
        pivot_id: "pB".into(),
        kind: PivotChangeKind::Set,
    }));
}

// -----------------------------------------------------------------------
// Pivot: drain clears buffer
// -----------------------------------------------------------------------

#[test]
fn test_pivot_drain_clears() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

    let observer = new_observer(&sheets, &workbook);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pX",
        &[("sourceRange", Any::String(Arc::from("A1:D10")))],
    );

    let changes = observer.drain_pivot_changes();
    assert_eq!(changes.len(), 1);

    // Buffer should now be clear for pivots
    assert!(observer.drain_pivot_changes().is_empty());
}

// -----------------------------------------------------------------------
// Internal indexes do NOT produce changes
// -----------------------------------------------------------------------

#[test]
fn test_internal_indexes_ignored() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    // Add internal index sub-maps
    add_sub_map(&doc, &sheets, &sheet_hex, "gridIndex");
    add_sub_map(&doc, &sheets, &sheet_hex, "rowIndex");
    add_sub_map(&doc, &sheets, &sheet_hex, "colIndex");

    let observer = new_observer(&sheets, &workbook);

    // Write to internal indexes
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        "gridIndex",
        "key1",
        Any::Number(1.0),
    );
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        "rowIndex",
        "key2",
        Any::Number(2.0),
    );
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        "colIndex",
        "key3",
        Any::Number(3.0),
    );

    let changes = observer.drain_all_changes();
    assert!(
        changes.is_empty(),
        "internal index changes should not produce DocumentChanges, got non-empty"
    );
}

// -----------------------------------------------------------------------
// Floating object changes
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Hidden rows/cols changes
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Comment changes
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Sheet-level changes: filters, grouping, sparklines, etc.
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Sheet meta change
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Col width changes
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Row/col format changes
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Sorting change
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// DocumentChanges::is_empty and has_non_cell_changes
// -----------------------------------------------------------------------

#[test]
fn test_document_changes_is_empty() {
    let dc = DocumentChanges::default();
    assert!(dc.is_empty());
    assert!(!dc.has_non_cell_changes());
}

#[test]
fn test_document_changes_has_non_cell_changes() {
    let mut dc = DocumentChanges::default();
    dc.cells.push(CellChange {
        sheet_id: make_sheet_id(1),
        cell_id: make_cell_id(1),
        kind: CellChangeKind::Modified,
        old_value: None,
    });
    assert!(!dc.is_empty());
    assert!(!dc.has_non_cell_changes());

    dc.properties.push(PropertyCellChange {
        sheet_id: make_sheet_id(1),
        cell_id: make_cell_id(1),
        kind: CellChangeKind::Modified,
    });
    assert!(dc.has_non_cell_changes());
}

// -----------------------------------------------------------------------
// Workbook-level named ranges
// -----------------------------------------------------------------------

#[test]
fn test_workbook_named_range_change() {
    let (doc, sheets, workbook) = setup_doc();

    // Create namedRanges sub-map in workbook
    {
        let mut txn = doc.transact_mut();
        let _: MapRef = workbook.insert(
            &mut txn,
            KEY_NAMED_RANGES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    let observer = new_observer(&sheets, &workbook);

    // Insert a named range
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(nr_map)) = workbook.get(&txn, KEY_NAMED_RANGES) {
            nr_map.insert(&mut txn, "MyRange", Any::String(Arc::from("Sheet1!A1:B10")));
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.named_ranges.len(), 1);
    assert_eq!(changes.named_ranges[0].key, Some("MyRange".to_string()));
}

// -----------------------------------------------------------------------
// Workbook-level table: formula-result origin filtered
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Suppression tests
// -----------------------------------------------------------------------

#[test]
fn test_set_suppressed_true_makes_is_suppressed_true() {
    let (_doc, sheets, workbook) = setup_doc();
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);
    assert!(observer.is_suppressed());
}

#[test]
fn test_set_suppressed_false_makes_is_suppressed_false() {
    let (_doc, sheets, workbook) = setup_doc();
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);
    observer.set_suppressed(false);
    assert!(!observer.is_suppressed());
}

#[test]
fn test_nested_suppression() {
    let (_doc, sheets, workbook) = setup_doc();
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);
    observer.set_suppressed(true);
    assert!(observer.is_suppressed(), "still suppressed after two trues");

    observer.set_suppressed(false);
    assert!(
        observer.is_suppressed(),
        "still suppressed after one false (need two)"
    );

    observer.set_suppressed(false);
    assert!(
        !observer.is_suppressed(),
        "unsuppressed after matching two falses"
    );
}

#[test]
fn test_changes_during_suppression_not_recorded() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(100);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);

    // Insert a cell while suppressed — should NOT be recorded.
    let cell_id = make_cell_id(200);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

    let changes = observer.drain_all_changes();
    assert!(
        changes.cells.is_empty(),
        "no cell changes should be recorded while suppressed"
    );

    observer.set_suppressed(false);
}

#[test]
fn test_changes_after_unsuppression_are_recorded() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(101);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    let observer = new_observer(&sheets, &workbook);

    // Suppress and unsuppress.
    observer.set_suppressed(true);
    observer.set_suppressed(false);

    // Insert a cell after unsuppression — should be recorded.
    let cell_id = make_cell_id(201);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

    let changes = observer.drain_all_changes();
    assert!(
        !changes.cells.is_empty(),
        "cell changes should be recorded after unsuppression"
    );
}

// =======================================================================
// Depth-3 in-place modification tests
//
// These cover the path.len() == 3 branches in the observer callback,
// where a field *inside* an existing nested map entry is modified
// (as opposed to adding/removing entries from a sub-map at depth 2).
// =======================================================================

/// Helper: modify a field inside an existing cell's map (depth-3 change).
fn modify_cell_field(
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
        if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
            if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) {
                cell_map.insert(&mut txn, field, value);
            }
        }
    }
}

/// Helper: modify a field inside an existing property cell's map (depth-3).
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

// -----------------------------------------------------------------------
// Depth-3: Cell in-place modification
// -----------------------------------------------------------------------

#[test]
fn test_cell_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let cell_id = make_cell_id(901);
    // First insert the cell (depth-2 add)
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 1.0, None);

    let observer = new_observer(&sheets, &workbook);

    // Now modify the cell's value field in place (depth-3 change)
    modify_cell_field(&doc, &sheets, &sheet_hex, cell_id, "v", Any::Number(2.0));

    let changes = observer.drain_all_changes();
    assert_eq!(
        changes.cells.len(),
        1,
        "in-place cell modification should produce exactly one change"
    );
    assert_eq!(changes.cells[0].sheet_id, sheet_id);
    assert_eq!(changes.cells[0].cell_id, cell_id);
    assert_eq!(changes.cells[0].kind, CellChangeKind::Modified);
}

// -----------------------------------------------------------------------
// Depth-3: Property in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Merge in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Comment in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Floating object in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Pivot table in-place modification
// -----------------------------------------------------------------------

#[test]
fn test_pivot_table_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

    insert_sub_map_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-1",
        &[("source", Any::String(Arc::from("Sheet1!A1:D10")))],
    );

    let observer = new_observer(&sheets, &workbook);

    update_sub_map_map_field(
        &doc,
        &sheets,
        &sheet_hex,
        KEY_PIVOT_TABLES,
        "pivot-1",
        "source",
        Any::String(Arc::from("Sheet1!A1:E20")),
    );

    let changes = observer.drain_all_changes();
    assert_eq!(changes.pivot_tables.len(), 1);
    assert_eq!(changes.pivot_tables[0].sheet_id, sheet_id);
    assert_eq!(changes.pivot_tables[0].pivot_id, "pivot-1");
    assert_eq!(changes.pivot_tables[0].kind, CellChangeKind::Modified);
}

// -----------------------------------------------------------------------
// Depth-3: Sheet meta in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Sheet-level change (filters) via push_sheet_level_change
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Grouping in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Sparkline in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Conditional format in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Sorting in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Row format in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Col format in-place modification
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Depth-3: Workbook table in-place modification
// -----------------------------------------------------------------------

#[test]
fn test_workbook_table_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();

    // Insert a table entry at depth 1
    {
        let mut txn = doc.transact_mut();
        let tables: MapRef = workbook.insert(
            &mut txn,
            KEY_TABLES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        let entry: MapRef =
            tables.insert(&mut txn, "table-1", MapPrelim::from([] as [(&str, Any); 0]));
        entry.insert(&mut txn, "range", Any::String(Arc::from("A1:D10")));
    }

    let observer = new_observer(&sheets, &workbook);

    // Modify table field in place (depth 2 in workbook = path.len() == 2)
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(tables)) = workbook.get(&txn, KEY_TABLES) {
            if let Some(Out::YMap(entry)) = tables.get(&txn, "table-1") {
                entry.insert(&mut txn, "range", Any::String(Arc::from("A1:E20")));
            }
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.tables.len(), 1);
    assert_eq!(changes.tables[0].key, "table-1");
    assert_eq!(changes.tables[0].kind, CellChangeKind::Modified);
}

// -----------------------------------------------------------------------
// Depth-3: Workbook named range in-place modification
// -----------------------------------------------------------------------

#[test]
fn test_workbook_named_range_in_place_modification() {
    let (doc, sheets, workbook) = setup_doc();

    // Insert a named range entry
    {
        let mut txn = doc.transact_mut();
        let named: MapRef = workbook.insert(
            &mut txn,
            KEY_NAMED_RANGES,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        let entry: MapRef =
            named.insert(&mut txn, "MyRange", MapPrelim::from([] as [(&str, Any); 0]));
        entry.insert(&mut txn, "ref", Any::String(Arc::from("Sheet1!A1:B5")));
    }

    let observer = new_observer(&sheets, &workbook);

    // Modify named range field in place
    {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(named)) = workbook.get(&txn, KEY_NAMED_RANGES) {
            if let Some(Out::YMap(entry)) = named.get(&txn, "MyRange") {
                entry.insert(&mut txn, "ref", Any::String(Arc::from("Sheet1!A1:C10")));
            }
        }
    }

    let changes = observer.drain_all_changes();
    assert_eq!(changes.named_ranges.len(), 1);
    assert_eq!(changes.named_ranges[0].key, Some("MyRange".to_string()));
    assert_eq!(changes.named_ranges[0].kind, CellChangeKind::Modified);
}

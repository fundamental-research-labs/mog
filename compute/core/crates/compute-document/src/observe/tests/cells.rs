use super::super::{CellChange, CellChangeKind};
use super::assertions::{assert_cell_change_base, contains_cell_change};
use super::fixtures::*;
use crate::hex::id_to_hex;
use cell_types::CellId;
use std::sync::Arc;
use value_types::CellValue;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Out, Transact};

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

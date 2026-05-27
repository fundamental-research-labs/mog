use super::super::{CellChangeKind, PivotChange, PivotChangeKind};
use super::fixtures::*;
use crate::schema::KEY_PIVOT_TABLES;
use crate::undo::{ORIGIN_FORMULA_RESULT, ORIGIN_USER_EDIT};
use std::sync::Arc;
use yrs::Any;

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

use super::super::DocumentObserver;
use crate::hex::id_to_hex;
use crate::schema::KEY_VALUE;
use cell_types::{CellId, SheetId};
use std::sync::Arc;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Out, Transact};

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

pub(super) fn setup_doc() -> (Doc, MapRef, MapRef) {
    let doc = Doc::new();
    let sheets = doc.get_or_insert_map("sheets");
    let workbook = doc.get_or_insert_map("workbook");
    (doc, sheets, workbook)
}

pub(super) fn add_sheet(doc: &Doc, sheets: &MapRef, sheet_id: SheetId) -> String {
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

pub(super) fn add_sub_map(doc: &Doc, sheets: &MapRef, sheet_hex: &str, sub_map_key: &str) {
    let mut txn = doc.transact_mut();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
        let _: MapRef = sheet_map.insert(
            &mut txn,
            sub_map_key,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }
}

pub(super) fn insert_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    value: f64,
    formula: Option<&str>,
) {
    insert_cell_with_origin(doc, sheets, sheet_hex, cell_id, value, formula, None);
}

pub(super) fn insert_cell_with_origin(
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

pub(super) fn remove_cell(doc: &Doc, sheets: &MapRef, sheet_hex: &str, cell_id: CellId) {
    remove_cell_with_origin(doc, sheets, sheet_hex, cell_id, None);
}

pub(super) fn remove_cell_with_origin(
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

pub(super) fn modify_cell_value_in_place(
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
                cell_map.insert(&mut txn, KEY_VALUE, Any::Number(new_value));
            }
        }
    }
}

pub(super) fn insert_sub_map_entry(
    doc: &Doc,
    sheets: &MapRef,
    sheet_hex: &str,
    sub_map_key: &str,
    entry_key: &str,
    value: Any,
) {
    insert_sub_map_entry_with_origin(doc, sheets, sheet_hex, sub_map_key, entry_key, value, None);
}

pub(super) fn insert_sub_map_entry_with_origin(
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

pub(super) fn insert_sub_map_map_entry(
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

pub(super) fn insert_sub_map_map_entry_with_origin(
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

pub(super) fn remove_sub_map_entry(
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

pub(super) fn update_sub_map_map_field(
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

pub(super) fn new_observer(sheets: &MapRef, workbook: &MapRef) -> DocumentObserver {
    DocumentObserver::new(sheets, workbook)
}

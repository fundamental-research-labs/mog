//! Per-sheet visibility, tab color, and calculation toggle.
//!
//! Covers tab color, hidden state (plus the XLSX `veryHidden` tri-state),
//! sheet-enable-calculation toggle, and workbook-scoped visible/hidden
//! sheet list queries.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapRef, Origin, Transact};

use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema;

use super::yrs_helpers::{
    KEY_ENABLE_CALCULATION, KEY_HIDDEN, KEY_TAB_COLOR, get_meta_map, meta_bool, read_sheet_order,
};

/// Set the tab color for a sheet.
pub(crate) fn set_tab_color(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, color: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        match color {
            Some(c) => meta.insert(&mut txn, KEY_TAB_COLOR, Any::String(Arc::from(c))),
            None => meta.insert(&mut txn, KEY_TAB_COLOR, Any::Null),
        };
        update_modeled_tab_color(&mut txn, &meta, color);
    }
}

fn update_modeled_tab_color(txn: &mut yrs::TransactionMut, meta: &MapRef, color: Option<&str>) {
    let existing = meta
        .get(txn, yrs_schema::sheet_properties::PROPERTY_KEY)
        .and_then(|v| match v {
            yrs::Out::YMap(map) => yrs_schema::sheet_properties::from_yrs_map(&map, txn),
            _ => None,
        });

    let Some(color) = color else {
        if let Some(mut properties) = existing {
            properties.tab_color = None;
            if properties == Default::default() {
                meta.remove(txn, yrs_schema::sheet_properties::PROPERTY_KEY);
            } else {
                yrs_schema::sheet_properties::insert(txn, meta, &properties);
            }
        }
        return;
    };

    let mut properties = existing.unwrap_or_default();
    properties.tab_color = Some(tab_color_to_ooxml_color(color));
    yrs_schema::sheet_properties::insert(txn, meta, &properties);
}

fn tab_color_to_ooxml_color(color: &str) -> ooxml_types::styles::ColorDef {
    let hex = color.strip_prefix('#').unwrap_or(color);
    let argb = if hex.len() == 6 {
        format!("FF{hex}")
    } else {
        hex.to_string()
    };
    ooxml_types::styles::ColorDef::Rgb {
        val: argb,
        tint: None,
    }
}

/// Check if a sheet is hidden.
pub(crate) fn is_sheet_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> bool {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => meta_bool(&txn, &meta, KEY_HIDDEN, false),
        None => false,
    }
}

/// Set whether a sheet is hidden.
pub(crate) fn set_sheet_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, hidden: bool) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(&mut txn, KEY_HIDDEN, Any::Bool(hidden));
    }
}

/// Check if calculation is enabled for a sheet.
/// Defaults to `true` if the key is absent (new sheets have calculation enabled).
pub(crate) fn is_sheet_calculation_enabled(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> bool {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => meta_bool(&txn, &meta, KEY_ENABLE_CALCULATION, true),
        None => true,
    }
}

/// Set whether calculation is enabled for a sheet.
pub(crate) fn set_sheet_enable_calculation(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    enabled: bool,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(&mut txn, KEY_ENABLE_CALCULATION, Any::Bool(enabled));
    }
}

/// Set the visibility state of a sheet (visible, hidden, or veryHidden).
pub(crate) fn set_sheet_visibility(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, state: &str) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        match state {
            "visible" => {
                meta.insert(&mut txn, KEY_HIDDEN, Any::Bool(false));
                meta.insert(&mut txn, "veryHidden", Any::Bool(false));
            }
            "hidden" => {
                meta.insert(&mut txn, KEY_HIDDEN, Any::Bool(true));
                meta.insert(&mut txn, "veryHidden", Any::Bool(false));
            }
            "veryHidden" => {
                meta.insert(&mut txn, KEY_HIDDEN, Any::Bool(true));
                meta.insert(&mut txn, "veryHidden", Any::Bool(true));
            }
            _ => {
                // Default to visible for unknown states
                meta.insert(&mut txn, KEY_HIDDEN, Any::Bool(false));
                meta.insert(&mut txn, "veryHidden", Any::Bool(false));
            }
        }
    }
}

/// Get the visibility state of a sheet.
pub(crate) fn get_sheet_visibility(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> String {
    let txn = doc.transact();
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let hidden = meta_bool(&txn, &meta, KEY_HIDDEN, false);
        let very_hidden = meta_bool(&txn, &meta, "veryHidden", false);
        if very_hidden {
            "veryHidden".to_string()
        } else if hidden {
            "hidden".to_string()
        } else {
            "visible".to_string()
        }
    } else {
        "visible".to_string()
    }
}

/// Count the number of visible (non-hidden) sheets.
pub(crate) fn count_visible_sheets(doc: &Doc, workbook: &MapRef, sheets: &MapRef) -> u32 {
    let txn = doc.transact();
    let order = read_sheet_order(workbook, &txn);
    let mut count = 0u32;
    for sid in &order {
        if let Some(meta) = get_meta_map(&txn, sheets, sid)
            && !meta_bool(&txn, &meta, KEY_HIDDEN, false)
        {
            count += 1;
        }
    }
    count
}

/// Get IDs of all visible sheets (in order).
pub(crate) fn get_visible_sheets(doc: &Doc, workbook: &MapRef, sheets: &MapRef) -> Vec<SheetId> {
    let txn = doc.transact();
    let order = read_sheet_order(workbook, &txn);
    order
        .into_iter()
        .filter(|sid| {
            get_meta_map(&txn, sheets, sid)
                .map(|meta| !meta_bool(&txn, &meta, KEY_HIDDEN, false))
                .unwrap_or(false)
        })
        .collect()
}

/// Get IDs of all hidden sheets (in order).
pub(crate) fn get_hidden_sheets(doc: &Doc, workbook: &MapRef, sheets: &MapRef) -> Vec<SheetId> {
    let txn = doc.transact();
    let order = read_sheet_order(workbook, &txn);
    order
        .into_iter()
        .filter(|sid| {
            get_meta_map(&txn, sheets, sid)
                .map(|meta| meta_bool(&txn, &meta, KEY_HIDDEN, false))
                .unwrap_or(false)
        })
        .collect()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::storage::YrsStorage;
    use crate::storage::sheet::properties::get_sheet_meta;
    use crate::storage::sheet::test_support::{make_sheet_id, setup};

    #[test]
    fn test_tab_color() {
        let (storage, _mirror, sid) = setup();

        set_tab_color(storage.doc(), storage.sheets(), &sid, Some("#4285f4"));
        let meta = get_sheet_meta(storage.doc(), storage.sheets(), &sid).unwrap();
        assert_eq!(meta.tab_color, Some("#4285f4".to_string()));

        set_tab_color(storage.doc(), storage.sheets(), &sid, None);
        let meta = get_sheet_meta(storage.doc(), storage.sheets(), &sid).unwrap();
        assert!(meta.tab_color.is_none());
    }

    #[test]
    fn test_sheet_hidden() {
        let (storage, _mirror, sid) = setup();
        assert!(
            !get_sheet_meta(storage.doc(), storage.sheets(), &sid)
                .unwrap()
                .hidden
        );

        set_sheet_hidden(storage.doc(), storage.sheets(), &sid, true);
        assert!(
            get_sheet_meta(storage.doc(), storage.sheets(), &sid)
                .unwrap()
                .hidden
        );

        set_sheet_hidden(storage.doc(), storage.sheets(), &sid, false);
        assert!(
            !get_sheet_meta(storage.doc(), storage.sheets(), &sid)
                .unwrap()
                .hidden
        );
    }

    #[test]
    fn test_count_visible_sheets() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        assert_eq!(
            count_visible_sheets(storage.doc(), storage.workbook_map(), storage.sheets()),
            3
        );

        set_sheet_hidden(storage.doc(), storage.sheets(), &s2, true);
        assert_eq!(
            count_visible_sheets(storage.doc(), storage.workbook_map(), storage.sheets()),
            2
        );
    }

    #[test]
    fn test_visible_and_hidden_sheets() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        set_sheet_hidden(storage.doc(), storage.sheets(), &s2, true);

        assert_eq!(
            get_visible_sheets(storage.doc(), storage.workbook_map(), storage.sheets()),
            vec![s1, s3]
        );
        assert_eq!(
            get_hidden_sheets(storage.doc(), storage.workbook_map(), storage.sheets()),
            vec![s2]
        );
    }
}

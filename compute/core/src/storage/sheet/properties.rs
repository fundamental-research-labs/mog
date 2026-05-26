//! Per-sheet identity and dimension properties.
//!
//! Handles name, rename, dimensions, first-sheet lookup, and the
//! "SheetN" unique-name generator. Companion to the per-sheet `meta`
//! Y.Map, where the name and dimension keys live.

use std::sync::Arc;

use yrs::{Any, Array, Doc, Map, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::schema::KEY_NAME;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::sheet::SheetMeta;

use super::yrs_helpers::{
    KEY_DEFAULT_COL_WIDTH, KEY_DEFAULT_ROW_HEIGHT, KEY_FROZEN_COLS, KEY_FROZEN_ROWS, KEY_HIDDEN,
    KEY_TAB_COLOR, get_meta_map, get_sheet_order_array, meta_bool, meta_number, meta_string,
};

/// Rename a sheet.
pub(crate) fn rename_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, name: &str) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(&mut txn, KEY_NAME, Any::String(Arc::from(name)));
    }
}

/// Get sheet metadata.
pub(crate) fn get_sheet_meta(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Option<SheetMeta> {
    let txn = doc.transact();
    let meta = get_meta_map(&txn, sheets, sheet_id)?;

    let sheet_hex = id_to_hex(sheet_id.as_u128());

    Some(SheetMeta {
        id: sheet_hex.to_string(),
        name: meta_string(&txn, &meta, KEY_NAME).unwrap_or_default(),
        default_row_height: meta_number(&txn, &meta, KEY_DEFAULT_ROW_HEIGHT, 15.0),
        default_col_width: meta_number(&txn, &meta, KEY_DEFAULT_COL_WIDTH, 8.43),
        frozen_rows: meta_number(&txn, &meta, KEY_FROZEN_ROWS, 0.0) as u32,
        frozen_cols: meta_number(&txn, &meta, KEY_FROZEN_COLS, 0.0) as u32,
        tab_color: meta_string(&txn, &meta, KEY_TAB_COLOR),
        hidden: meta_bool(&txn, &meta, KEY_HIDDEN, false),
    })
}

/// Get the (rows, cols) dimensions by reading the yrs row/col order array
/// lengths directly. Retained for the structural-undo rebuild path; no
/// production caller as of R56 — wire here if the rebuild grows a direct
/// dimension-read hook instead of recomputing from the mirror.
#[allow(dead_code)]
pub(crate) fn get_sheet_dimensions(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> (u32, u32) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return (100, 26),
    };
    let rows = match crate::storage::infra::grid_helpers::get_row_order_array(&sheet_map, &txn) {
        Some(arr) => arr.len(&txn),
        None => 100,
    };
    let cols = match crate::storage::infra::grid_helpers::get_col_order_array(&sheet_map, &txn) {
        Some(arr) => arr.len(&txn),
        None => 26,
    };
    (rows, cols)
}

/// Get the first sheet ID, if any.
pub(crate) fn get_first_sheet_id(doc: &Doc, workbook: &MapRef) -> Option<SheetId> {
    let txn = doc.transact();
    let order_arr = get_sheet_order_array(workbook, &txn)?;
    if order_arr.len(&txn) == 0 {
        return None;
    }
    if let Some(Out::Any(Any::String(s))) = order_arr.get(&txn, 0) {
        hex_to_id(&s).map(SheetId::from_raw)
    } else {
        None
    }
}

/// Get a sheet's name by ID.
pub(crate) fn get_sheet_name(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Option<String> {
    let txn = doc.transact();
    let meta = get_meta_map(&txn, sheets, sheet_id)?;
    meta_string(&txn, &meta, KEY_NAME)
}

/// Generate a unique "SheetN" name that doesn't collide with any existing sheet.
///
/// Iterates Sheet1, Sheet2, Sheet3, … until a name is found that doesn't
/// match any existing sheet name (case-insensitive).
pub(crate) fn next_unique_sheet_name(doc: &Doc, sheets: &MapRef, order: &[SheetId]) -> String {
    let existing: std::collections::HashSet<String> = order
        .iter()
        .filter_map(|sid| get_sheet_name(doc, sheets, sid).map(|n| n.to_lowercase()))
        .collect();
    let mut n = 1u32;
    loop {
        if !existing.contains(&format!("sheet{}", n)) {
            return format!("Sheet{}", n);
        }
        n += 1;
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use crate::storage::sheet::print::get_print_area;
    use crate::storage::sheet::protection::is_sheet_protected;
    use crate::storage::sheet::split_view::get_split_config;
    use crate::storage::sheet::test_support::{make_sheet_id, setup};
    use crate::storage::sheet::view::get_frozen_panes;
    use domain_types::domain::sheet::FrozenPanes;

    #[test]
    fn test_rename_sheet() {
        let (storage, _mirror, sid) = setup();
        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &sid),
            Some("Sheet1".to_string())
        );
        rename_sheet(storage.doc(), storage.sheets(), &sid, "Renamed");
        assert_eq!(
            get_sheet_name(storage.doc(), storage.sheets(), &sid),
            Some("Renamed".to_string())
        );
    }

    #[test]
    fn test_get_sheet_meta() {
        let (storage, _mirror, sid) = setup();
        let meta = get_sheet_meta(storage.doc(), storage.sheets(), &sid).unwrap();
        assert_eq!(meta.name, "Sheet1");
        assert!(!meta.hidden);
        assert_eq!(meta.frozen_rows, 0);
        assert_eq!(meta.frozen_cols, 0);
        assert!(meta.tab_color.is_none());
    }

    #[test]
    fn test_get_first_sheet_id() {
        let (storage, _mirror, sid) = setup();
        assert_eq!(
            get_first_sheet_id(storage.doc(), storage.workbook_map()),
            Some(sid)
        );

        let empty = YrsStorage::new();
        assert_eq!(get_first_sheet_id(empty.doc(), empty.workbook_map()), None);
    }

    #[test]
    fn test_get_sheet_name_nonexistent() {
        let storage = YrsStorage::new();
        assert!(get_sheet_name(storage.doc(), storage.sheets(), &make_sheet_id(999)).is_none());
    }

    /// Spans multiple modules — exercises the default-state path for all
    /// public getters that may be called on a nonexistent SheetId.
    #[test]
    fn test_nonexistent_sheet_defaults() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);

        assert!(get_sheet_meta(storage.doc(), storage.sheets(), &sid).is_none());
        assert!(get_sheet_name(storage.doc(), storage.sheets(), &sid).is_none());
        assert_eq!(
            get_frozen_panes(storage.doc(), storage.sheets(), &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );
        assert!(!is_sheet_protected(storage.doc(), storage.sheets(), &sid));
        assert!(get_split_config(storage.doc(), storage.sheets(), &sid).is_none());
        assert!(get_print_area(storage.doc(), storage.sheets(), &sid).is_none());
    }
}

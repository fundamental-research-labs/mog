use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::yrs_access::get_sheet_submap;
use cell_types::SheetId;
use compute_document::schema::KEY_HIDDEN_COLS;
use compute_document::undo::ORIGIN_USER_EDIT;

/// Hide columns.
pub fn hide_columns(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, cols: &[u32]) {
    if cols.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return,
    };

    for &col in cols {
        let key = col.to_string();
        if matches!(
            hidden_cols_map.get(&txn, &key),
            Some(Out::Any(Any::Bool(true)))
        ) {
            continue;
        }
        hidden_cols_map.insert(&mut txn, &*key, Any::Bool(true));
    }
}

/// Unhide columns.
pub fn unhide_columns(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, cols: &[u32]) {
    if cols.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return,
    };

    for &col in cols {
        let key = col.to_string();
        hidden_cols_map.remove(&mut txn, &key);
    }
}

/// Check if a column is hidden.
pub fn is_column_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, col: u32) -> bool {
    let txn = doc.transact();
    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return false,
    };

    let key = col.to_string();
    matches!(
        hidden_cols_map.get(&txn, &key),
        Some(Out::Any(Any::Bool(true)))
    )
}

/// Get all hidden columns for a sheet, sorted.
pub fn get_hidden_columns(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<u32> {
    let txn = doc.transact();
    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result: Vec<u32> = hidden_cols_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                key.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect();

    result.sort_unstable();
    result
}

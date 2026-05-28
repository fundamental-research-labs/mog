//! Connection-wide sheet data binding queries and removals.

use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use super::codec;
use crate::engine_types::bindings::SheetDataBinding;
use compute_document::schema::KEY_BINDINGS;
use compute_document::undo::ORIGIN_USER_EDIT;

/// Get data bindings for a specific connection across all sheets.
///
/// Iterates over every sheet's `bindings` map and collects bindings matching
/// the given `connection_id`.
pub fn get_bindings_for_connection(
    doc: &Doc,
    sheets: &MapRef,
    connection_id: &str,
) -> Vec<SheetDataBinding> {
    let txn = doc.transact();
    let mut result = Vec::new();

    for (_sheet_key, sheet_value) in sheets.iter(&txn) {
        let sheet_map = match sheet_value {
            Out::YMap(m) => m,
            _ => continue,
        };
        let bindings_map = match sheet_map.get(&txn, KEY_BINDINGS) {
            Some(Out::YMap(m)) => m,
            _ => continue,
        };
        for (_key, value) in bindings_map.iter(&txn) {
            if let Out::YMap(map) = &value
                && let Some(b) = codec::from_yrs_map(map, &txn)
                && b.connection_id == connection_id
            {
                result.push(b);
            }
        }
    }

    result
}

/// Remove all data bindings for a connection across all sheets.
///
/// Returns the number of bindings removed.
pub fn remove_bindings_for_connection(doc: &Doc, sheets: &MapRef, connection_id: &str) -> u32 {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let mut count = 0u32;

    // Collect sheet keys first (to avoid borrowing issues)
    let sheet_keys: Vec<String> = sheets.iter(&txn).map(|(k, _)| k.to_string()).collect();

    for sheet_key in &sheet_keys {
        let sheet_map = match sheets.get(&txn, sheet_key.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => continue,
        };
        let bindings_map = match sheet_map.get(&txn, KEY_BINDINGS) {
            Some(Out::YMap(m)) => m,
            _ => continue,
        };

        // Collect binding IDs to remove
        let to_remove: Vec<String> = bindings_map
            .iter(&txn)
            .filter_map(|(key, value)| {
                if let Out::YMap(map) = &value
                    && let Some(b) = codec::from_yrs_map(map, &txn)
                    && b.connection_id == connection_id
                {
                    return Some(key.to_string());
                }
                None
            })
            .collect();

        for binding_id in &to_remove {
            bindings_map.remove(&mut txn, binding_id.as_str());
            count += 1;
        }
    }

    count
}

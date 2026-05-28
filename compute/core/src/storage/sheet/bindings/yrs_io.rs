//! Shared Yrs map access helpers for sheet bindings.

use compute_document::schema::KEY_BINDINGS;
use yrs::{Map, MapRef, Out};

use super::codec;
use crate::engine_types::bindings::SheetDataBinding;

/// Get the `bindings` MapRef for a given sheet (read-only).
pub(super) fn get_bindings_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_id) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_BINDINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Read all bindings from a bindings map (structured Y.Map format).
pub(super) fn read_all_bindings<T: yrs::ReadTxn>(
    txn: &T,
    bindings_map: &MapRef,
) -> Vec<SheetDataBinding> {
    let mut result = Vec::new();
    for (_key, value) in bindings_map.iter(txn) {
        if let Out::YMap(map) = &value
            && let Some(b) = codec::from_yrs_map(map, txn)
        {
            result.push(b);
        }
    }
    result
}

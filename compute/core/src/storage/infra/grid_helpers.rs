//! Shared grid navigation helpers for the storage module.
//!
//! These functions are used by multiple storage sub-modules to navigate
//! the Yrs document's grid structure. Provides access to the YArray-based
//! row/column ordering. The legacy `cellGrid` / `cellPos` lookup maps were
//! retired in GridIndex migration (`gridIndex/{posToId,idToPos}` is the authoritative
//! yrs-side identity store).

use yrs::{Any, Array, ArrayRef, Map, MapRef, Out};

use cell_types::SheetId;
use compute_document::schema::{KEY_CELL_PROPERTIES, KEY_CELLS, KEY_COL_ORDER, KEY_ROW_ORDER};

// ---------------------------------------------------------------------------
// Sheet sub-map navigation (generic + specialised)
// ---------------------------------------------------------------------------

/// Navigate to a named sub-map within a sheet's entry in the sheets root.
pub(crate) fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
    key: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Navigate to the `cells` map for a sheet.
pub(crate) fn get_cells_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    get_sheet_submap(txn, sheets, sheet_hex, KEY_CELLS)
}

/// Navigate to the `properties` map for a sheet.
pub(crate) fn get_properties_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    get_sheet_submap(txn, sheets, sheet_hex, KEY_CELL_PROPERTIES)
}

// ---------------------------------------------------------------------------
// YArray-based row/column ordering
// ---------------------------------------------------------------------------

/// Navigate to the `rowOrder` YArray from a sheet map.
pub(crate) fn get_row_order_array<T: yrs::ReadTxn>(
    sheet_map: &MapRef,
    txn: &T,
) -> Option<ArrayRef> {
    match sheet_map.get(txn, KEY_ROW_ORDER) {
        Some(Out::YArray(a)) => Some(a),
        _ => None,
    }
}

/// Navigate to the `colOrder` YArray from a sheet map.
pub(crate) fn get_col_order_array<T: yrs::ReadTxn>(
    sheet_map: &MapRef,
    txn: &T,
) -> Option<ArrayRef> {
    match sheet_map.get(txn, KEY_COL_ORDER) {
        Some(Out::YArray(a)) => Some(a),
        _ => None,
    }
}

/// Read the full rowOrder array into a Vec of hex strings.
pub(crate) fn read_row_order<T: yrs::ReadTxn>(arr: &ArrayRef, txn: &T) -> Vec<String> {
    let len = arr.len(txn);
    let mut result = Vec::with_capacity(len as usize);
    for i in 0..len {
        if let Some(Out::Any(Any::String(s))) = arr.get(txn, i) {
            result.push(s.to_string());
        }
    }
    result
}

/// Read the full colOrder array into a Vec of hex strings.
pub(crate) fn read_col_order<T: yrs::ReadTxn>(arr: &ArrayRef, txn: &T) -> Vec<String> {
    read_row_order(arr, txn) // Same logic, different array
}

// ---------------------------------------------------------------------------
// Sheet ID formatting
// ---------------------------------------------------------------------------

/// Convert a `SheetId` to its 32-character lower-hex key for the sheets map.
pub(crate) fn sheet_id_to_hex(sheet_id: &SheetId) -> compute_document::hex::SmallHex {
    compute_document::hex::id_to_hex(sheet_id.as_u128())
}

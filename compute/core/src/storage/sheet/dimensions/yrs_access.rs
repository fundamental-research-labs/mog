use yrs::{Any, Map, MapRef, Out, Transact};

use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;

pub(super) fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn row_id_key(grid_index: Option<&GridIndex>, row: u32) -> Option<String> {
    grid_index
        .and_then(|gi| gi.row_id(row))
        .map(|rid| id_to_hex(rid.as_u128()).to_string())
}

pub(super) fn map_has_true<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> bool {
    matches!(map.get(txn, key), Some(Out::Any(Any::Bool(true))))
}

pub(super) fn any_filter_hides_row<T: yrs::ReadTxn>(
    filter_hidden_rows_map: &MapRef,
    txn: &T,
    row_id: &str,
) -> bool {
    filter_hidden_rows_map.iter(txn).any(|(_, owner)| {
        if let Out::YMap(owner_map) = owner {
            map_has_true(&owner_map, txn, row_id)
        } else {
            false
        }
    })
}

pub(super) fn effective_hidden_by_row_id<T: yrs::ReadTxn>(
    manual_hidden_rows_map: Option<&MapRef>,
    filter_hidden_rows_map: Option<&MapRef>,
    txn: &T,
    row_id: &str,
) -> bool {
    manual_hidden_rows_map.is_some_and(|m| map_has_true(m, txn, row_id))
        || filter_hidden_rows_map.is_some_and(|m| any_filter_hides_row(m, txn, row_id))
}

pub(super) fn write_effective_hidden_cache(
    hidden_rows_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    row: u32,
    hidden: bool,
) {
    let key = row.to_string();
    if hidden {
        hidden_rows_map.insert(txn, &*key, Any::Bool(true));
    } else {
        hidden_rows_map.remove(txn, &key);
    }
}

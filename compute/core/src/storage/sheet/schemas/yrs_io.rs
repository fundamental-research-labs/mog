use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_PROPERTIES, KEY_SCHEMAS};
use yrs::{Any, Map, MapPrelim, MapRef, Out, ReadTxn};

pub(super) fn get_schemas_map<T: ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_SCHEMAS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn get_properties_map<T: ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn get_sheet_sub_map<T: ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn ensure_sheet_sub_map(
    txn: &mut yrs::TransactionMut<'_>,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &'static str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            Some(sm.insert(txn, key, empty))
        }
    }
}

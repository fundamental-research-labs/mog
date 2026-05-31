use yrs::{Any, ArrayPrelim, ArrayRef, Map, MapRef, Out};

pub(super) fn get_sheet_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
    map_key: &str,
) -> Option<MapRef> {
    let sheet_map = get_sheet_map(txn, sheets_root, sheet_hex)?;
    match sheet_map.get(txn, map_key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn get_or_create_sheet_subarray(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_hex: &str,
    array_key: &str,
) -> Option<ArrayRef> {
    let sheet_map = get_sheet_map(txn, sheets_root, sheet_hex)?;
    match sheet_map.get(txn, array_key) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => Some(sheet_map.insert(txn, array_key, ArrayPrelim::from([] as [Any; 0]))),
    }
}

use yrs::{Map, MapRef, Out};

pub(super) fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
    map_key: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, map_key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

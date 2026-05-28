use compute_document::schema::{KEY_MERGE_BACKUPS, KEY_MERGES};
use yrs::{Map, MapRef, Out};

pub(super) fn get_merges_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sm = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_MERGES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn get_merge_backups_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sm = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_MERGE_BACKUPS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

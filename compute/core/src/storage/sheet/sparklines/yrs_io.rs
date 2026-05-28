use cell_types::SheetId;
use compute_document::schema::KEY_SPARKLINES;
use yrs::{Map, MapRef, Out};

use crate::storage::infra::grid_helpers::sheet_id_to_hex;

pub(super) fn get_sparklines_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_SPARKLINES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn get_sheet_sparklines_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    get_sparklines_map(txn, sheets_root, &sheet_hex)
}

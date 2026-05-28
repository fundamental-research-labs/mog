use yrs::{Map, MapRef, Out};

use cell_types::CellId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_CELLS;

pub(super) fn remove_deleted_cells(
    txn: &mut yrs::TransactionMut<'_>,
    sheet_map: &MapRef,
    deleted_cell_ids: &[CellId],
) {
    if let Some(Out::YMap(cells_map)) = sheet_map.get(txn, KEY_CELLS) {
        for cell_id in deleted_cell_ids {
            let cell_hex = id_to_hex(cell_id.as_u128());
            cells_map.remove(txn, &cell_hex);
        }
    }
}

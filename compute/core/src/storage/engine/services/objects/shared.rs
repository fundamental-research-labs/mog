use crate::storage::engine::stores::EngineStores;
use cell_types::{CellId, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};

pub(super) fn cell_position_for_hex(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<(u32, u32)> {
    hex_to_id(cell_id).map(CellId::from_raw).and_then(|cid| {
        stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|grid| grid.cell_position(&cid))
    })
}

pub(super) fn cell_hex_at_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    super::super::cell_editing::find_cell_id_at(stores, sheet_id, row, col)
        .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
}

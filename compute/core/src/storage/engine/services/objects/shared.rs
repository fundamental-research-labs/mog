use crate::cells::CellStore;
use cell_types::{CellId, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};

pub(super) fn cell_position_for_hex(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<(u32, u32)> {
    hex_to_id(cell_id).map(CellId::from_raw).and_then(|cid| {
        cell_store
            .get_sheet(sheet_id)
            .and_then(|grid| grid.cell_position(&cid))
    })
}

pub(super) fn cell_hex_at_position(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    super::super::cell_editing::find_cell_id_at(cell_store, sheet_id, row, col)
        .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
}

use std::sync::Arc;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_FORMULA, KEY_VALUE};
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::get_cells_map;

use super::keys::{
    KEY_CELL_NOTE, KEY_HYPERLINK, KEY_HYPERLINK_DISPLAY, KEY_HYPERLINK_LOCATION,
    KEY_HYPERLINK_TARGET_KIND, KEY_HYPERLINK_TARGET_MODE, KEY_HYPERLINK_TOOLTIP, KEY_HYPERLINK_UID,
    KEY_NOTE,
};

/// Set a hyperlink on a cell at the given position.
///
/// If a cell exists at the position, the hyperlink field is added/updated. If no
/// cell exists, a marker cell is created and registered in `grid`.
pub fn set_hyperlink(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
    url: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    if let Some(cell_id) = grid.cell_id_at(row, col) {
        let cell_hex = id_to_hex(cell_id.as_u128());
        if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) {
            cell_map.insert(&mut txn, KEY_HYPERLINK, Any::String(Arc::from(url)));
        }
    } else {
        let cell_id = grid.ensure_cell_id(row, col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        let row_hex = grid.row_id_hex(row);
        let col_hex = grid.col_id_hex(col);
        let cell_prelim = MapPrelim::from([
            (KEY_VALUE, Any::Null),
            (KEY_HYPERLINK, Any::String(Arc::from(url))),
        ]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);

        if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
            crate::storage::cells::values::write_cell_position_to_yrs(
                &mut txn,
                sheets,
                &sheet_hex,
                &cell_hex,
                rh.as_str(),
                ch.as_str(),
            );
        }
    }
}

/// Remove the hyperlink from a cell at the given position.
///
/// Value-backed, formula-backed, and noted cells are preserved. Marker cells are
/// deleted from both the Yrs cell map and the in-memory `GridIndex`.
pub fn remove_hyperlink(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let cell_id = match grid.cell_id_at(row, col) {
        Some(id) => id,
        None => return,
    };
    let cell_hex = id_to_hex(cell_id.as_u128());

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    cell_map.remove(&mut txn, KEY_HYPERLINK);
    cell_map.remove(&mut txn, KEY_HYPERLINK_LOCATION);
    cell_map.remove(&mut txn, KEY_HYPERLINK_DISPLAY);
    cell_map.remove(&mut txn, KEY_HYPERLINK_TOOLTIP);
    cell_map.remove(&mut txn, KEY_HYPERLINK_UID);
    cell_map.remove(&mut txn, KEY_HYPERLINK_TARGET_KIND);
    cell_map.remove(&mut txn, KEY_HYPERLINK_TARGET_MODE);

    if !cell_has_data(&txn, &cell_map) {
        cells_map.remove(&mut txn, &cell_hex);
        drop(txn);
        grid.remove_cell(&cell_id);
    }
}

fn cell_has_data<T: yrs::ReadTxn>(txn: &T, cell_map: &MapRef) -> bool {
    match cell_map.get(txn, KEY_VALUE) {
        Some(Out::Any(Any::Null)) | Some(Out::Any(Any::Undefined)) | None => {}
        Some(_) => return true,
    }

    if cell_map.get(txn, KEY_FORMULA).is_some() {
        return true;
    }

    if cell_map.get(txn, KEY_NOTE).is_some() {
        return true;
    }

    if cell_map.get(txn, KEY_CELL_NOTE).is_some() {
        return true;
    }

    false
}

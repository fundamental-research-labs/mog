use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Transact};

use super::super::grid_helpers::get_cells_map;
use cell_types::{CellId, SheetId};

/// Get the CellId at a position, creating a marker cell if none exists.
///
/// GridIndex is the sole authority for (row, col) ↔ CellId. When a new
/// identity is created, a placeholder cell (value = Null) is also written
/// to the yrs `cells` map so readers that look up the cell by hex see an
/// entry.
pub(crate) fn get_or_create_cell_id(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
) -> CellId {
    if let Some(existing) = grid.cell_id_at(row, col) {
        return existing;
    }

    let cell_id = grid.ensure_cell_id(row, col);

    // Persist a placeholder so downstream yrs reads (e.g. exports) see an
    // entry. `ensure_cell_id` already registered the grid-side mapping.
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = doc.transact_mut();
    if let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) {
        let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::Null)]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }

    cell_id
}

/// Update a cell's position in the GridIndex.
///
/// Used by cell relocation operations. `register_cell` removes the stale
/// `(old_row, old_col)` ↔ `cell_id` mapping and installs the new one.
pub(crate) fn update_cell_position(
    _doc: &Doc,
    _sheets: &MapRef,
    _sheet_id: SheetId,
    grid: &mut GridIndex,
    cell_id: CellId,
    new_row: u32,
    new_col: u32,
) {
    grid.register_cell(cell_id, new_row, new_col);
}

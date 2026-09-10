use cell_types::{CellId, SheetId, SheetPos};

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;

/// Resolve authored, metadata-only, or range-resident identities without allocating.
pub(in crate::storage::engine) fn find_cell_id_at(
    cells: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    cells.resolve_cell_id(sheet_id, SheetPos::new(row, col))
}

pub(in crate::storage::engine) fn ensure_cell_id(
    stores: &mut EngineStores,
    cells: &mut CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    stores.grid_indexes.get(sheet_id)?;
    let id = find_cell_id_at(cells, sheet_id, row, col)
        .unwrap_or_else(|| stores.grid_id_alloc.next_cell_id());
    crate::storage::engine::history::cells::capture_cell(stores, cells, *sheet_id, id, row, col);
    cells.register_identity_position(*sheet_id, SheetPos::new(row, col), id);
    let sheet = cells.get_sheet(sheet_id)?;
    stores
        .grid_indexes
        .get_mut(sheet_id)?
        .restore_shared_axes(sheet.row_axis.clone(), sheet.col_axis.clone());
    Some(id)
}

/// Formula resolution can extend axes while allocating referenced ghost cells.
/// Share those axes with metadata readers after evaluation.
pub(in crate::storage::engine) fn sync_grid_axes(stores: &mut EngineStores, cells: &CellStore) {
    for (sheet_id, grid) in &mut stores.grid_indexes {
        if let Some(sheet) = cells.get_sheet(sheet_id) {
            grid.restore_shared_axes(sheet.row_axis.clone(), sheet.col_axis.clone());
        }
    }
}

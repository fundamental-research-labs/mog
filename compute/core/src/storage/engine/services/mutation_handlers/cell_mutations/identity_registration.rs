use std::collections::HashMap;

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;
use cell_types::{CellId, SheetId};
use value_types::ComputeError;

/// Grow native axes once per sheet and register identities touched by this batch.
pub(super) fn register_cell_positions(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    positions: impl Iterator<Item = (SheetId, CellId, u32, u32)> + Clone,
) -> Result<(), ComputeError> {
    let mut max_by_sheet: HashMap<SheetId, (u32, u32)> = HashMap::new();
    for (sheet_id, _, row, col) in positions.clone() {
        max_by_sheet
            .entry(sheet_id)
            .and_modify(|(r, c)| {
                *r = (*r).max(row);
                *c = (*c).max(col);
            })
            .or_insert((row, col));
    }
    // Reject missing sheets before growing any other sheet in this batch.
    for sheet_id in max_by_sheet.keys() {
        if !stores.grid_indexes.contains_key(sheet_id) {
            return Err(ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            });
        }
        crate::storage::engine::history::structure::capture_sheet_extent(
            stores, cell_store, *sheet_id,
        );
    }
    for (sheet_id, (row, col)) in max_by_sheet {
        let grid =
            stores
                .grid_indexes
                .get_mut(&sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;
        if let Some(sheet) = cell_store.get_sheet(&sheet_id) {
            grid.restore_shared_axes(sheet.row_axis.clone(), sheet.col_axis.clone());
        }
        grid.ensure_capacity(row, col);
        cell_store.install_sheet_axes(sheet_id, grid.row_axis(), grid.col_axis());
    }
    for (sheet_id, cell_id, row, col) in positions {
        cell_store.register_identity_position(
            sheet_id,
            cell_types::SheetPos::new(row, col),
            cell_id,
        );
    }
    Ok(())
}

use std::collections::HashMap;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use cell_types::{CellId, SheetId};
use value_types::ComputeError;

/// Grow native axes once per sheet and register identities touched by this batch.
pub(super) fn register_cell_positions(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
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
        crate::storage::engine::history::structure::capture_sheet_extent(stores, mirror, *sheet_id);
    }
    for (sheet_id, (row, col)) in max_by_sheet {
        let grid =
            stores
                .grid_indexes
                .get_mut(&sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;
        grid.ensure_capacity(row, col);
        mirror.install_sheet_axes(sheet_id, grid.row_axis(), grid.col_axis());
    }
    for (sheet_id, cell_id, row, col) in positions {
        let grid =
            stores
                .grid_indexes
                .get_mut(&sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;
        grid.register_cell(cell_id, row, col);
    }
    Ok(())
}

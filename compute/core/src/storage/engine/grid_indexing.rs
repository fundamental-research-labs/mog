use cell_types::{CellId, SheetId};

use crate::identity::GridIndex;
use crate::storage::YrsStorage;

use super::construction::{register_pos_to_id_entries, resolve_sheet_axes_from_yrs};
use super::stores::EngineStores;

/// Apply observed `gridIndex/posToId` entry changes to the in-memory
/// `GridIndex` for each affected sheet.
///
/// Each entry carries a `CellId` and the `rowHex`/`colHex` identity pair;
/// resolve those to the current `(row, col)` by consulting the sheet's
/// `rowOrder`/`colOrder` YArrays (the same source-of-truth hydration uses).
/// Entries whose row/col hex no longer resolves — e.g. a row was deleted
/// between the write and the observation — are silently skipped.
///
/// Runs on both the writer (idempotent: register_cell is a no-op) and on
/// every peer that applies a remote update containing a `posToId` insert,
/// so a metadata-only write (comment, hyperlink, format on a previously
/// empty cell) propagates the cell's position into the peer's in-memory
/// `GridIndex` without waiting for a sheet-lifecycle rebuild.
pub(in crate::storage::engine) fn apply_grid_index_changes(
    stores: &mut EngineStores,
    changes: &[compute_document::observe::GridIndexCellChange],
) -> Result<(), value_types::ComputeError> {
    use compute_document::hex::{id_to_hex, parse_cell_id};
    use compute_document::observe::CellChangeKind;
    use compute_document::schema::{KEY_GRID_INDEX, KEY_GRID_POS_TO_ID};
    use yrs::{Map, Out, Transact};

    if changes.is_empty() {
        return Ok(());
    }

    for change in changes {
        let Some(axis_grid) = resolve_sheet_axes_from_yrs(&stores.storage, change.sheet_id)?
            .map(|axes| axes.into_grid(change.sheet_id, stores.grid_id_alloc.clone()))
        else {
            continue;
        };
        let sheet_hex = id_to_hex(change.sheet_id.as_u128());
        let row = axis_grid.row_index_from_hex(change.row_hex.as_str());
        let col = axis_grid.col_index_from_hex(change.col_hex.as_str());
        let (Some(row), Some(col)) = (row, col) else {
            continue;
        };
        let pos_key = format!("{}:{}", change.row_hex, change.col_hex);
        let current_owner = {
            let txn = stores.storage.doc().transact();
            stores
                .storage
                .sheets()
                .get(&txn, &sheet_hex)
                .and_then(|out| match out {
                    Out::YMap(sheet_map) => sheet_map.get(&txn, KEY_GRID_INDEX),
                    _ => None,
                })
                .and_then(|out| match out {
                    Out::YMap(grid_index_map) => grid_index_map.get(&txn, KEY_GRID_POS_TO_ID),
                    _ => None,
                })
                .and_then(|out| match out {
                    Out::YMap(pos_to_id) => pos_to_id.get(&txn, pos_key.as_str()),
                    _ => None,
                })
                .and_then(|out| match out {
                    Out::Any(yrs::Any::String(cell_hex)) => parse_cell_id(cell_hex.as_ref()),
                    _ => None,
                })
        };

        match change.kind {
            CellChangeKind::Modified => {
                if let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) {
                    grid.register_cell(change.cell_id, row, col);
                }
            }
            CellChangeKind::Removed => {
                if let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) {
                    if current_owner == Some(change.cell_id) {
                        grid.register_cell(change.cell_id, row, col);
                        continue;
                    }

                    // Guard: only remove if the cell is still at the vacated position.
                    // A preceding Modified event in the same observer batch may have
                    // already moved the cell to its new position — blindly removing
                    // would evict it from the new slot instead of the old one.
                    if grid.cell_position(&change.cell_id) == Some((row, col)) {
                        grid.remove_cell(&change.cell_id);
                    }
                }
            }
        }
    }
    Ok(())
}

/// Build a GridIndex for a single sheet by reading rowOrder/colOrder from Yrs.
pub(in crate::storage::engine) fn build_grid_from_yrs_for_sheet(
    storage: &YrsStorage,
    sheet_id: SheetId,
    sheet_snap: &crate::snapshot::SheetSnapshot,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<GridIndex, value_types::ComputeError> {
    let resolved_axes = resolve_sheet_axes_from_yrs(storage, sheet_id)?;

    let mut grid = if let Some(resolved_axes) = resolved_axes {
        let pos_to_id_entries = resolved_axes.pos_to_id_entries.clone();
        let mut grid = resolved_axes.into_grid(sheet_id, id_alloc);
        register_pos_to_id_entries(storage, sheet_id, &mut grid, pos_to_id_entries)?;
        grid
    } else {
        GridIndex::new(sheet_id, sheet_snap.rows, sheet_snap.cols, id_alloc)
    };

    for cell_data in &sheet_snap.cells {
        if let Ok(cell_id) = CellId::from_uuid_str(&cell_data.cell_id) {
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
    }
    Ok(grid)
}

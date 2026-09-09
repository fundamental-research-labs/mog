use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;

// -------------------------------------------------------------------
// Cell Identity and Position Mutations
// -------------------------------------------------------------------

/// Get or create a sparse native CellId at a position.
pub(in crate::storage::engine) fn get_or_create_cell_id(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    let id = ensure_cell_id_at(stores, cell_store, sheet_id, row, col)?;
    Ok(MutationResult::empty().with_data(&id_to_hex(id.as_u128()))?)
}

/// Native identity result for internal callers; serialization stays at the boundary.
pub(in crate::storage::engine) fn ensure_cell_id_at(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<CellId, ComputeError> {
    let cell_id =
        super::super::cell_editing::ensure_cell_id(stores, cell_store, sheet_id, row, col)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;

    stores
        .storage
        .history
        .retain_untracked_identity(*sheet_id, cell_id);
    Ok(cell_id)
}

/// Move a cell within the native cell store.
pub(in crate::storage::engine) fn update_cell_position(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    cell_id_hex: &str,
    new_row: u32,
    new_col: u32,
) -> Result<MutationResult, ComputeError> {
    let id_u128 = hex_to_id(cell_id_hex).ok_or_else(|| ComputeError::Eval {
        message: format!("Invalid cell ID hex: {}", cell_id_hex),
    })?;
    let cell_id = CellId::from_raw(id_u128);

    let grid = stores
        .grid_indexes
        .get_mut(sheet_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("No GridIndex for sheet {:?}", sheet_id),
        })?;
    // Ensure the cell is known at some position before moving.
    cell_store
        .get_sheet(sheet_id)
        .and_then(|sheet| sheet.cell_position(&cell_id))
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Cell {:?} not found in cell store", cell_id),
        })?;

    if let Some(sheet) = cell_store.get_sheet(sheet_id) {
        grid.restore_shared_axes(sheet.row_axis.clone(), sheet.col_axis.clone());
    }
    grid.ensure_capacity(new_row, new_col);
    cell_store.install_sheet_axes(*sheet_id, grid.row_axis(), grid.col_axis());

    let new_pos = SheetPos::new(new_row, new_col);
    cell_store.move_cell(&cell_id, sheet_id, new_pos);

    stores
        .storage
        .history
        .retain_untracked_identity(*sheet_id, cell_id);
    Ok(MutationResult::empty())
}

/// Collect source cell values for a relocate operation.
///
/// Returns a Vec of `(delta_row, delta_col, CellValue)` tuples representing
/// the typed values to be written at target offsets. `CellValue::Null`
/// represents empty source cells that should be skipped during the write
/// phase. Errors and arrays survive verbatim — see the `import_values`-based
/// target write in `relocate_cells` for the lossless handoff.
pub(in crate::storage::engine) fn collect_relocate_values(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
) -> Vec<(u32, u32, CellValue)> {
    let mut cells_to_move: Vec<(u32, u32, CellValue)> = Vec::new();

    for row in src_start_row..=src_end_row {
        for col in src_start_col..=src_end_col {
            let pos = SheetPos::new(row, col);
            let value = cell_store
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);
            let dr = row - src_start_row;
            let dc = col - src_start_col;
            cells_to_move.push((dr, dc, value));
        }
    }

    cells_to_move
}

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;
use crate::storage::infra::cell_iter;

// -------------------------------------------------------------------
// Cell Identity and Position Mutations
// -------------------------------------------------------------------

/// Get or create a CellId at a position in the Yrs document.
pub(in crate::storage::engine) fn get_or_create_cell_id(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    let grid = stores
        .grid_indexes
        .get_mut(sheet_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("No GridIndex for sheet {:?}", sheet_id),
        })?;

    let cell_id = cell_iter::get_or_create_cell_id(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    );

    let cell_id_hex = id_to_hex(cell_id.as_u128());
    Ok(MutationResult::empty().with_data(&cell_id_hex)?)
}

/// Update a cell's position via the in-memory GridIndex (sole authority for
/// `(sheet, row, col) ↔ CellId`).
pub(in crate::storage::engine) fn update_cell_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
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
    grid.cell_position(&cell_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Cell {:?} not found in GridIndex", cell_id),
        })?;

    cell_iter::update_cell_position(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        cell_id,
        new_row,
        new_col,
    );

    let (value, _formula, identity_formula) = stores
        .storage
        .read_cell_from_yrs(sheet_id, &cell_id)
        .unwrap_or((CellValue::Null, None, None));

    mirror.apply_edit(
        sheet_id,
        cell_id,
        SheetPos::new(new_row, new_col),
        value,
        identity_formula,
    );

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
    mirror: &CellMirror,
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
            let value = mirror
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

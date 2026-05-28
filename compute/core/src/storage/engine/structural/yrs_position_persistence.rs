use super::super::stores::EngineStores;
use crate::storage::cells::values::{remove_cell_position_from_yrs, write_cell_position_to_yrs};
use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_STRUCTURAL;
use value_types::ComputeError;
use yrs::{Origin, Transact};

pub(super) fn persist_remapped_cell_positions(
    stores: &EngineStores,
    sheet_id: &SheetId,
    updates: &[(CellId, u32, u32)],
) -> Result<(), ComputeError> {
    if updates.is_empty() {
        return Ok(());
    }

    let grid = stores
        .grid_indexes
        .get(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    let mut position_writes = Vec::with_capacity(updates.len());
    for (cell_id, row, col) in updates {
        let row_hex = grid
            .row_id_hex(*row)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!("missing row identity for remapped row {row}"),
            })?;
        let col_hex = grid
            .col_id_hex(*col)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!("missing column identity for remapped column {col}"),
            })?;
        position_writes.push((
            String::from(id_to_hex(cell_id.as_u128())),
            String::from(row_hex),
            String::from(col_hex),
        ));
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
    for (cell_hex, _, _) in &position_writes {
        remove_cell_position_from_yrs(&mut txn, sheets, &sheet_hex, cell_hex);
    }
    for (cell_hex, row_hex, col_hex) in &position_writes {
        write_cell_position_to_yrs(&mut txn, sheets, &sheet_hex, cell_hex, row_hex, col_hex);
    }
    Ok(())
}

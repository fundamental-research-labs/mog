use std::collections::HashMap;

use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use rustc_hash::FxHashMap;
use value_types::{CellValue, ComputeError};
use yrs::{Map, Origin, Out, Transact};

use crate::identity::GridIndex;
use crate::storage::YrsStorage;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

fn max_position_by_sheet<I>(positions: I) -> HashMap<SheetId, (u32, u32)>
where
    I: IntoIterator<Item = (SheetId, u32, u32)>,
{
    let mut max_by_sheet: HashMap<SheetId, (u32, u32)> = HashMap::new();
    for (sheet_id, row, col) in positions {
        max_by_sheet
            .entry(sheet_id)
            .and_modify(|(max_row, max_col)| {
                *max_row = (*max_row).max(row);
                *max_col = (*max_col).max(col);
            })
            .or_insert((row, col));
    }
    max_by_sheet
}

fn sheet_has_compact_axes(txn: &yrs::TransactionMut<'_>, sheet_map: &yrs::MapRef) -> bool {
    use compute_document::schema::{KEY_GRID_COL_AXIS, KEY_GRID_INDEX, KEY_GRID_ROW_AXIS};
    match sheet_map.get(txn, KEY_GRID_INDEX) {
        Some(Out::YMap(grid_index)) => {
            grid_index.get(txn, KEY_GRID_ROW_AXIS).is_some()
                || grid_index.get(txn, KEY_GRID_COL_AXIS).is_some()
        }
        _ => false,
    }
}

fn ensure_batch_dimensions(
    storage: &YrsStorage,
    grid_indexes: &mut FxHashMap<SheetId, GridIndex>,
    sheets_map: &yrs::MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    max_by_sheet: HashMap<SheetId, (u32, u32)>,
) -> Result<(), ComputeError> {
    for (sheet_id, (max_row, max_col)) in max_by_sheet {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let compact_axes = match sheets_map.get(&*txn, &sheet_hex) {
            Some(Out::YMap(sheet_map)) => sheet_has_compact_axes(txn, &sheet_map),
            _ => {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                });
            }
        };
        let grid = grid_indexes
            .get_mut(&sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
        let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
            storage.doc(),
            sheets_map,
            grid,
        );
        dims.ensure_capacity(txn, sheet_id, max_row, max_col)?;
        if compact_axes {
            dims.materialize_dense_axes_and_remove_compact_keys(txn, sheet_id)?;
        }
    }
    Ok(())
}

pub(super) fn write_prepared_cell_inputs_to_yrs(
    stores: &mut EngineStores,
    edits: &[(SheetId, CellId, u32, u32, CellInput)],
    prepared_values: &[(CellValue, Option<String>)],
) -> Result<(), ComputeError> {
    let EngineStores {
        storage,
        grid_indexes,
        ..
    } = stores;
    let sheets_map = storage.doc().get_or_insert_map("sheets");
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    ensure_batch_dimensions(
        storage,
        grid_indexes,
        &sheets_map,
        &mut txn,
        max_position_by_sheet(
            edits
                .iter()
                .map(|(sheet_id, _, row, col, _)| (*sheet_id, *row, *col)),
        ),
    )?;

    for ((sheet_id, cell_id, row, col, _), (value, formula)) in
        edits.iter().zip(prepared_values.iter())
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let grid = grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
        grid.register_cell(*cell_id, *row, *col);
        let row_hex = grid
            .row_id_hex(*row)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing row identity after dimension growth for row {}",
                    row
                ),
            })?;
        let col_hex = grid
            .col_id_hex(*col)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing column identity after dimension growth for col {}",
                    col
                ),
            })?;
        super::super::super::cell_editing::write_cell_to_yrs_in_txn(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            *cell_id,
            row_hex.as_str(),
            col_hex.as_str(),
            value,
            formula.as_deref(),
        );
    }

    Ok(())
}

pub(super) fn write_raw_cell_edits_to_yrs(
    stores: &mut EngineStores,
    edits: &[(SheetId, CellId, u32, u32, CellValue, Option<String>)],
) -> Result<(), ComputeError> {
    let EngineStores {
        storage,
        grid_indexes,
        ..
    } = stores;
    let sheets_map = storage.doc().get_or_insert_map("sheets");
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    ensure_batch_dimensions(
        storage,
        grid_indexes,
        &sheets_map,
        &mut txn,
        max_position_by_sheet(
            edits
                .iter()
                .map(|(sheet_id, _, row, col, _, _)| (*sheet_id, *row, *col)),
        ),
    )?;

    for (sheet_id, cell_id, row, col, value, formula) in edits {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let grid = grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
        grid.register_cell(*cell_id, *row, *col);
        let row_hex = grid
            .row_id_hex(*row)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing row identity after dimension growth for row {}",
                    row
                ),
            })?;
        let col_hex = grid
            .col_id_hex(*col)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing column identity after dimension growth for col {}",
                    col
                ),
            })?;
        let formula_body = formula.as_deref().map(|f| f.strip_prefix('=').unwrap_or(f));
        super::super::super::cell_editing::write_cell_to_yrs_in_txn(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            *cell_id,
            row_hex.as_str(),
            col_hex.as_str(),
            value,
            formula_body,
        );
    }

    Ok(())
}

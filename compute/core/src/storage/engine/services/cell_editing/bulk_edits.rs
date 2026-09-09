use cell_types::SheetId;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

use super::super::mutation_handlers::{
    mutation_set_cells_by_position, mutation_set_cells_by_position_raw,
};

pub(in crate::storage::engine) fn set_cell_values_parsed(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    updates: &[(u32, u32, String)],
) -> Result<RecalcResult, ComputeError> {
    let edits = updates
        .iter()
        .map(|(row, col, text)| {
            let input = if text.trim().is_empty() {
                CellInput::Clear
            } else {
                CellInput::Parse { text: text.clone() }
            };
            (*sheet_id, *row, *col, input)
        })
        .collect();
    mutation_set_cells_by_position(stores, mirror, edits, false)
}

/// Import typed values and optional formula source through the lossless write path.
pub(in crate::storage::engine) fn import_values(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    updates: &[(u32, u32, CellValue, Option<String>)],
) -> Result<RecalcResult, ComputeError> {
    let edits = updates
        .iter()
        .map(|(row, col, value, formula)| (*sheet_id, *row, *col, value.clone(), formula.clone()))
        .collect();
    mutation_set_cells_by_position_raw(stores, mirror, edits, false)
}

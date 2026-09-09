use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;

use super::find_cell_id_at;

pub(in crate::storage::engine) fn sync_range_with_compute(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<crate::snapshot::RecalcResult, ComputeError> {
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();

    for row in start_row..=end_row {
        for col in start_col..=end_col {
            if let Some(cell_id) = find_cell_id_at(cell_store, sheet_id, row, col) {
                let value = cell_store
                    .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
                    .cloned()
                    .unwrap_or(CellValue::Null);
                let formula = crate::storage::engine::formula_read::formula_text_for_cell_id(
                    stores, cell_store, sheet_id, &cell_id,
                );
                edits.push((*sheet_id, cell_id, row, col, value, formula));
            }
        }
    }

    if edits.is_empty() {
        return Ok(crate::snapshot::RecalcResult::empty());
    }

    stores.compute.set_cells_raw(cell_store, &edits, false)
}

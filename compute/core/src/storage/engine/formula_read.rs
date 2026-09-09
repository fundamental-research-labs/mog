use cell_types::{CellId, SheetId};

use crate::cells::CellStore;

use super::stores::EngineStores;

pub(crate) fn formula_text_for_cell_id(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Option<String> {
    stores
        .compute
        .get_formula(cell_id)
        .map(str::to_owned)
        .or_else(|| {
            cell_store
                .get_formula(cell_id)
                .map(|formula| stores.compute.to_a1_display(cell_store, sheet_id, formula))
        })
}

pub(crate) fn formula_text_at(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    cell_id: Option<&CellId>,
) -> Option<String> {
    cell_id
        .and_then(|id| formula_text_for_cell_id(stores, cell_store, sheet_id, id))
        .or_else(|| {
            cell_store
                .cse_anchor_covering(sheet_id, row, col)
                .and_then(|(anchor_id, _)| {
                    formula_text_for_cell_id(stores, cell_store, sheet_id, &anchor_id)
                })
        })
        .or_else(|| super::data_table_formula::formula_at(cell_store, sheet_id, row, col))
}

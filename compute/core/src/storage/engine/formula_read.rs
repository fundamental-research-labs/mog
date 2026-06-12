use cell_types::{CellId, SheetId};

use crate::mirror::CellMirror;

use super::stores::EngineStores;

pub(crate) fn formula_text_for_cell_id(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Option<String> {
    stores
        .compute
        .get_formula(cell_id)
        .map(str::to_owned)
        .or_else(|| {
            mirror
                .get_formula(cell_id)
                .map(|formula| stores.compute.to_a1_display(mirror, sheet_id, formula))
        })
}

pub(crate) fn formula_text_at(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    cell_id: Option<&CellId>,
) -> Option<String> {
    cell_id
        .and_then(|id| formula_text_for_cell_id(stores, mirror, sheet_id, id))
        .or_else(|| {
            mirror
                .cse_anchor_covering(sheet_id, row, col)
                .and_then(|(anchor_id, _)| {
                    formula_text_for_cell_id(stores, mirror, sheet_id, &anchor_id)
                })
        })
        .or_else(|| super::data_table_formula::formula_at(mirror, sheet_id, row, col))
}

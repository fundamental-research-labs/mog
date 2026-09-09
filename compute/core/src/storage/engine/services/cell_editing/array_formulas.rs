use cell_types::{SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::history::cells::capture_cell;
use crate::storage::engine::stores::EngineStores;

use super::{a1_range_string, ensure_cell_id_mirrored, register_formula_cell_identities};

pub(in crate::storage::engine) fn set_array_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
    bottom_row: u32,
    right_col: u32,
    formula: &str,
) -> Result<RecalcResult, ComputeError> {
    if bottom_row < top_row || right_col < left_col {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "set_array_formula: invalid range ({},{})..=({},{})",
                top_row, left_col, bottom_row, right_col
            ),
        });
    }
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };
    // Capture the anchor before implicit identity registration grows the axes.
    let anchor_id = grid
        .cell_id_at(top_row, left_col)
        .or_else(|| mirror.resolve_cell_id(sheet_id, SheetPos::new(top_row, left_col)))
        .unwrap_or_else(|| stores.grid_id_alloc.next_cell_id());
    capture_cell(stores, mirror, *sheet_id, anchor_id, top_row, left_col);
    stores
        .grid_indexes
        .get_mut(sheet_id)
        .unwrap()
        .register_cell(anchor_id, top_row, left_col);
    // Share the native anchor identity with metadata writes on empty positions.
    ensure_cell_id_mirrored(stores, mirror, sheet_id, top_row, left_col);

    // Snapshot old anchor value for the change-set patch.
    let old_val = stores
        .compute
        .get_cell_value(mirror, &anchor_id)
        .cloned()
        .or_else(|| mirror.get_cell_value(&anchor_id).cloned())
        .unwrap_or(CellValue::Null);
    let old_formula = stores.compute.get_formula(&anchor_id).map(str::to_owned);

    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.register_cell(anchor_id, top_row, left_col);
    }

    // Replace imported result-mode metadata before evaluation so an authored
    // CSE formula cannot inherit a legacy scalar or dynamic-array declaration.
    let old_metadata = stores.storage.cell_metadata(&anchor_id).cloned();
    stores.storage.set_cell_metadata(
        anchor_id,
        crate::storage::CellMetadata {
            array_ref: Some(a1_range_string(top_row, left_col, bottom_row, right_col)),
            formula_result_mode: Some(crate::mirror::cell_metadata::FormulaResultMode::Cse),
            ..Default::default()
        },
    );
    crate::storage::engine::cell_metadata::refresh(&stores.storage, mirror, stores.layout_metrics);
    let mut result = match stores.compute.set_array_formula(
        mirror, sheet_id, anchor_id, top_row, left_col, bottom_row, right_col, formula,
    ) {
        Ok(result) => result,
        Err(error) => {
            if let Some(metadata) = old_metadata {
                stores.storage.set_cell_metadata(anchor_id, metadata);
            } else {
                stores.storage.clear_cell_metadata(anchor_id);
            }
            crate::storage::engine::cell_metadata::refresh(
                &stores.storage,
                mirror,
                stores.layout_metrics,
            );
            return Err(error);
        }
    };
    register_formula_cell_identities(stores, mirror, anchor_id);
    crate::storage::properties::clear_formula_cache_metadata_for_cell_ids(
        &mut stores.storage,
        sheet_id,
        &[anchor_id],
    );
    crate::storage::engine::cell_metadata::refresh(&stores.storage, mirror, stores.layout_metrics);

    // Patch before-side fields onto the seed change.
    let cell_id_str = anchor_id.to_uuid_string();
    for change in &mut result.changed_cells {
        if change.cell_id == cell_id_str {
            change.old_value = Some(old_val.clone());
            if change.old_formula.is_none() {
                change.old_formula = old_formula.clone();
            }
        }
    }

    Ok(result)
}

use cell_types::SheetId;
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::storage::engine::stores::EngineStores;

use super::{a1_range_string, ensure_cell_id, sync_grid_axes};

pub(in crate::storage::engine) fn set_array_formula(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
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
    let anchor_id =
        ensure_cell_id(stores, cell_store, sheet_id, top_row, left_col).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            }
        })?;

    // Snapshot old anchor value for the change-set patch.
    let old_val = stores
        .compute
        .get_cell_value(cell_store, &anchor_id)
        .cloned()
        .or_else(|| cell_store.get_cell_value(&anchor_id).cloned())
        .unwrap_or(CellValue::Null);
    let old_formula = stores.compute.get_formula(&anchor_id).map(str::to_owned);

    // Replace imported result-mode metadata before evaluation so an authored
    // CSE formula cannot inherit a legacy scalar or dynamic-array declaration.
    let old_metadata = stores.storage.cell_metadata(&anchor_id).cloned();
    stores.storage.set_cell_metadata(
        anchor_id,
        crate::storage::CellMetadata {
            array_ref: Some(a1_range_string(top_row, left_col, bottom_row, right_col)),
            formula_result_mode: Some(crate::cells::cell_metadata::FormulaResultMode::Cse),
            ..Default::default()
        },
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    let mut result = match stores.compute.set_array_formula(
        cell_store, sheet_id, anchor_id, top_row, left_col, bottom_row, right_col, formula,
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
                cell_store,
                stores.layout_metrics,
            );
            return Err(error);
        }
    };
    sync_grid_axes(stores, cell_store);
    crate::storage::properties::clear_formula_cache_metadata_for_cell_ids(
        &mut stores.storage,
        sheet_id,
        &[anchor_id],
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );

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

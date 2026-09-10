use std::collections::HashMap;

use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::storage::engine::services::cell_editing::{NO_OLD_FORMULA_SENTINEL, sync_grid_axes};
use crate::storage::engine::stores::EngineStores;

use super::edits::{canonicalize_resolved_raw_edits, validate_edit_bounds};
use super::identity_registration::register_cell_positions;
use super::imported_array_caches;

pub(in crate::storage::engine) fn mutation_set_cells_raw(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    skip_cycle_check: bool,
) -> Result<RecalcResult, ComputeError> {
    mutation_set_cells_raw_with_trust(
        stores,
        cell_store,
        edits,
        skip_cycle_check,
        crate::scheduler::WriteTrust::UserEdit,
    )
}

pub(in crate::storage::engine) fn mutation_set_cells_raw_with_trust(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    skip_cycle_check: bool,
    trust: crate::scheduler::WriteTrust,
) -> Result<RecalcResult, ComputeError> {
    let edits = canonicalize_resolved_raw_edits(edits)?;
    validate_edit_bounds(
        edits
            .iter()
            .map(|(sheet_id, _, row, col, _, _)| (*sheet_id, *row, *col)),
    )?;
    if matches!(trust, crate::scheduler::WriteTrust::UserEdit) {
        stores
            .compute
            .validate_raw_user_edit_region_writes(cell_store, &edits)?;
    }
    // Viewport-only deferred imports reject graph construction. Do that
    // preflight before history, identity, and metadata are mutated below.
    stores.compute.ensure_graph_construction_ready()?;

    for (sheet, cell, row, col, _, _) in &edits {
        crate::storage::engine::history::cells::capture_cell(
            stores, cell_store, *sheet, *cell, *row, *col,
        );
    }

    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(edits.len());
    let mut direct_edit_old_formulas: HashMap<CellId, String> = HashMap::with_capacity(edits.len());

    for (sheet_id, cell_id, row, col, _, _) in &edits {
        // Snapshot old value from cell_store BEFORE anything overwrites it.
        let old_val = cell_store
            .get_cell_value(cell_id)
            .or_else(|| cell_store.get_cell_value_at(sheet_id, SheetPos::new(*row, *col)))
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(*cell_id, old_val);
        let old_formula = stores.compute.get_formula(cell_id).or_else(|| {
            cell_store
                .resolve_cell_id(sheet_id, SheetPos::new(*row, *col))
                .and_then(|id| stores.compute.get_formula(&id))
        });
        if let Some(old_formula) = old_formula {
            direct_edit_old_formulas.insert(*cell_id, old_formula.to_string());
        }
    }

    register_cell_positions(
        stores,
        cell_store,
        edits
            .iter()
            .map(|(sheet_id, cell_id, row, col, _, _)| (*sheet_id, *cell_id, *row, *col)),
    )?;
    let mut cache_metadata_cells: HashMap<SheetId, Vec<CellId>> = HashMap::new();
    for (sheet_id, cell_id, _, _, _, _) in &edits {
        stores.storage.clear_cell_metadata(*cell_id);
        // A single-cell imported CSE marker is runtime declaration state too.
        // Ordinary authored replacement must not retain its scalar-only behavior.
        cell_store.cse_single_cell.remove(cell_id);
        cache_metadata_cells
            .entry(*sheet_id)
            .or_default()
            .push(*cell_id);
    }
    for (sheet_id, cell_ids) in cache_metadata_cells {
        crate::storage::properties::clear_formula_cache_metadata_for_cell_ids(
            &mut stores.storage,
            &sheet_id,
            &cell_ids,
        );
    }

    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );

    // Raw edits power copy, fill, paste, and scenario paths. They need the
    // same pre-scheduler retirement as parsed edits so an imported spill's
    // old cached children cannot block a replacement of its anchor.
    imported_array_caches::retire_for_positions(
        cell_store,
        edits
            .iter()
            .map(|(sheet_id, _, row, col, _, _)| (*sheet_id, *row, *col)),
    );
    // 5. Delegate to ComputeCore for recalculation via lossless entry point.
    //    For formula edits, `process_value_input` owns the cell store update and
    //    will preserve the prior value as a seed when the formula matches.
    //
    //    Stream A′ trust marker: user-driven callers (fill, paste, move,
    //    import) pass `WriteTrust::UserEdit`, so partial writes
    //    into a CSE / Data Table region still reject. Engine-owned region
    //    materialization can pass `TrustedReplay` after validating the parent
    //    operation atomically.
    let mut result =
        match stores
            .compute
            .set_cells_raw_with_trust(cell_store, &edits, skip_cycle_check, trust)
        {
            Ok(result) => result,
            Err(error) => {
                imported_array_caches::restore_after_rejection(stores, cell_store);
                return Err(error);
            }
        };
    imported_array_caches::commit(stores, cell_store);
    sync_grid_axes(stores, cell_store);

    // Patch before-side fields onto seed changes. Direct formula edits can
    // arrive from the scheduler with old_value=Null because the formula body
    // changed; the user-facing change record still needs the pre-edit value.
    for change in &mut result.changed_cells {
        if let Ok(cid) = CellId::from_uuid_str(&change.cell_id) {
            let mut matched_direct_edit = false;
            if let Some(old) = direct_edit_old_values.remove(&cid) {
                change.old_value = Some(old);
                matched_direct_edit = true;
            }
            if matched_direct_edit && change.old_formula.is_none() {
                change.old_formula = Some(
                    direct_edit_old_formulas
                        .remove(&cid)
                        .unwrap_or_else(|| NO_OLD_FORMULA_SENTINEL.to_string()),
                );
            }
        }
    }

    Ok(result)
}

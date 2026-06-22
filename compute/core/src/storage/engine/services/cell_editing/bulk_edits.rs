use cell_types::{CellId, SheetId};
use std::collections::HashMap;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::cells::values as cell_values;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::{
    NO_OLD_FORMULA_SENTINEL, cell_id_for_region_guard, find_cell_id_at,
    persist_cell_formula_identity,
};

type PositionKey = (u32, u32);

fn patch_change_before_snapshot(
    change: &mut snapshot_types::CellChange,
    old_values_by_id: &mut HashMap<CellId, CellValue>,
    old_formulas_by_id: &mut HashMap<CellId, String>,
    old_values_by_position: &mut HashMap<PositionKey, CellValue>,
    old_formulas_by_position: &mut HashMap<PositionKey, String>,
) {
    let position = change.position.as_ref().map(|pos| (pos.row, pos.col));
    let mut matched_direct_edit = false;
    let mut old_formula: Option<String> = None;

    if let Ok(cid) = CellId::from_uuid_str(&change.cell_id) {
        if let Some(old) = old_values_by_id.remove(&cid) {
            change.old_value = Some(old);
            matched_direct_edit = true;
        }
        old_formula = old_formulas_by_id.remove(&cid);
    }

    if let Some(position) = position {
        if !matched_direct_edit && let Some(old) = old_values_by_position.remove(&position) {
            change.old_value = Some(old);
            matched_direct_edit = true;
        }
        if old_formula.is_none() {
            old_formula = old_formulas_by_position.remove(&position);
        } else {
            old_formulas_by_position.remove(&position);
        }
    }

    if matched_direct_edit && change.old_formula.is_none() {
        change.old_formula =
            Some(old_formula.unwrap_or_else(|| NO_OLD_FORMULA_SENTINEL.to_string()));
    }
}

pub(in crate::storage::engine) fn set_cell_values_parsed(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    updates: &[(u32, u32, String)],
) -> Result<RecalcResult, ComputeError> {
    // Snapshot old values from mirror BEFORE the batch write updates them.
    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(updates.len());
    let mut direct_edit_old_formulas: HashMap<CellId, String> =
        HashMap::with_capacity(updates.len());
    let mut direct_edit_old_values_by_position: HashMap<PositionKey, CellValue> =
        HashMap::with_capacity(updates.len());
    let mut direct_edit_old_formulas_by_position: HashMap<PositionKey, String> =
        HashMap::with_capacity(updates.len());
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for (row, col, _) in updates {
            let cell_id = grid.cell_id_at(*row, *col);
            let old_val = cell_id
                .as_ref()
                .and_then(|cell_id| {
                    stores
                        .compute
                        .get_cell_value(mirror, cell_id)
                        .cloned()
                        .or_else(|| mirror.get_cell_value(cell_id).cloned())
                })
                .unwrap_or(CellValue::Null);
            direct_edit_old_values_by_position.insert((*row, *col), old_val.clone());

            if let Some(cell_id) = cell_id {
                direct_edit_old_values.insert(cell_id, old_val);
                if let Some(old_formula) = stores.compute.get_formula(&cell_id) {
                    let old_formula = old_formula.to_string();
                    direct_edit_old_formulas.insert(cell_id, old_formula.clone());
                    direct_edit_old_formulas_by_position.insert((*row, *col), old_formula);
                }
            }
        }
    } else {
        for (row, col, _) in updates {
            direct_edit_old_values_by_position.insert((*row, *col), CellValue::Null);
        }
    }

    // sub-scope/A: carry each raw user string as `CellInput::Parse { text }`.
    // The dispatcher inside `cell_values::set_cell_values` classifies each
    // exactly once via `CellWrite::from_user_string`.
    let typed_updates: Vec<(u32, u32, CellInput)> = updates
        .iter()
        .map(|(r, c, s)| {
            (
                *r,
                *c,
                CellInput::Parse {
                    text: s.to_string(),
                },
            )
        })
        .collect();
    let guard_edits: Vec<(SheetId, CellId, u32, u32, CellInput)> = typed_updates
        .iter()
        .map(|(row, col, input)| {
            (
                *sheet_id,
                cell_id_for_region_guard(stores, mirror, sheet_id, *row, *col),
                *row,
                *col,
                input.clone(),
            )
        })
        .collect();
    stores
        .compute
        .validate_region_partial_writes(mirror, &guard_edits)?;

    mutation.observer.set_suppressed(true);
    {
        let storage_ref: &crate::storage::YrsStorage = &stores.storage;
        let doc = storage_ref.doc();
        let sheets = storage_ref.sheets();
        // Route identity through the in-memory grid_index (the authoritative
        // identity store populated by every hydration path).
        let Some(grid_index) = stores.grid_indexes.get_mut(sheet_id) else {
            mutation.observer.set_suppressed(false);
            return Ok(RecalcResult::empty());
        };
        cell_values::set_cell_values(
            storage_ref,
            doc,
            sheets,
            mirror,
            sheet_id,
            typed_updates,
            &stores.grid_id_alloc,
            grid_index,
        );
    }
    mutation.observer.set_suppressed(false);

    let mut edits: Vec<(SheetId, CellId, u32, u32, CellInput)> = Vec::with_capacity(updates.len());
    let mut format_hints: Vec<Option<compute_formats::FormatType>> =
        Vec::with_capacity(updates.len());
    for (row, col, input) in updates {
        let cell_id = find_cell_id_at(stores, sheet_id, *row, *col);
        if let Some(cell_id) = cell_id {
            if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                grid.register_cell(cell_id, *row, *col);
            }
            // This path comes from `set_cell_values_parsed` — rich-parse
            // semantics. Empty strings mean Clear here (no literal-text sentinel
            // since the API accepts only String inputs).
            let cell_input = if input.is_empty() {
                CellInput::Clear
            } else {
                CellInput::Parse {
                    text: input.clone(),
                }
            };
            // Resolve the format hint per cell so the scheduler-side
            // classifier matches the format-aware shape we already wrote
            // to yrs. `Clear` arms get `None` (no hint
            // needed — Clear doesn't classify).
            let hint = if matches!(cell_input, CellInput::Parse { .. }) {
                let grid = stores.grid_indexes.get(sheet_id);
                grid.and_then(|g| {
                    use crate::storage::properties;
                    let format = match g.cell_id_at(*row, *col) {
                        Some(cid) => {
                            let cell_hex = compute_document::hex::id_to_hex(cid.as_u128());
                            properties::get_effective_format(
                                &stores.storage,
                                sheet_id,
                                &cell_hex,
                                *row,
                                *col,
                                None,
                                Some(g),
                                mirror.get_sheet(sheet_id),
                            )
                        }
                        None => properties::get_positional_format(
                            &stores.storage,
                            sheet_id,
                            *row,
                            *col,
                            Some(g),
                            mirror.get_sheet(sheet_id),
                        ),
                    };
                    format
                        .number_format
                        .as_deref()
                        .map(compute_formats::detect_format_type)
                })
            } else {
                None
            };
            edits.push((*sheet_id, cell_id, *row, *col, cell_input));
            format_hints.push(hint);
        }
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    let mut result = stores
        .compute
        .set_cells_with_targets(mirror, &edits, &format_hints, false)?;
    {
        let _guard = mutation.suppress_guard();
        for (sheet_id, cell_id, _, _, _) in &edits {
            persist_cell_formula_identity(stores, mirror, sheet_id, *cell_id)?;
        }
    }

    // Patch before-side fields onto seed changes (direct edits). Matching by
    // position preserves snapshots even when rich-value storage reallocates a
    // cell identity during formula/text transitions.
    for change in &mut result.changed_cells {
        patch_change_before_snapshot(
            change,
            &mut direct_edit_old_values,
            &mut direct_edit_old_formulas,
            &mut direct_edit_old_values_by_position,
            &mut direct_edit_old_formulas_by_position,
        );
    }

    Ok(result)
}

/// Import pre-parsed cell values in bulk.
pub(in crate::storage::engine) fn import_values(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    updates: &[(u32, u32, CellValue, Option<String>)],
) -> Result<RecalcResult, ComputeError> {
    let guard_edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = updates
        .iter()
        .map(|(row, col, value, formula)| {
            (
                *sheet_id,
                cell_id_for_region_guard(stores, mirror, sheet_id, *row, *col),
                *row,
                *col,
                value.clone(),
                formula.clone(),
            )
        })
        .collect();
    stores
        .compute
        .validate_raw_user_edit_region_writes(mirror, &guard_edits)?;

    // Snapshot old values from mirror BEFORE the bulk import updates them.
    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(updates.len());
    let mut direct_edit_old_formulas: HashMap<CellId, String> =
        HashMap::with_capacity(updates.len());
    let mut direct_edit_old_values_by_position: HashMap<PositionKey, CellValue> =
        HashMap::with_capacity(updates.len());
    let mut direct_edit_old_formulas_by_position: HashMap<PositionKey, String> =
        HashMap::with_capacity(updates.len());
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for (row, col, _, _) in updates {
            let cell_id = grid.cell_id_at(*row, *col);
            let old_val = cell_id
                .as_ref()
                .and_then(|cell_id| {
                    stores
                        .compute
                        .get_cell_value(mirror, cell_id)
                        .cloned()
                        .or_else(|| mirror.get_cell_value(cell_id).cloned())
                })
                .unwrap_or(CellValue::Null);
            direct_edit_old_values_by_position.insert((*row, *col), old_val.clone());

            if let Some(cell_id) = cell_id {
                direct_edit_old_values.insert(cell_id, old_val);
                if let Some(old_formula) = stores.compute.get_formula(&cell_id) {
                    let old_formula = old_formula.to_string();
                    direct_edit_old_formulas.insert(cell_id, old_formula.clone());
                    direct_edit_old_formulas_by_position.insert((*row, *col), old_formula);
                }
            }
        }
    } else {
        for (row, col, _, _) in updates {
            direct_edit_old_values_by_position.insert((*row, *col), CellValue::Null);
        }
    }

    mutation.observer.set_suppressed(true);
    {
        let doc = stores.storage.doc();
        let sheets = stores.storage.sheets();
        // Route identity through the in-memory grid_index (the authoritative
        // identity store populated by every hydration path).
        let Some(grid_index) = stores.grid_indexes.get_mut(sheet_id) else {
            mutation.observer.set_suppressed(false);
            return Ok(RecalcResult::empty());
        };
        cell_values::import_values(
            doc,
            sheets,
            mirror,
            sheet_id,
            updates,
            &stores.grid_id_alloc,
            grid_index,
        );
    }
    mutation.observer.set_suppressed(false);

    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> =
        Vec::with_capacity(updates.len());
    for (row, col, value, formula) in updates {
        let cell_id = find_cell_id_at(stores, sheet_id, *row, *col);
        if let Some(cell_id) = cell_id {
            if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                grid.register_cell(cell_id, *row, *col);
            }
            edits.push((
                *sheet_id,
                cell_id,
                *row,
                *col,
                value.clone(),
                formula.clone(),
            ));
        }
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    // Stream A′ trust marker: `import_values` is a user-driven path
    // (paste, drag-fill, set-by-position), so partial writes into a
    // CSE / Data Table region MUST reject. The unified region guard at
    // `scheduler/edit.rs::set_cells_raw_with_trust` enforces this.
    let mut result = stores.compute.set_cells_raw_with_trust(
        mirror,
        &edits,
        false,
        crate::scheduler::WriteTrust::UserEdit,
    )?;
    {
        let _guard = mutation.suppress_guard();
        for (sheet_id, cell_id, _, _, _, _) in &edits {
            persist_cell_formula_identity(stores, mirror, sheet_id, *cell_id)?;
        }
    }

    // Patch before-side fields onto seed changes (direct edits). Matching by
    // position preserves snapshots even when rich-value storage reallocates a
    // cell identity during formula/text transitions.
    for change in &mut result.changed_cells {
        patch_change_before_snapshot(
            change,
            &mut direct_edit_old_values,
            &mut direct_edit_old_formulas,
            &mut direct_edit_old_values_by_position,
            &mut direct_edit_old_formulas_by_position,
        );
    }

    Ok(result)
}

use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::cells::values as cell_values;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::find_cell_id_at;

pub(in crate::storage::engine) fn set_cell_values_parsed(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    updates: &[(u32, u32, String)],
) -> Result<RecalcResult, ComputeError> {
    // Snapshot old values from mirror BEFORE the batch write updates them.
    let mut direct_edit_old_values: std::collections::HashMap<CellId, CellValue> =
        std::collections::HashMap::with_capacity(updates.len());
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for (row, col, _) in updates {
            if let Some(cell_id) = grid.cell_id_at(*row, *col) {
                let old_val = mirror
                    .get_cell_value(&cell_id)
                    .cloned()
                    .unwrap_or(CellValue::Null);
                direct_edit_old_values.insert(cell_id, old_val);
            }
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

    use crate::storage::engine::mutation::CellInput;
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

    // Patch old_value onto seed changes (direct edits) that don't already have one.
    for change in &mut result.changed_cells {
        if change.old_value.is_none()
            && let Ok(cid) = CellId::from_uuid_str(&change.cell_id)
            && let Some(old) = direct_edit_old_values.remove(&cid)
        {
            change.old_value = Some(old);
        }
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
    // Snapshot old values from mirror BEFORE the bulk import updates them.
    let mut direct_edit_old_values: std::collections::HashMap<CellId, CellValue> =
        std::collections::HashMap::with_capacity(updates.len());
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for (row, col, _, _) in updates {
            if let Some(cell_id) = grid.cell_id_at(*row, *col) {
                let old_val = mirror
                    .get_cell_value(&cell_id)
                    .cloned()
                    .unwrap_or(CellValue::Null);
                direct_edit_old_values.insert(cell_id, old_val);
            }
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

    // Patch old_value onto seed changes (direct edits) that don't already have one.
    for change in &mut result.changed_cells {
        if change.old_value.is_none()
            && let Ok(cid) = CellId::from_uuid_str(&change.cell_id)
            && let Some(old) = direct_edit_old_values.remove(&cid)
        {
            change.old_value = Some(old);
        }
    }

    Ok(result)
}

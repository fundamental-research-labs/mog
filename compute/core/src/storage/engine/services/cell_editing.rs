//! Cell editing helpers extracted as free functions.
//!
//! These functions handle low-level cell manipulation in the Yrs document
//! and grid indexes without touching the observer or compute scheduler.

use cell_types::{CellId, SheetId};
use value_types::CellValue;
use yrs::{Map, MapRef, Origin, Out, Transact, TransactionMut};

use crate::storage::cells::values::write_cell_position_to_yrs;
use crate::storage::engine::stores::EngineStores;
use compute_document::cell_serde::build_cell_prelim;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_CELLS;
use compute_document::undo::ORIGIN_USER_EDIT;

/// Write a cell value to the yrs Doc with ORIGIN_USER_EDIT.
///
/// Writes the cell data to the "cells" sub-map and mirrors the position
/// into `gridIndex/{posToId, idToPos}` (the authoritative yrs-side
/// identity store post-GridIndex migration) so that observer consumers —
/// undo/redo and `build_sheet_snapshot_from_yrs` structural rebuild —
/// can resolve `(row, col)` after the in-memory `GridIndex` has been
/// cleared.
///
/// Identity registration in the in-memory `GridIndex` is still the
/// caller's responsibility via `stores.grid_indexes.register_cell` /
/// `ensure_cell_id`; this function reads `row`/`col` hex IDs from that
/// index to build the yrs-side mapping.
pub(in crate::storage::engine) fn write_cell_to_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    value: &CellValue,
    formula: Option<&str>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Resolve row/col hex from the in-memory GridIndex BEFORE opening the
    // write transaction (the index is the sole identity authority; the
    // yrs-side mapping is a mirror for observer recovery).
    let (row_hex, col_hex) = stores
        .grid_indexes
        .get(sheet_id)
        .map(|g| (g.row_id_hex(row), g.col_id_hex(col)))
        .unwrap_or((None, None));

    // Get the sheets MapRef BEFORE creating the write transaction.
    // get_or_insert_map may internally acquire a write lock, so calling
    // it while a transact_mut is already active would deadlock.
    let sheets_map = stores.storage.doc().get_or_insert_map("sheets");

    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Mirror the position into gridIndex/{posToId, idToPos} so
    // observer-driven paths (undo/redo, structural rebuild) can resolve
    // (row, col) from yrs when the in-memory GridIndex is stale/cleared.
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_to_yrs_in_txn(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            cell_id,
            rh.as_str(),
            ch.as_str(),
            value,
            formula,
        );
    }
}

/// Transaction-scoped variant of [`write_cell_to_yrs`].
///
/// Bulk mutation paths use this after pre-growing dimensions and resolving
/// row/column ids so the whole batch commits as one user edit transaction.
pub(in crate::storage::engine) fn write_cell_to_yrs_in_txn(
    txn: &mut TransactionMut<'_>,
    sheets_map: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    row_hex: &str,
    col_hex: &str,
    value: &CellValue,
    formula: Option<&str>,
) {
    let cell_hex = id_to_hex(cell_id.as_u128());

    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&*txn, sheet_hex)
        && let Some(Out::YMap(cells_map)) = sheet_map.get(&*txn, KEY_CELLS)
    {
        let cell_prelim = build_cell_prelim(value, formula, None);
        cells_map.insert(txn, &*cell_hex, cell_prelim);
    }

    write_cell_position_to_yrs(txn, sheets_map, sheet_hex, &cell_hex, row_hex, col_hex);
}

/// Look up a CellId at a given (sheet, row, col) from the authoritative
/// in-memory grid index.
pub(in crate::storage::engine) fn find_cell_id_at(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col)
}

/// Mirror-aware variant of [`find_cell_id_at`].
///
/// When the GridIndex has no CellId at `(row, col)`, checks the mirror's
/// Range spatial index. If the position falls inside a Range, derives and
/// pre-registers the virtual CellId so that the caller (and any subsequent
/// `ensure_cell_id`) returns the deterministic virtual ID instead of
/// minting a fresh random one.
pub(in crate::storage::engine) fn find_cell_id_at_mirrored(
    stores: &mut EngineStores,
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    // Fast path: already registered.
    if let Some(cid) = stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col) {
        return Some(cid);
    }

    // Check the mirror for Range coverage and pre-register if found.
    let grid = stores.grid_indexes.get_mut(sheet_id)?;
    crate::storage::cells::values::maybe_register_virtual_cell_id(mirror, sheet_id, grid, row, col);

    // Re-check — will succeed if a virtual CellId was just registered.
    stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col)
}

// ---------------------------------------------------------------------------
// Cell editing: write + build edits (for set_cell_value_parsed etc.)
// ---------------------------------------------------------------------------

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::cells::values as cell_values;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use value_types::ComputeError;

/// Write a single cell value using rich input parsing, then build edits for ComputeCore.
///
/// Suppresses the observer during the yrs write, performs the cell_values write,
/// resolves cell_id from grid indexes, and returns the recalc result.
pub(in crate::storage::engine) fn set_cell_value_parsed(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    raw_input: &str,
) -> Result<RecalcResult, ComputeError> {
    // Snapshot old value from mirror BEFORE the cell_values write updates it.
    // Try to resolve cell_id from grid index; for new cells, old value is Null.
    let pre_cell_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col));
    let old_val = pre_cell_id
        .and_then(|cid| mirror.get_cell_value(&cid).cloned())
        .unwrap_or(CellValue::Null);

    mutation.observer.set_suppressed(true);
    {
        // Borrow `stores.storage` immutably for the duration of this block;
        // the format-aware dispatch inside `set_cell_value` reads its
        // cascade through this borrow.
        let storage_ref: &crate::storage::YrsStorage = &stores.storage;
        let doc = storage_ref.doc();
        let sheets = storage_ref.sheets();
        // Route identity through the in-memory grid_index — the sole
        // identity authority mapping (sheet, row, col) ↔ CellId.
        let Some(grid_index) = stores.grid_indexes.get_mut(sheet_id) else {
            mutation.observer.set_suppressed(false);
            return Ok(RecalcResult::empty());
        };
        // sub-scope/A: carry the raw user string as `CellInput::Parse { text }`.
        // The dispatcher inside `cell_values::set_cell_value` classifies
        // exactly once via `CellWrite::from_user_string`; no downstream
        // consumer re-sniffs `starts_with('=')`.
        let input = CellInput::Parse {
            text: raw_input.to_string(),
        };
        cell_values::set_cell_value(
            storage_ref,
            doc,
            sheets,
            mirror,
            sheet_id,
            row,
            col,
            input,
            &stores.grid_id_alloc,
            grid_index,
        );
    }
    mutation.observer.set_suppressed(false);

    // Look up the cell_id that was created/updated
    let cell_id = stores
        .grid_indexes
        .get_mut(sheet_id)
        .and_then(|g| g.cell_id_at(row, col))
        .or_else(|| {
            let cid = find_cell_id_at(stores, sheet_id, row, col);
            if let Some(cid) = cid
                && let Some(grid) = stores.grid_indexes.get_mut(sheet_id)
            {
                grid.register_cell(cid, row, col);
            }
            cid
        });

    if let Some(cell_id) = cell_id {
        // If the position is beyond GridIndex bounds, rebuild from YArrays
        // (the cell write may have auto-expanded rowOrder/colOrder)
        if let Some(grid) = stores.grid_indexes.get(sheet_id) {
            if row >= grid.row_count() || col >= grid.col_count() {
                let snap = crate::snapshot::SheetSnapshot {
                    id: sheet_id.to_uuid_string(),
                    name: String::new(),
                    rows: std::cmp::max(grid.row_count(), row + 1),
                    cols: std::cmp::max(grid.col_count(), col + 1),
                    cells: vec![],
                    ranges: vec![],
                };
                let mut new_grid = super::super::build_grid_from_yrs_for_sheet(
                    &stores.storage,
                    *sheet_id,
                    &snap,
                    stores.grid_id_alloc.clone(),
                );
                // Carry over existing cell registrations
                if let Some(old_grid) = stores.grid_indexes.get(sheet_id) {
                    for (cid, r, c) in old_grid.cells() {
                        new_grid.register_cell(cid, r, c);
                    }
                }
                new_grid.register_cell(cell_id, row, col);
                stores.grid_indexes.insert(*sheet_id, new_grid);
            } else if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                grid.register_cell(cell_id, row, col);
            }
        }
        // Format-aware classification already ran inside
        // `cell_values::set_cell_value`; re-classifying inside
        // `process_input` (via `compute.set_cell(... raw_input)`) would
        // be format-BLIND. Pass the resolved hint through `set_cell_with_target`
        // so the scheduler-side classifier matches the value we just wrote.
        let target = {
            let grid = stores.grid_indexes.get(sheet_id);
            grid.and_then(|g| {
                use crate::storage::properties;
                let format = match g.cell_id_at(row, col) {
                    Some(cid) => {
                        let cell_hex = compute_document::hex::id_to_hex(cid.as_u128());
                        properties::get_effective_format(
                            &stores.storage,
                            sheet_id,
                            &cell_hex,
                            row,
                            col,
                            None,
                            Some(g),
                            mirror.get_sheet(sheet_id),
                        )
                    }
                    None => properties::get_positional_format(
                        &stores.storage,
                        sheet_id,
                        row,
                        col,
                        Some(g),
                        mirror.get_sheet(sheet_id),
                    ),
                };
                format
                    .number_format
                    .as_deref()
                    .map(compute_formats::detect_format_type)
            })
        };
        let mut result = stores
            .compute
            .set_cell_with_target(mirror, sheet_id, cell_id, row, col, raw_input, target)?;

        // Patch old_value onto the seed change for this direct edit.
        let cell_id_str = cell_id.to_uuid_string();
        for change in &mut result.changed_cells {
            if change.old_value.is_none() && change.cell_id == cell_id_str {
                change.old_value = Some(old_val.clone());
            }
        }
        return Ok(result);
    }

    Ok(RecalcResult::empty())
}

/// Write a single cell value as literal text (forcedTextMode), then build
/// edits for ComputeCore.
///
/// Empty input maps to `CellInput::Clear` (removes the cell); non-empty
/// input strips the optional leading apostrophe and stores verbatim via
/// `CellInput::Literal { text }`. This is the sub-scope distinction: an
/// empty-string force-text edit *clears* the cell rather than storing
/// `Text("")`, preserving pre-sub-scope behaviour for the force-text path.
pub(in crate::storage::engine) fn set_cell_value_as_text(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
) -> Result<RecalcResult, ComputeError> {
    // Snapshot old value from mirror BEFORE the write updates it.
    let pre_cell_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col));
    let old_val = pre_cell_id
        .and_then(|cid| mirror.get_cell_value(&cid).cloned())
        .unwrap_or(CellValue::Null);

    mutation.observer.set_suppressed(true);
    {
        let storage_ref: &crate::storage::YrsStorage = &stores.storage;
        let doc = storage_ref.doc();
        let sheets = storage_ref.sheets();
        let Some(grid_index) = stores.grid_indexes.get_mut(sheet_id) else {
            mutation.observer.set_suppressed(false);
            return Ok(RecalcResult::empty());
        };
        let input = if value.is_empty() {
            CellInput::Clear
        } else {
            let stored = value.strip_prefix('\'').unwrap_or(value);
            CellInput::Literal {
                text: stored.to_string(),
            }
        };
        cell_values::set_cell_value(
            storage_ref,
            doc,
            sheets,
            mirror,
            sheet_id,
            row,
            col,
            input,
            &stores.grid_id_alloc,
            grid_index,
        );
    }
    mutation.observer.set_suppressed(false);

    let cell_id = find_cell_id_at(stores, sheet_id, row, col);
    if let Some(cell_id) = cell_id {
        if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
        let mut result = stores
            .compute
            .set_cell(mirror, sheet_id, cell_id, row, col, value)?;

        // Patch old_value onto the seed change for this direct edit.
        let cell_id_str = cell_id.to_uuid_string();
        for change in &mut result.changed_cells {
            if change.old_value.is_none() && change.cell_id == cell_id_str {
                change.old_value = Some(old_val.clone());
            }
        }
        return Ok(result);
    }

    Ok(RecalcResult::empty())
}

/// Batch-set cell values using rich input parsing.
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

/// Enter a CSE (`Ctrl+Shift+Enter`) array formula on a rectangular
/// range. Mirrors [`set_cell`] but routes through
/// [`crate::scheduler::ComputeCore::set_array_formula`] so the anchor
/// is marked CSE and the projection extent matches the user's
/// selection.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn set_array_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
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
    // Resolve / mint a CellId for the anchor in both the in-memory
    // grid index and the Yrs `gridIndex/{posToId, idToPos}` mirror.
    // Same path used by metadata writes on empty positions.
    let Some(anchor_id) = ensure_cell_id_mirrored(stores, mirror, sheet_id, top_row, left_col)
    else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };

    // Snapshot old anchor value for the change-set patch.
    let old_val = mirror
        .get_cell_value(&anchor_id)
        .cloned()
        .unwrap_or(CellValue::Null);

    // Write the formula text to Yrs (suppressed observer, so we own
    // the change-set construction). The body is normalized in the
    // scheduler too, but Yrs storage requires the leading `=`-stripped
    // form via `build_cell_prelim` (which `write_cell_to_yrs` calls).
    let formula_body = formula.trim_start().strip_prefix('=').unwrap_or(formula);

    mutation.observer.set_suppressed(true);
    write_cell_to_yrs(
        stores,
        sheet_id,
        anchor_id,
        top_row,
        left_col,
        &CellValue::Null,
        Some(formula_body),
    );
    mutation.observer.set_suppressed(false);

    mirror.apply_edit(
        sheet_id,
        anchor_id,
        cell_types::SheetPos::new(top_row, left_col),
        CellValue::Null,
        None,
    );

    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.register_cell(anchor_id, top_row, left_col);
    }

    let mut result = stores.compute.set_array_formula(
        mirror, sheet_id, anchor_id, top_row, left_col, bottom_row, right_col, formula,
    )?;

    // Persist the CSE marker into Yrs so the array-formula brace
    // survives Yrs undo/redo. unified-reference left this runtime-only
    // (mirror.cse_anchors), which meant undoing the CSE entry restored
    // the value but lost the brace — this is the legacy string-rewrite followup.
    //
    // Stored on the anchor cell as `KEY_ARRAY_REF`, mirroring OOXML
    // `<f t="array" ref="A1:C5">`. Hydration paths read this back into
    // `mirror.cse_anchors` + `projection_registry` (snapshot-types
    // already carries `array_ref` on `CellData`).
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let anchor_hex = id_to_hex(anchor_id.as_u128());
        let range_a1 = a1_range_string(top_row, left_col, bottom_row, right_col);
        let sheets_map = stores.storage.doc().get_or_insert_map("sheets");
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex)
            && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            && let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &anchor_hex)
        {
            compute_document::cell_serde::write_array_ref_to_yrs(&cell_map, &mut txn, &range_a1);
        }
    }

    // Patch old_value onto the seed change.
    let cell_id_str = anchor_id.to_uuid_string();
    for change in &mut result.changed_cells {
        if change.old_value.is_none() && change.cell_id == cell_id_str {
            change.old_value = Some(old_val.clone());
        }
    }

    Ok(result)
}

/// Format a 0-based `(top_row, left_col, bottom_row, right_col)` rectangle
/// as an A1 range string (e.g. `"A1:C5"`). Uses the canonical column
/// letter encoding from `cell_types`.
pub(in crate::storage::engine) fn a1_range_string(
    top_row: u32,
    left_col: u32,
    bottom_row: u32,
    right_col: u32,
) -> String {
    use cell_types::col_to_letter_buf;
    let mut s = String::with_capacity(16);
    col_to_letter_buf(left_col, &mut s);
    use std::fmt::Write;
    let _ = write!(&mut s, "{}", top_row + 1);
    s.push(':');
    col_to_letter_buf(right_col, &mut s);
    let _ = write!(&mut s, "{}", bottom_row + 1);
    s
}

/// Set a single cell with ORIGIN_USER_EDIT write, mirror update, grid registration, and recalc.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn set_cell(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    input: &crate::storage::engine::mutation::CellInput,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::engine::mutation::CellInput;
    let (value, formula) = match input {
        CellInput::Clear => (CellValue::Null, None),
        CellInput::Literal { text } => (CellValue::Text(text.clone().into()), None),
        CellInput::Parse { text } => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                (CellValue::Null, None)
            } else if let Some(stripped) = trimmed.strip_prefix('\'') {
                // Leading apostrophe = forced text mode (Excel convention).
                (CellValue::Text(stripped.to_string().into()), None)
            } else if trimmed.starts_with('=') {
                // Strip leading '=' for Yrs storage — KEY_FORMULA stores the
                // formula body only; get_raw_value() re-adds the '=' on read.
                (
                    CellValue::Null,
                    Some(trimmed.strip_prefix('=').unwrap_or(trimmed).to_string()),
                )
            } else {
                (super::parse_rich_value(trimmed), None)
            }
        }
    };

    mutation.observer.set_suppressed(true);
    write_cell_to_yrs(
        stores,
        sheet_id,
        cell_id,
        row,
        col,
        &value,
        formula.as_deref(),
    );
    mutation.observer.set_suppressed(false);

    // Snapshot old value from mirror BEFORE apply_edit overwrites it.
    let old_val = mirror
        .get_cell_value(&cell_id)
        .cloned()
        .unwrap_or(CellValue::Null);

    mirror.apply_edit(
        sheet_id,
        cell_id,
        cell_types::SheetPos::new(row, col),
        value,
        None,
    );

    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.register_cell(cell_id, row, col);
    }

    let mut result = stores
        .compute
        .set_cell(mirror, sheet_id, cell_id, row, col, input)?;

    // Patch old_value onto the seed change for this direct edit.
    let cell_id_str = cell_id.to_uuid_string();
    for change in &mut result.changed_cells {
        if change.old_value.is_none() && change.cell_id == cell_id_str {
            change.old_value = Some(old_val.clone());
        }
    }

    Ok(result)
}

/// Sync all cells in a range from yrs to mirror+compute.
///
/// Reads cell data from yrs, updates the mirror, and builds edits for
/// ComputeCore recalculation. Used after bulk operations (subtotals, sort)
/// that write directly to yrs.
pub(in crate::storage::engine) fn sync_range_with_compute(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<crate::snapshot::RecalcResult, ComputeError> {
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();

    for row in start_row..=end_row {
        for col in start_col..=end_col {
            if let Some(cell_id) = find_cell_id_at(stores, sheet_id, row, col)
                && let Some((value, formula, identity_formula)) =
                    stores.storage.read_cell_from_yrs(sheet_id, &cell_id)
            {
                mirror.apply_edit(
                    sheet_id,
                    cell_id,
                    cell_types::SheetPos::new(row, col),
                    value.clone(),
                    identity_formula,
                );
                edits.push((*sheet_id, cell_id, row, col, value, formula));
            }
        }
    }

    if edits.is_empty() {
        return Ok(crate::snapshot::RecalcResult::empty());
    }

    stores.compute.set_cells_raw(mirror, &edits, false)
}

// ---------------------------------------------------------------------------
// Grid index identity — central helper for marker-cell creation
// ---------------------------------------------------------------------------

/// Resolve an existing CellId at `(sheet, row, col)`, or mint a new one —
/// registering the identity in **both** the in-memory `GridIndex` and the
/// authoritative yrs `gridIndex/{posToId, idToPos}` sub-maps.
///
/// This is the single entry point for any write path that needs a CellId on
/// a possibly-empty position without writing a cell value — i.e. metadata
/// writes (comments/notes, cell formats on empty cells, hyperlinks,
/// data validation). Cell-*value* writes already route through
/// `cell_values::set_cell_value*`, which mirrors into `gridIndex` from
/// within its own Yrs transaction.
///
/// Returns `None` only if the sheet is not present in `stores.grid_indexes`.
///
/// ## Why both writes are required
///
/// The in-memory `GridIndex` is the runtime authority for *this* engine —
/// needed so the local follow-up payload write can key by `cell_hex`. The
/// yrs `gridIndex/posToId` mirror is the CRDT-synchronised authority —
/// needed so that remote peers' `DocumentObserver` can hydrate *their*
/// in-memory `GridIndex` (see
/// `storage::engine::apply_grid_index_changes`) and resolve this cell's
/// position after sync. Skipping either half silently breaks one side of
/// the collaboration boundary.
pub(in crate::storage::engine) fn ensure_cell_id_mirrored(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    // Fast path: cell already registered locally. The Yrs mirror was
    // written when the cell was first created, so nothing more to do.
    if let Some(grid) = stores.grid_indexes.get(sheet_id)
        && let Some(cid) = grid.cell_id_at(row, col)
    {
        return Some(cid);
    }

    // For Range-resident positions, pre-register the virtual CellId so
    // ensure_cell_id returns it instead of minting a fresh random one.
    let grid = stores.grid_indexes.get_mut(sheet_id)?;
    cell_values::maybe_register_virtual_cell_id(mirror, sheet_id, grid, row, col);

    // Allocate a new CellId in the in-memory GridIndex and resolve its hexes
    // (O(1) via the grid) before dropping the borrow.
    let cell_id = grid.ensure_cell_id(row, col);
    let row_hex = grid.row_id_hex(row);
    let col_hex = grid.col_id_hex(col);

    // Mirror into yrs `gridIndex/{posToId, idToPos}` inside a scoped txn
    // so remote peers receive the identity alongside the payload write
    // the caller is about to perform.
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let sheets_map = stores.storage.doc().get_or_insert_map("sheets");
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        crate::storage::cells::values::write_cell_position_to_yrs(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            &cell_hex,
            rh.as_str(),
            ch.as_str(),
        );
    }
    Some(cell_id)
}

/// Persist identity mappings for every cell referenced by an [`IdentityFormula`]
/// into the in-memory `GridIndex` and the Yrs `gridIndex/{posToId, idToPos}`
/// sub-maps.
///
/// ## Why this exists
///
/// Named-range writes serialize `IdentityFormula` as JSON into the Yrs
/// document (typed formula boundary): the identity form — not the A1 text — is the
/// on-disk format for `DefinedName.refers_to`. For a remote peer to render
/// the reference back to A1 after CRDT sync, every `CellId` embedded in the
/// JSON must resolve to a `(sheet, row, col)` on that peer. That resolution
/// goes through the in-memory `GridIndex` / `CellMirror`, both of which are
/// hydrated from Yrs `gridIndex/posToId`. If the identity mapping isn't in
/// Yrs, the remote side renders `#REF!`.
///
/// Formula *cells* don't have this problem because each peer re-parses the
/// formula text through its own `IdentityResolver`, minting its own local
/// `CellId`s. But the named-range write path allocates `CellId`s only into
/// the local `CellMirror` (via `CoreIdentityResolver` → `ensure_cell_id`),
/// never into `GridIndex` or Yrs — so remote peers inherit orphan CellIds.
/// This helper closes that gap.
pub(in crate::storage::engine) fn persist_identity_formula_cell_identities(
    stores: &mut EngineStores,
    mirror: &crate::mirror::CellMirror,
    identity: &formula_types::IdentityFormula,
) {
    use formula_types::IdentityFormulaRef;

    // 1. Collect every CellId the IdentityFormula references. Row/Col refs
    //    use RowId/ColId, not CellId, so they don't participate here.
    let mut cell_ids: Vec<CellId> = Vec::with_capacity(identity.refs.len() * 2);
    for r in &identity.refs {
        match r {
            IdentityFormulaRef::Cell(c) => cell_ids.push(c.id),
            IdentityFormulaRef::Range(r) => {
                cell_ids.push(r.start_id);
                cell_ids.push(r.end_id);
            }
            IdentityFormulaRef::RectRange(_)
            | IdentityFormulaRef::FullRow(_)
            | IdentityFormulaRef::RowRange(_)
            | IdentityFormulaRef::FullCol(_)
            | IdentityFormulaRef::ColRange(_)
            | IdentityFormulaRef::ExternalCell(_)
            | IdentityFormulaRef::ExternalRange(_)
            | IdentityFormulaRef::ExternalName(_) => {}
        }
    }
    if cell_ids.is_empty() {
        return;
    }

    // 2. Resolve each CellId's (sheet, row, col) from the mirror. The mirror
    //    was just populated by `to_identity_formula` via `ensure_cell_id`,
    //    so every CellId should have a position; any that don't are silently
    //    skipped (treated as `#REF!` on render, matching existing contract).
    let mut to_register: Vec<(SheetId, CellId, u32, u32)> = Vec::with_capacity(cell_ids.len());
    for cell_id in cell_ids {
        let Some(sheet_id) = mirror.sheet_for_cell(&cell_id) else {
            continue;
        };
        let Some(pos) = mirror.resolve_position(&cell_id) else {
            continue;
        };
        to_register.push((sheet_id, cell_id, pos.row(), pos.col()));
    }
    if to_register.is_empty() {
        return;
    }

    // 3. Register in the in-memory GridIndex and collect the row/col hex IDs
    //    for the Yrs write. `register_cell` accepts a pre-allocated CellId
    //    (unlike `ensure_cell_id` which mints a new one), which is what we
    //    need here since the CellId was already minted by the IdentityResolver.
    //
    //    Collect the hex data in a separate vec so the Yrs transaction below
    //    doesn't have to hold a borrow on `stores.grid_indexes`.
    let mut yrs_writes: Vec<(
        SheetId,
        CellId,
        compute_document::hex::SmallHex,
        compute_document::hex::SmallHex,
    )> = Vec::with_capacity(to_register.len());
    for (sheet_id, cell_id, row, col) in to_register {
        let Some(grid) = stores.grid_indexes.get_mut(&sheet_id) else {
            continue;
        };
        grid.register_cell(cell_id, row, col);
        if let (Some(rh), Some(ch)) = (grid.row_id_hex(row), grid.col_id_hex(col)) {
            yrs_writes.push((sheet_id, cell_id, rh, ch));
        }
    }
    if yrs_writes.is_empty() {
        return;
    }

    // 4. Batch all posToId/idToPos writes into a single Yrs transaction so
    //    remote peers receive them as one update, ordered before the named-
    //    range JSON write the caller is about to perform.
    let sheets_map = stores.storage.doc().get_or_insert_map("sheets");
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    for (sheet_id, cell_id, rh, ch) in yrs_writes {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());
        crate::storage::cells::values::write_cell_position_to_yrs(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            &cell_hex,
            rh.as_str(),
            ch.as_str(),
        );
    }
}

use std::collections::{HashMap, HashSet};

use cell_types::{CellId, MAX_COLS, MAX_ROWS, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use rustc_hash::FxHashMap;
use value_types::{CellValue, ComputeError};
use yrs::{Map, Origin, Out, Transact};

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::snapshot::{PolicyPreservedParseOutcome, PolicyPreservedParseSummary, RecalcResult};
use crate::storage::YrsStorage;
use crate::storage::cells::values::InputParseContext;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

// ---------------------------------------------------------------------------
// mutation_set_cells
// ---------------------------------------------------------------------------

/// Batch-set cells with full store synchronization.
pub(in crate::storage::engine) fn mutation_set_cells(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    edits: Vec<(SheetId, CellId, u32, u32, CellInput)>,
    skip_cycle_check: bool,
) -> Result<RecalcResult, ComputeError> {
    let edits = canonicalize_resolved_cell_inputs(edits)?;
    validate_edit_bounds(
        edits
            .iter()
            .map(|(sheet_id, _, row, col, _)| (*sheet_id, *row, *col)),
    )?;
    stores
        .compute
        .validate_region_partial_writes(mirror, &edits)?;

    // Resolve the format hint for each Parse-arm edit BEFORE opening any
    // write txn (the cascade helpers in `properties` open their own
    // read-only txn, which would conflict with `transact_mut`). See
    // `compute/core/src/storage/cells/values.rs` `resolve_format_hint` for
    // the rationale.
    let format_hints: Vec<Option<compute_formats::FormatType>> = edits
        .iter()
        .map(|(sheet_id, _cid, row, col, input)| {
            if !matches!(input, CellInput::Parse { .. }) {
                return None;
            }
            let grid = stores.grid_indexes.get(sheet_id)?;
            use crate::storage::properties;
            let format = match grid.cell_id_at(*row, *col) {
                Some(cid) => {
                    let cell_hex = compute_document::hex::id_to_hex(cid.as_u128());
                    properties::get_effective_format(
                        &stores.storage,
                        sheet_id,
                        &cell_hex,
                        *row,
                        *col,
                        None,
                        Some(grid),
                        mirror.get_sheet(sheet_id),
                    )
                }
                None => properties::get_positional_format(
                    &stores.storage,
                    sheet_id,
                    *row,
                    *col,
                    Some(grid),
                    mirror.get_sheet(sheet_id),
                ),
            };
            format
                .number_format
                .as_deref()
                .map(compute_formats::detect_format_type)
        })
        .collect();
    let workbook_settings = crate::storage::workbook::settings::get_settings(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );
    let parse_contexts: Vec<InputParseContext> = format_hints
        .iter()
        .copied()
        .map(|target| InputParseContext {
            target,
            policy: workbook_settings.automatic_conversion_policy.clone(),
            culture: workbook_settings.culture.clone(),
            date1904: workbook_settings.date1904,
        })
        .collect();
    let mut preserved_outcomes = Vec::new();

    let _suppress = mutation.suppress_guard();

    // Snapshot old values from CellMirror BEFORE writes (read-before-write pattern).
    // These are used to populate CellChange.old_value on direct-edit seed cells.
    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(edits.len());

    let mut prepared_values = Vec::with_capacity(edits.len());
    for (idx, &(ref sheet_id, cell_id, row, col, ref input)) in edits.iter().enumerate() {
        let target = format_hints[idx];
        let context = &parse_contexts[idx];
        let (value, formula) = match input {
            CellInput::Clear => (CellValue::Null, None),
            CellInput::Literal { text } => (CellValue::Text(text.clone().into()), None),
            CellInput::Parse { text } => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    (CellValue::Null, None)
                } else if matches!(target, Some(compute_formats::FormatType::Text)) {
                    // Text-formatted cell stores any
                    // input — including formula-shaped strings and apostrophe
                    // prefixes — as the literal string. Beats both the `'`
                    // strip and the `=` formula branch.
                    (CellValue::Text(text.clone().into()), None)
                } else if let Some(stripped) = trimmed.strip_prefix('\'') {
                    // Leading apostrophe = forced text mode (Excel convention).
                    // Strip the prefix and store the remainder as literal text
                    // without formula interpretation or type coercion.
                    (CellValue::Text(stripped.to_string().into()), None)
                } else if trimmed.starts_with('=') {
                    // Strip leading '=' for Yrs storage — KEY_FORMULA stores body only
                    (
                        CellValue::Null,
                        Some(trimmed.strip_prefix('=').unwrap_or(trimmed).to_string()),
                    )
                } else {
                    // G1/G3 hint flows into `parse_input_value` via
                    // `parse_rich_value_with_target` (format-aware). When
                    // `target` is None the behaviour is unchanged.
                    let (value, category) =
                        super::super::parse_rich_value_with_context(text, context);
                    if let Some(category) = category {
                        preserved_outcomes.push(PolicyPreservedParseOutcome {
                            sheet_id: *sheet_id,
                            cell_id,
                            row,
                            col,
                            submitted_text: truncate_submitted_text(text),
                            category,
                        });
                    }
                    (value, None)
                }
            }
        };
        prepared_values.push((value, formula));
    }

    write_prepared_cell_inputs_to_yrs(stores, &edits, &prepared_values)?;

    for ((sheet_id, cell_id, row, col, _), (value, formula)) in
        edits.iter().zip(prepared_values.iter())
    {
        // Snapshot old value from mirror BEFORE anything overwrites it.
        let old_val = mirror
            .get_cell_value(cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(*cell_id, old_val);

        // Update mirror — ONLY for plain-value edits. For formula edits,
        //    `process_input` needs to see the prior cell value to detect
        //    "same formula re-entered" and preserve the converged
        //    iterative-calc seed. Pre-writing with `CellValue::Null`
        //    (formula branch's parsed value) would destroy the seed.
        if formula.is_none() {
            mirror.apply_edit(
                sheet_id,
                *cell_id,
                SheetPos::new(*row, *col),
                value.clone(),
                None,
            );
        }
    }

    // 5. Delegate to ComputeCore for recalculation. The Parse-arm hints
    //    (G1/G3) flow into `process_input` via `set_cells_with_targets`
    //    so the scheduler-side classifier matches the format-aware shape
    //    we just committed to yrs. Without the hint, `process_input` →
    //    `parse_plain_value` (format-blind) would overwrite the mirror
    //    with the wrong value.
    let mut result = stores.compute.set_cells_with_contexts(
        mirror,
        &edits,
        &parse_contexts,
        skip_cycle_check,
    )?;

    // Patch old_value onto seed changes (direct edits) that don't already have one.
    // Cascade changes already have old_value set by level_eval.rs.
    for change in &mut result.changed_cells {
        if change.old_value.is_none()
            && let Ok(cid) = CellId::from_uuid_str(&change.cell_id)
            && let Some(old) = direct_edit_old_values.remove(&cid)
        {
            change.old_value = Some(old);
        }
    }

    attach_policy_preserved_outcomes(&mut result, preserved_outcomes);
    Ok(result)
}

fn truncate_submitted_text(text: &str) -> String {
    const MAX_BYTES: usize = 128;
    if text.len() <= MAX_BYTES {
        return text.to_string();
    }
    let marker = "...";
    let limit = MAX_BYTES.saturating_sub(marker.len());
    let mut end = 0;
    for (idx, _) in text.char_indices() {
        if idx <= limit {
            end = idx;
        } else {
            break;
        }
    }
    format!("{}{}", text.get(..end).unwrap_or_default(), marker)
}

fn attach_policy_preserved_outcomes(
    result: &mut RecalcResult,
    outcomes: Vec<PolicyPreservedParseOutcome>,
) {
    if outcomes.is_empty() {
        return;
    }
    let total = outcomes.len() as u64;
    let emitted = outcomes.len().min(1000);
    let submitted_text_truncated_count = outcomes
        .iter()
        .take(emitted)
        .filter(|outcome| outcome.submitted_text.ends_with("..."))
        .count() as u64;
    result.policy_preserved_parse_outcomes = outcomes.into_iter().take(emitted).collect();
    let emitted_count = result.policy_preserved_parse_outcomes.len() as u64;
    let omitted_count = total.saturating_sub(emitted_count);
    result.policy_preserved_parse_summary = Some(PolicyPreservedParseSummary {
        total_preserved: total,
        emitted_count,
        omitted_count,
        outcome_entries_truncated: omitted_count > 0,
        submitted_text_truncated_count,
    });
}

fn validate_edit_bounds<I>(positions: I) -> Result<(), ComputeError>
where
    I: IntoIterator<Item = (SheetId, u32, u32)>,
{
    for (sheet_id, row, col) in positions {
        if row >= MAX_ROWS || col >= MAX_COLS {
            return Err(ComputeError::InvalidInput {
                message: format!(
                    "Cell position sheet={} row={} col={} exceeds sheet bounds rows={} cols={}",
                    sheet_id.to_uuid_string(),
                    row,
                    col,
                    MAX_ROWS,
                    MAX_COLS
                ),
            });
        }
    }
    Ok(())
}

fn canonicalize_resolved_cell_inputs(
    edits: Vec<(SheetId, CellId, u32, u32, CellInput)>,
) -> Result<Vec<(SheetId, CellId, u32, u32, CellInput)>, ComputeError> {
    let mut winning_ids = HashMap::new();
    let mut canonical = Vec::with_capacity(edits.len());
    for edit in edits.into_iter().rev() {
        let key = (edit.0, edit.2, edit.3);
        if let Some(winning_id) = winning_ids.get(&key) {
            if *winning_id != edit.1 {
                return Err(ComputeError::InvalidInput {
                    message: format!(
                        "Duplicate coordinate ({}, {}) in batch write has conflicting CellIds",
                        edit.2, edit.3
                    ),
                });
            }
            continue;
        }
        winning_ids.insert(key, edit.1);
        canonical.push(edit);
    }
    canonical.reverse();
    Ok(canonical)
}

fn canonicalize_resolved_raw_edits(
    edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
) -> Result<Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>, ComputeError> {
    let mut winning_ids = HashMap::new();
    let mut canonical = Vec::with_capacity(edits.len());
    for edit in edits.into_iter().rev() {
        let key = (edit.0, edit.2, edit.3);
        if let Some(winning_id) = winning_ids.get(&key) {
            if *winning_id != edit.1 {
                return Err(ComputeError::InvalidInput {
                    message: format!(
                        "Duplicate coordinate ({}, {}) in batch write has conflicting CellIds",
                        edit.2, edit.3
                    ),
                });
            }
            continue;
        }
        winning_ids.insert(key, edit.1);
        canonical.push(edit);
    }
    canonical.reverse();
    Ok(canonical)
}

fn canonicalize_position_cell_inputs(
    edits: Vec<(SheetId, u32, u32, CellInput)>,
) -> Vec<(SheetId, u32, u32, CellInput)> {
    let mut seen = HashSet::new();
    let mut canonical = Vec::with_capacity(edits.len());
    for edit in edits.into_iter().rev() {
        if seen.insert((edit.0, edit.1, edit.2)) {
            canonical.push(edit);
        }
    }
    canonical.reverse();
    canonical
}

fn canonicalize_position_raw_edits(
    edits: Vec<(SheetId, u32, u32, CellValue, Option<String>)>,
) -> Vec<(SheetId, u32, u32, CellValue, Option<String>)> {
    let mut seen = HashSet::new();
    let mut canonical = Vec::with_capacity(edits.len());
    for edit in edits.into_iter().rev() {
        if seen.insert((edit.0, edit.1, edit.2)) {
            canonical.push(edit);
        }
    }
    canonical.reverse();
    canonical
}

fn max_position_by_sheet<I>(positions: I) -> HashMap<SheetId, (u32, u32)>
where
    I: IntoIterator<Item = (SheetId, u32, u32)>,
{
    let mut max_by_sheet: HashMap<SheetId, (u32, u32)> = HashMap::new();
    for (sheet_id, row, col) in positions {
        max_by_sheet
            .entry(sheet_id)
            .and_modify(|(max_row, max_col)| {
                *max_row = (*max_row).max(row);
                *max_col = (*max_col).max(col);
            })
            .or_insert((row, col));
    }
    max_by_sheet
}

fn sheet_has_compact_axes(txn: &yrs::TransactionMut<'_>, sheet_map: &yrs::MapRef) -> bool {
    use compute_document::schema::{KEY_GRID_COL_AXIS, KEY_GRID_INDEX, KEY_GRID_ROW_AXIS};
    match sheet_map.get(txn, KEY_GRID_INDEX) {
        Some(Out::YMap(grid_index)) => {
            grid_index.get(txn, KEY_GRID_ROW_AXIS).is_some()
                || grid_index.get(txn, KEY_GRID_COL_AXIS).is_some()
        }
        _ => false,
    }
}

fn ensure_batch_dimensions(
    storage: &YrsStorage,
    grid_indexes: &mut FxHashMap<SheetId, GridIndex>,
    sheets_map: &yrs::MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    max_by_sheet: HashMap<SheetId, (u32, u32)>,
) -> Result<(), ComputeError> {
    for (sheet_id, (max_row, max_col)) in max_by_sheet {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let compact_axes = match sheets_map.get(&*txn, &sheet_hex) {
            Some(Out::YMap(sheet_map)) => sheet_has_compact_axes(txn, &sheet_map),
            _ => {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                });
            }
        };
        let grid = grid_indexes
            .get_mut(&sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
        let mut dims = crate::storage::sheet_dimensions::SheetDimensionsMut::from_grid_index(
            storage.doc(),
            sheets_map,
            grid,
        );
        dims.ensure_capacity(txn, sheet_id, max_row, max_col)?;
        if compact_axes {
            dims.materialize_dense_axes_and_remove_compact_keys(txn, sheet_id)?;
        }
    }
    Ok(())
}

fn write_prepared_cell_inputs_to_yrs(
    stores: &mut EngineStores,
    edits: &[(SheetId, CellId, u32, u32, CellInput)],
    prepared_values: &[(CellValue, Option<String>)],
) -> Result<(), ComputeError> {
    let EngineStores {
        storage,
        grid_indexes,
        ..
    } = stores;
    let sheets_map = storage.doc().get_or_insert_map("sheets");
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    ensure_batch_dimensions(
        storage,
        grid_indexes,
        &sheets_map,
        &mut txn,
        max_position_by_sheet(
            edits
                .iter()
                .map(|(sheet_id, _, row, col, _)| (*sheet_id, *row, *col)),
        ),
    )?;

    for ((sheet_id, cell_id, row, col, _), (value, formula)) in
        edits.iter().zip(prepared_values.iter())
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let grid = grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
        grid.register_cell(*cell_id, *row, *col);
        let row_hex = grid
            .row_id_hex(*row)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing row identity after dimension growth for row {}",
                    row
                ),
            })?;
        let col_hex = grid
            .col_id_hex(*col)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing column identity after dimension growth for col {}",
                    col
                ),
            })?;
        super::super::cell_editing::write_cell_to_yrs_in_txn(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            *cell_id,
            row_hex.as_str(),
            col_hex.as_str(),
            value,
            formula.as_deref(),
        );
    }

    Ok(())
}

fn write_raw_cell_edits_to_yrs(
    stores: &mut EngineStores,
    edits: &[(SheetId, CellId, u32, u32, CellValue, Option<String>)],
) -> Result<(), ComputeError> {
    let EngineStores {
        storage,
        grid_indexes,
        ..
    } = stores;
    let sheets_map = storage.doc().get_or_insert_map("sheets");
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    ensure_batch_dimensions(
        storage,
        grid_indexes,
        &sheets_map,
        &mut txn,
        max_position_by_sheet(
            edits
                .iter()
                .map(|(sheet_id, _, row, col, _, _)| (*sheet_id, *row, *col)),
        ),
    )?;

    for (sheet_id, cell_id, row, col, value, formula) in edits {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let grid = grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
        grid.register_cell(*cell_id, *row, *col);
        let row_hex = grid
            .row_id_hex(*row)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing row identity after dimension growth for row {}",
                    row
                ),
            })?;
        let col_hex = grid
            .col_id_hex(*col)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!(
                    "Missing column identity after dimension growth for col {}",
                    col
                ),
            })?;
        let formula_body = formula.as_deref().map(|f| f.strip_prefix('=').unwrap_or(f));
        super::super::cell_editing::write_cell_to_yrs_in_txn(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            *cell_id,
            row_hex.as_str(),
            col_hex.as_str(),
            value,
            formula_body,
        );
    }

    Ok(())
}

/// Batch-set cells with full store synchronization, lossless typed input.
///
/// The value-typed counterpart to [`mutation_set_cells`]. Callers that already
/// own a typed `CellValue` + `Option<formula_body>` (fill, paste, move,
/// import, collaboration sync) route through here to avoid the render/reparse
/// round-trip that would strip errors, arrays, leading apostrophes, and text
/// that happens to parse as a number/bool.
pub(in crate::storage::engine) fn mutation_set_cells_raw(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    skip_cycle_check: bool,
) -> Result<RecalcResult, ComputeError> {
    let edits = canonicalize_resolved_raw_edits(edits)?;
    validate_edit_bounds(
        edits
            .iter()
            .map(|(sheet_id, _, row, col, _, _)| (*sheet_id, *row, *col)),
    )?;
    stores
        .compute
        .validate_raw_user_edit_region_writes(mirror, &edits)?;

    let _suppress = mutation.suppress_guard();

    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(edits.len());

    write_raw_cell_edits_to_yrs(stores, &edits)?;

    for (sheet_id, cell_id, row, col, value, formula) in &edits {
        // Snapshot old value from mirror BEFORE anything overwrites it.
        let old_val = mirror
            .get_cell_value(cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(*cell_id, old_val);

        // 4. Update mirror with the typed value — ONLY for plain-value edits.
        //    For formula edits, we must NOT pre-write the mirror here:
        //    `process_value_input` needs to see the prior cell value to
        //    detect "same formula re-entered" and preserve the converged
        //    iterative-calc seed. Pre-writing with the caller's `value`
        //    (typically `CellValue::Null` for formula edits) destroys the
        //    seed before the scheduler can rescue it.
        if formula.is_none() {
            mirror.apply_edit(
                sheet_id,
                *cell_id,
                SheetPos::new(*row, *col),
                value.clone(),
                None,
            );
        }
    }

    // 5. Delegate to ComputeCore for recalculation via lossless entry point.
    //    For formula edits, `process_value_input` owns the mirror update and
    //    will preserve the prior value as a seed when the formula matches.
    //
    //    Stream A′ trust marker: this is a user-driven path (fill, paste,
    //    move, import, collab sync). Partial writes into a CSE / Data Table
    //    region MUST reject; the unified region guard at
    //    `set_cells_raw_with_trust(WriteTrust::UserEdit)` enforces this.
    let mut result = stores.compute.set_cells_raw_with_trust(
        mirror,
        &edits,
        skip_cycle_check,
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

// ---------------------------------------------------------------------------
// mutation_set_cells_by_position
// ---------------------------------------------------------------------------

/// Batch-set cells by position with full store synchronization.
pub(in crate::storage::engine) fn mutation_set_cells_by_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    edits: Vec<(SheetId, u32, u32, CellInput)>,
    skip_cycle_check: bool,
) -> Result<RecalcResult, ComputeError> {
    let edits = canonicalize_position_cell_inputs(edits);
    validate_edit_bounds(
        edits
            .iter()
            .map(|(sheet_id, row, col, _)| (*sheet_id, *row, *col)),
    )?;
    let mut resolved: Vec<(SheetId, CellId, u32, u32, CellInput)> = Vec::with_capacity(edits.len());

    for (sheet_id, row, col, input) in edits {
        match &input {
            CellInput::Clear => {
                // Clear cell — only process if cell exists (no CellId allocation for no-ops).
                // Use mirror-aware lookup so Range-resident virtual CellIds are found.
                if let Some(cell_id) = super::super::cell_editing::find_cell_id_at_mirrored(
                    stores, mirror, &sheet_id, row, col,
                ) {
                    resolved.push((sheet_id, cell_id, row, col, input));
                }
            }
            CellInput::Literal { .. } | CellInput::Parse { .. } => {
                // Set cell value — allocate a CellId if needed.
                // Use mirror-aware lookup so Range-resident positions get
                // their deterministic virtual CellId instead of a random one.
                let cell_id = super::super::cell_editing::find_cell_id_at_mirrored(
                    stores, mirror, &sheet_id, row, col,
                )
                .unwrap_or_else(|| stores.grid_id_alloc.next_cell_id());
                resolved.push((sheet_id, cell_id, row, col, input));
            }
        }
    }

    if resolved.is_empty() {
        return Ok(RecalcResult::empty());
    }

    stores
        .compute
        .validate_region_partial_writes(mirror, &resolved)?;

    mutation_set_cells(stores, mirror, mutation, resolved, skip_cycle_check)
}

// ---------------------------------------------------------------------------
// mutation_set_cells_by_position_raw
// ---------------------------------------------------------------------------

/// Batch-set cells by position with lossless typed input.
///
/// Resolves (row, col) → CellId (existing or newly allocated), skipping
/// clear-on-absent-cell edits, then delegates to [`mutation_set_cells_raw`].
/// Use this instead of [`mutation_set_cells_by_position`] when the caller
/// already owns a typed `CellValue` + optional formula body — rendering to
/// a string and re-parsing is lossy for errors, arrays, and text that
/// coerces to numbers/booleans.
pub(in crate::storage::engine) fn mutation_set_cells_by_position_raw(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    edits: Vec<(SheetId, u32, u32, CellValue, Option<String>)>,
    skip_cycle_check: bool,
) -> Result<RecalcResult, ComputeError> {
    let edits = canonicalize_position_raw_edits(edits);
    validate_edit_bounds(
        edits
            .iter()
            .map(|(sheet_id, row, col, _, _)| (*sheet_id, *row, *col)),
    )?;
    let mut resolved: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> =
        Vec::with_capacity(edits.len());

    for (sheet_id, row, col, value, formula) in edits {
        // "Clear" semantics: value=Null + formula=None. Only process if the
        // cell already exists — skip clearing phantom cells.
        // Use mirror-aware lookup so Range-resident virtual CellIds are found.
        let is_clear = matches!(value, CellValue::Null) && formula.is_none();
        if is_clear {
            if let Some(cell_id) = super::super::cell_editing::find_cell_id_at_mirrored(
                stores, mirror, &sheet_id, row, col,
            ) {
                resolved.push((sheet_id, cell_id, row, col, value, formula));
            }
        } else {
            let cell_id = super::super::cell_editing::find_cell_id_at_mirrored(
                stores, mirror, &sheet_id, row, col,
            )
            .unwrap_or_else(|| stores.grid_id_alloc.next_cell_id());
            resolved.push((sheet_id, cell_id, row, col, value, formula));
        }
    }

    if resolved.is_empty() {
        return Ok(RecalcResult::empty());
    }

    mutation_set_cells_raw(stores, mirror, mutation, resolved, skip_cycle_check)
}

// ---------------------------------------------------------------------------
// mutation_clear_range_by_position
// ---------------------------------------------------------------------------

fn collect_materialized_cells_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<(u32, u32, CellId)> {
    stores
        .grid_indexes
        .get(sheet_id)
        .map(|grid| {
            grid.cells_in_range(start_row, start_col, end_row, end_col)
                .map(|(cell_id, row, col)| (row, col, cell_id))
                .collect()
        })
        .unwrap_or_default()
}

fn push_resolved_clear_target(
    mirror: &CellMirror,
    resolved: &mut Vec<(u32, u32, CellId)>,
    direct_edit_old_values: &mut HashMap<CellId, CellValue>,
    seen_cell_ids: &mut HashSet<CellId>,
    row: u32,
    col: u32,
    cell_id: CellId,
) {
    if seen_cell_ids.insert(cell_id) {
        let old_val = mirror
            .get_cell_value(&cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(cell_id, old_val);
        resolved.push((row, col, cell_id));
    }
}

fn projection_fully_covered_by_range(
    projection_origin_row: u32,
    projection_origin_col: u32,
    projection_rows: u32,
    projection_cols: u32,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> bool {
    let projection_end_row = projection_origin_row + projection_rows - 1;
    let projection_end_col = projection_origin_col + projection_cols - 1;
    start_row <= projection_origin_row
        && start_col <= projection_origin_col
        && end_row >= projection_end_row
        && end_col >= projection_end_col
}

fn cse_anchor_clear_targets_for_range(
    mirror: &CellMirror,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Vec<(u32, u32, CellId)>, ComputeError> {
    let mut anchors = Vec::new();
    let end_row_exclusive = end_row.saturating_add(1);
    let end_col_exclusive = end_col.saturating_add(1);

    for projection in mirror.projection_registry.projections_in_range(
        &sheet_id,
        start_row,
        start_col,
        end_row_exclusive,
        end_col_exclusive,
    ) {
        if !mirror.is_cse_anchor(&projection.source) {
            continue;
        }

        let Some(anchor_pos) = mirror.resolve_position(&projection.source) else {
            continue;
        };

        if !projection_fully_covered_by_range(
            projection.origin_row,
            projection.origin_col,
            projection.rows,
            projection.cols,
            start_row,
            start_col,
            end_row,
            end_col,
        ) {
            let row = start_row.max(projection.origin_row);
            let col = start_col.max(projection.origin_col);
            return Err(ComputeError::PartialArrayWrite {
                sheet_id: sheet_id.to_uuid_string(),
                row,
                col,
                anchor_row: anchor_pos.row(),
                anchor_col: anchor_pos.col(),
            });
        }

        anchors.push((anchor_pos.row(), anchor_pos.col(), projection.source));
    }

    Ok(anchors)
}

/// Clear cell **contents** in a range by position, preserving formatting.
///
/// Converts cells to marker cells (value → Null, CellId and grid-index
/// preserved, properties/formatting removed). This is the "clear all"
/// semantic — values, formulas, AND formatting are wiped.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_clear_range_by_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::infra::cell_iter;
    use compute_document::hex::id_to_hex;

    // 0. Resolve all (row, col, CellId) tuples via the authoritative
    //    sparse in-memory grid index. Empty positions have no CellId, so
    //    full-row/full-column/full-sheet clears are proportional to the
    //    number of materialized cells, not to the selected area.
    let mut resolved = cse_anchor_clear_targets_for_range(
        mirror, sheet_id, start_row, start_col, end_row, end_col,
    )?;
    let mut seen_cell_ids: HashSet<CellId> = resolved.iter().map(|(_, _, id)| *id).collect();
    for (row, col, cell_id) in collect_materialized_cells_in_range(
        stores, &sheet_id, start_row, start_col, end_row, end_col,
    ) {
        if seen_cell_ids.insert(cell_id) {
            resolved.push((row, col, cell_id));
        }
    }
    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(resolved.len());
    for (_, _, cell_id) in &resolved {
        let old_val = mirror
            .get_cell_value(cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(*cell_id, old_val);
    }

    // 1. Write marker cells to yrs Doc (clear value AND properties/formatting).
    //    Routed through clear_cells_by_hex so it iterates via `grid_indexes`
    //    (the authoritative identity store post-R51).
    let cell_hexes: Vec<String> = resolved
        .iter()
        .map(|(_, _, cid)| id_to_hex(cid.as_u128()).to_string())
        .collect();
    mutation.observer.set_suppressed(true);
    cell_iter::clear_cells_by_hex(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hexes,
        /* clear_properties = */ true,
    );
    mutation.observer.set_suppressed(false);

    // 2. Update mirror and build empty edits for compute recalc.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellInput)> = Vec::with_capacity(resolved.len());
    for (row, col, cell_id) in resolved {
        mirror.apply_edit(
            &sheet_id,
            cell_id,
            SheetPos::new(row, col),
            CellValue::Null,
            None,
        );
        edits.push((sheet_id, cell_id, row, col, CellInput::Clear));
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    let mut result = stores.compute.set_cells(mirror, &edits, true)?;

    // Patch old_value onto changed_cells that don't already have one.
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

// ---------------------------------------------------------------------------
// mutation_clear_cells
// ---------------------------------------------------------------------------

/// Clear cells with full store synchronization.
///
/// Order matters: `clear_cells` must run BEFORE `remove_cell_with_origin`
/// because `clear_cells` sets the mirror value to Null and then `recalc`
/// produces `changed_cells` by reading the cell from the mirror. If we
/// removed from the mirror first (via `remove_cell_with_origin`), recalc
/// would see no cell and generate no viewport patches.
pub(in crate::storage::engine) fn mutation_clear_cells(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    cell_ids: Vec<CellId>,
) -> Result<RecalcResult, ComputeError> {
    // Snapshot old values from mirror BEFORE clear_cells overwrites them.
    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(cell_ids.len());
    for &cell_id in &cell_ids {
        let old_val = mirror
            .get_cell_value(&cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(cell_id, old_val);
    }

    // 1. Clear in compute core: set values to Null, remove formulas, recalc.
    //    This produces the RecalcResult with changed_cells for viewport patching.
    let mut result = stores.compute.clear_cells(mirror, &cell_ids)?;

    // Patch old_value onto seed changes (cleared cells) that don't already have one.
    for change in &mut result.changed_cells {
        if change.old_value.is_none()
            && let Ok(cid) = CellId::from_uuid_str(&change.cell_id)
            && let Some(old) = direct_edit_old_values.remove(&cid)
        {
            change.old_value = Some(old);
        }
    }

    // 2. Remove from yrs storage and grid index (suppressed — no observer).
    mutation.observer.set_suppressed(true);

    for &cell_id in &cell_ids {
        let sheet_id = stores
            .grid_indexes
            .iter()
            .find_map(|(sid, grid)| grid.cell_position(&cell_id).map(|_| *sid));

        if let Some(sheet_id) = sheet_id {
            stores.storage.remove_cell_with_origin(
                mirror,
                &sheet_id,
                &cell_id,
                Some(ORIGIN_USER_EDIT),
            );

            if let Some(grid) = stores.grid_indexes.get_mut(&sheet_id) {
                grid.remove_cell(&cell_id);
            }
        }
    }

    mutation.observer.set_suppressed(false);

    Ok(result)
}

// ---------------------------------------------------------------------------
// mutation_clear_range
// ---------------------------------------------------------------------------

/// Clear cell values in a range while preserving formatting (value -> null,
/// CellId and properties preserved). This is the "clear contents" semantic —
/// bold, number-format, etc. survive.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_clear_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::infra::cell_iter;
    use compute_document::hex::id_to_hex;

    // 0. Resolve (row, col, CellId) tuples via the authoritative in-memory
    //    grid index. CSE arrays are atomic: a range clear may tear down the
    //    array only when the selected range fully covers the CSE rectangle.
    //    Partial overlap rejects before any Yrs or mirror mutation.
    let mut resolved: Vec<(u32, u32, CellId)> = Vec::new();
    let mut direct_edit_old_values: HashMap<CellId, CellValue> = HashMap::new();
    let mut seen_cell_ids: HashSet<CellId> = HashSet::new();

    for (row, col, cell_id) in cse_anchor_clear_targets_for_range(
        mirror, sheet_id, start_row, start_col, end_row, end_col,
    )? {
        push_resolved_clear_target(
            mirror,
            &mut resolved,
            &mut direct_edit_old_values,
            &mut seen_cell_ids,
            row,
            col,
            cell_id,
        );
    }

    for (row, col, cell_id) in collect_materialized_cells_in_range(
        stores, &sheet_id, start_row, start_col, end_row, end_col,
    ) {
        push_resolved_clear_target(
            mirror,
            &mut resolved,
            &mut direct_edit_old_values,
            &mut seen_cell_ids,
            row,
            col,
            cell_id,
        );
    }

    // 1. Write marker cells to yrs Doc (preserve CellId + properties, clear
    //    value only). Routed through clear_cells_by_hex so it works on
    //    XLSX-hydrated sheets.
    let cell_hexes: Vec<String> = resolved
        .iter()
        .map(|(_, _, cid)| id_to_hex(cid.as_u128()).to_string())
        .collect();
    mutation.observer.set_suppressed(true);
    cell_iter::clear_cells_by_hex(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hexes,
        /* clear_properties = */ false,
    );
    mutation.observer.set_suppressed(false);

    // 2. Update mirror and build empty edits for compute recalc.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellInput)> = Vec::with_capacity(resolved.len());
    for (row, col, cell_id) in resolved {
        mirror.apply_edit(
            &sheet_id,
            cell_id,
            SheetPos::new(row, col),
            CellValue::Null,
            None,
        );
        edits.push((sheet_id, cell_id, row, col, CellInput::Clear));
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    let mut result = stores.compute.set_cells(mirror, &edits, true)?;

    // Patch old_value onto seed changes that don't already have one.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::engine::YrsComputeEngine;
    use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};

    const SHEET_UUID: &str = "aa000000000000000000000000000001";
    const A1_UUID: &str = "aa000000000000000000000000000101";
    const J10_UUID: &str = "aa000000000000000000000000000102";
    const CSE_A1_UUID: &str = "aa000000000000000000000000000103";
    const FULL_SHEET_END_ROW: u32 = 1_048_575;
    const FULL_SHEET_END_COL: u32 = 16_383;

    fn snapshot_with_cells(cells: Vec<CellData>) -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells,
                ranges: vec![],
            }],
            ..Default::default()
        }
    }

    fn cell_change_at(
        changes: &[snapshot_types::CellChange],
        row: u32,
        col: u32,
    ) -> Option<&snapshot_types::CellChange> {
        changes.iter().find(|change| {
            change.position.as_ref().map(|pos| (pos.row, pos.col)) == Some((row, col))
        })
    }

    #[test]
    fn mutation_clear_range_whole_sheet_uses_sparse_grid_targets() {
        let snapshot = snapshot_with_cells(vec![
            CellData {
                cell_id: A1_UUID.to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(10.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
            CellData {
                cell_id: J10_UUID.to_string(),
                row: 9,
                col: 9,
                value: CellValue::number(20.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
        ]);
        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
        let a1_id = CellId::from_uuid_str(A1_UUID).expect("A1 uuid");
        let j10_id = CellId::from_uuid_str(J10_UUID).expect("J10 uuid");

        let started = std::time::Instant::now();
        let (_patches, result) = engine
            .clear_range(&sheet_id, 0, 0, FULL_SHEET_END_ROW, FULL_SHEET_END_COL)
            .expect("clear_range");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "whole-sheet clear must not scan the selected coordinate area; elapsed {:?}",
            started.elapsed(),
        );

        assert_eq!(
            engine.mirror().get_cell_value(&a1_id).cloned(),
            Some(CellValue::Null),
        );
        assert_eq!(
            engine.mirror().get_cell_value(&j10_id).cloned(),
            Some(CellValue::Null),
        );
        assert!(
            cell_change_at(&result.recalc.changed_cells, 0, 0).is_some(),
            "A1 should be reported as changed",
        );
        assert!(
            cell_change_at(&result.recalc.changed_cells, 9, 9).is_some(),
            "J10 should be reported as changed",
        );
    }

    #[test]
    fn mutation_clear_range_by_position_whole_sheet_uses_sparse_grid_targets() {
        let snapshot = snapshot_with_cells(vec![
            CellData {
                cell_id: A1_UUID.to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(10.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
            CellData {
                cell_id: J10_UUID.to_string(),
                row: 9,
                col: 9,
                value: CellValue::number(20.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            },
        ]);
        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
        let a1_id = CellId::from_uuid_str(A1_UUID).expect("A1 uuid");
        let j10_id = CellId::from_uuid_str(J10_UUID).expect("J10 uuid");

        let started = std::time::Instant::now();
        let (_patches, result) = engine
            .clear_range_by_position(sheet_id, 0, 0, FULL_SHEET_END_ROW, FULL_SHEET_END_COL)
            .expect("clear_range_by_position");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "whole-sheet clear-all must not scan the selected coordinate area; elapsed {:?}",
            started.elapsed(),
        );

        assert_eq!(
            engine.mirror().get_cell_value(&a1_id).cloned(),
            Some(CellValue::Null),
        );
        assert_eq!(
            engine.mirror().get_cell_value(&j10_id).cloned(),
            Some(CellValue::Null),
        );
        assert!(
            cell_change_at(&result.recalc.changed_cells, 0, 0).is_some(),
            "A1 should be reported as changed",
        );
        assert!(
            cell_change_at(&result.recalc.changed_cells, 9, 9).is_some(),
            "J10 should be reported as changed",
        );
    }

    #[test]
    fn mutation_clear_range_sparse_projection_overlap_rejects_partial_cse_clear() {
        let snapshot = snapshot_with_cells(vec![CellData {
            cell_id: CSE_A1_UUID.to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(1.0),
            formula: Some("SEQUENCE(2,3)".to_string()),
            identity_formula: None,
            array_ref: Some("A1:C2".to_string()),
        }]);
        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
        let anchor_id = CellId::from_uuid_str(CSE_A1_UUID).expect("CSE anchor uuid");

        assert!(
            engine.mirror().is_cse_anchor(&anchor_id),
            "precondition: snapshot array_ref should register a CSE anchor",
        );

        let err = engine
            .clear_range(&sheet_id, 1, 1, 1, 1)
            .expect_err("clear_range over projected member should reject");

        assert!(
            matches!(err, ComputeError::PartialArrayWrite { .. }),
            "expected PartialArrayWrite, got {err:?}",
        );
        assert!(
            engine.mirror().is_cse_anchor(&anchor_id),
            "partial CSE range clear must leave the anchor intact",
        );
        assert_eq!(
            engine.mirror().get_cell_value(&anchor_id).cloned(),
            Some(CellValue::number(1.0)),
        );
    }

    #[test]
    fn mutation_clear_range_full_cse_extent_clears_anchor() {
        let snapshot = snapshot_with_cells(vec![CellData {
            cell_id: CSE_A1_UUID.to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(1.0),
            formula: Some("SEQUENCE(2,3)".to_string()),
            identity_formula: None,
            array_ref: Some("A1:C2".to_string()),
        }]);
        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
        let anchor_id = CellId::from_uuid_str(CSE_A1_UUID).expect("CSE anchor uuid");

        let (_patches, result) = engine
            .clear_range(&sheet_id, 0, 0, 1, 2)
            .expect("clear_range over full CSE extent");

        assert!(
            !engine.mirror().is_cse_anchor(&anchor_id),
            "full CSE extent clear should tear down the anchor",
        );
        assert_eq!(
            engine.mirror().get_cell_value(&anchor_id).cloned(),
            Some(CellValue::Null),
        );
        assert!(
            cell_change_at(&result.recalc.changed_cells, 0, 0).is_some(),
            "CSE anchor should be reported as changed",
        );
    }

    #[test]
    fn mutation_clear_range_by_position_rejects_partial_cse_clear() {
        let snapshot = snapshot_with_cells(vec![CellData {
            cell_id: CSE_A1_UUID.to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(1.0),
            formula: Some("SEQUENCE(2,3)".to_string()),
            identity_formula: None,
            array_ref: Some("A1:C2".to_string()),
        }]);
        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
        let anchor_id = CellId::from_uuid_str(CSE_A1_UUID).expect("CSE anchor uuid");

        let err = engine
            .clear_range_by_position(sheet_id, 1, 1, 1, 1)
            .expect_err("clear all over projected member should reject");

        assert!(
            matches!(err, ComputeError::PartialArrayWrite { .. }),
            "expected PartialArrayWrite, got {err:?}",
        );
        assert!(
            engine.mirror().is_cse_anchor(&anchor_id),
            "partial clear-all must leave the CSE anchor intact",
        );
    }

    /// Bug regression: `mutation_set_cells_raw` must not destroy the
    /// iterative-calc convergence seed when re-entering the same formula.
    ///
    /// Before the fix, step 4 of `mutation_set_cells_raw` unconditionally
    /// overwrote the mirror with the caller-supplied `value` (which, for a
    /// formula edit, is typically `CellValue::Null`). By the time step 5
    /// dispatched to `set_cells_raw` → `process_value_input`, the mirror had
    /// already been nulled, defeating the same-formula seed detection.
    ///
    /// We pre-converge A1 at 10.0 using a formula whose fixed point depends
    /// on the seed (`IF(A1>=5, A1, A1+1)` — stable above 5, climbs from 0
    /// to 5 otherwise). Re-entering the same formula must leave A1 at 10.0.
    /// With the bug, iterative calc would restart from 0 and converge to 5.0.
    #[test]
    fn mutation_set_cells_raw_preserves_iterative_seed_on_same_formula_reentry() {
        let snapshot = WorkbookSnapshot {
            iterative_calc: true,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            sheets: vec![SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![CellData {
                    cell_id: A1_UUID.to_string(),
                    row: 0,
                    col: 0,
                    value: value_types::CellValue::number(10.0),
                    formula: Some("IF(A1>=5, A1, A1+1)".to_string()),
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            }],
            ..Default::default()
        };
        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
        let a1_id = CellId::from_uuid_str(A1_UUID).expect("cell uuid");

        // Precondition: A1 converged at ~10.0 (seeded at 10; formula holds).
        let before = engine.mirror().get_cell_value(&a1_id).cloned();
        let before_n = match before {
            Some(value_types::CellValue::Number(n)) => n.get(),
            _ => panic!("pre-check: A1 must be Number, got {:?}", before),
        };
        assert!(
            (before_n - 10.0).abs() < 0.01,
            "pre-check: A1 must converge at ~10.0; got {}",
            before_n,
        );

        // Re-enter the SAME formula via mutation_set_cells_raw.
        engine.with_internals_for_test(|stores, mirror, mutation| {
            let edits = vec![(
                sheet_id,
                a1_id,
                0u32,
                0u32,
                value_types::CellValue::Null,
                Some("IF(A1>=5, A1, A1+1)".to_string()),
            )];
            // skip_cycle_check=true: iterative-calc intentionally allows
            // self-cycles. Matches how init_from_snapshot (via
            // `bulk_parse_and_register` + `set_precedents_fresh`) avoids
            // per-edge cycle detection.
            mutation_set_cells_raw(stores, mirror, mutation, edits, true)
                .expect("mutation_set_cells_raw");
        });

        // Post-check: A1 must still hold ~10.0. If the pre-write destroyed
        // the seed, iterative calc would restart from 0 → converge to 5.0.
        let after = engine.mirror().get_cell_value(&a1_id).cloned();
        let after_n = match after {
            Some(value_types::CellValue::Number(n)) => n.get(),
            _ => panic!("post-check: A1 must be Number, got {:?}", after),
        };
        assert!(
            (after_n - 10.0).abs() < 0.01,
            "mutation_set_cells_raw must preserve the iterative-calc seed \
             when re-entering the same formula; expected ~10.0, got {}",
            after_n,
        );
    }
}

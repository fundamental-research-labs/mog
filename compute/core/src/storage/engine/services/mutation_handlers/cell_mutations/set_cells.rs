use std::collections::HashMap;

use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::{PolicyPreservedParseOutcome, RecalcResult};
use crate::storage::cells::values::InputParseContext;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::edits::{canonicalize_resolved_cell_inputs, validate_edit_bounds};
use super::outcomes::{attach_policy_preserved_outcomes, truncate_submitted_text};
use super::yrs_writes::write_prepared_cell_inputs_to_yrs;

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
            CellInput::Value { value } => (value.clone(), None),
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
                        super::super::super::parse_rich_value_with_context(text, context);
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
    let mut cache_metadata_cells: HashMap<SheetId, Vec<CellId>> = HashMap::new();
    for (sheet_id, cell_id, _, _, _) in &edits {
        cache_metadata_cells
            .entry(*sheet_id)
            .or_default()
            .push(*cell_id);
    }
    for (sheet_id, cell_ids) in cache_metadata_cells {
        crate::storage::properties::clear_formula_cache_metadata_for_cell_ids(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            &sheet_id,
            &cell_ids,
        );
    }

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

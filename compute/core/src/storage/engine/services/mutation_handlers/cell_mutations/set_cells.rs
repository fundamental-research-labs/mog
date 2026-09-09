use std::collections::HashMap;

use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::{CellChange, CellPosition, PolicyPreservedParseOutcome, RecalcResult};
use crate::storage::cells::values::InputParseContext;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::services::cell_editing::{
    NO_OLD_FORMULA_SENTINEL, register_formula_cell_identities,
};
use crate::storage::engine::stores::EngineStores;

use super::edits::{canonicalize_resolved_cell_inputs, validate_edit_bounds};
use super::identity_registration::register_cell_positions;
use super::outcomes::{attach_policy_preserved_outcomes, truncate_submitted_text};

#[derive(Debug, Clone)]
struct DirectEditRecord {
    sheet_id: SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    prepared_value: CellValue,
    prepared_formula: Option<String>,
    old_value: CellValue,
    old_formula: Option<String>,
}

impl DirectEditRecord {
    fn new_formula(&self) -> Option<String> {
        self.prepared_formula.clone()
    }
}

fn resolved_post_edit_value(mirror: &CellMirror, record: &DirectEditRecord) -> CellValue {
    if record.prepared_formula.is_some() {
        mirror
            .get_cell_value(&record.cell_id)
            .cloned()
            .unwrap_or(CellValue::Null)
    } else {
        record.prepared_value.clone()
    }
}

fn append_missing_direct_edit_changes(
    result: &mut RecalcResult,
    mirror: &CellMirror,
    records: &[DirectEditRecord],
) {
    let mut changed_ids = rustc_hash::FxHashSet::default();
    let mut changed_positions = rustc_hash::FxHashSet::default();
    for change in &result.changed_cells {
        if let Ok(id) = CellId::from_uuid_str(&change.cell_id) {
            changed_ids.insert(id);
        }
        if let (Ok(sheet_id), Some(position)) = (
            SheetId::from_uuid_str(&change.sheet_id),
            change.position.as_ref(),
        ) {
            changed_positions.insert((sheet_id, position.row, position.col));
        }
    }
    for record in records {
        let position = (record.sheet_id, record.row, record.col);
        if changed_ids.contains(&record.cell_id) || changed_positions.contains(&position) {
            continue;
        }

        let value = resolved_post_edit_value(mirror, record);
        let new_formula = record.new_formula();
        if record.old_value == value && record.old_formula == new_formula {
            continue;
        }

        changed_ids.insert(record.cell_id);
        changed_positions.insert(position);
        result.changed_cells.push(CellChange {
            cell_id: record.cell_id.to_uuid_string(),
            sheet_id: record.sheet_id.to_uuid_string(),
            position: Some(CellPosition {
                row: record.row,
                col: record.col,
            }),
            value,
            display_text: None,
            old_display_text: None,
            old_formula: Some(
                record
                    .old_formula
                    .clone()
                    .unwrap_or_else(|| NO_OLD_FORMULA_SENTINEL.to_string()),
            ),
            new_formula,
            number_format: None,
            format_idx: None,
            extra_flags: 0,
            old_value: Some(record.old_value.clone()),
        });
    }
}

fn patch_direct_edit_before_snapshots(
    result: &mut RecalcResult,
    records_by_cell: &HashMap<CellId, DirectEditRecord>,
) {
    for change in &mut result.changed_cells {
        if let Ok(cid) = CellId::from_uuid_str(&change.cell_id)
            && let Some(record) = records_by_cell.get(&cid)
        {
            change.old_value = Some(record.old_value.clone());
            if change.old_formula.is_none() {
                change.old_formula = Some(
                    record
                        .old_formula
                        .clone()
                        .unwrap_or_else(|| NO_OLD_FORMULA_SENTINEL.to_string()),
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// mutation_set_cells
// ---------------------------------------------------------------------------

/// Batch-set cells with full store synchronization.
pub(in crate::storage::engine) fn mutation_set_cells(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
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

    for (sheet, cell, row, col, _) in &edits {
        crate::storage::engine::history::cells::capture_cell(
            stores, mirror, *sheet, *cell, *row, *col,
        );
    }

    // Resolve format hints from the pre-edit state before parsing inputs.
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
    let workbook_settings =
        crate::storage::workbook::settings::get_settings(&stores.storage.metadata);
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

    let mut direct_edit_records = Vec::with_capacity(edits.len());
    let mut prepared_edits = Vec::with_capacity(edits.len());
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
                    // Preserve the complete submitted formula. Removing and
                    // restoring its prefix would turn invalid `==A1` into `=A1`.
                    (CellValue::Null, Some(trimmed.to_string()))
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
        let old_value = mirror
            .get_cell_value(&cell_id)
            .or_else(|| mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col)))
            .cloned()
            .unwrap_or(CellValue::Null);
        let old_formula = stores.compute.get_formula(&cell_id).map(str::to_owned);
        direct_edit_records.push(DirectEditRecord {
            sheet_id: *sheet_id,
            cell_id,
            row,
            col,
            prepared_value: value.clone(),
            prepared_formula: formula.clone(),
            old_value,
            old_formula,
        });
        let prepared_input = formula
            .as_deref()
            .map(CellInput::formula)
            .unwrap_or(CellInput::Value { value });
        prepared_edits.push((*sheet_id, cell_id, row, col, prepared_input));
    }
    let direct_edit_records_by_cell: HashMap<CellId, DirectEditRecord> = direct_edit_records
        .iter()
        .cloned()
        .map(|record| (record.cell_id, record))
        .collect();

    register_cell_positions(
        stores,
        mirror,
        edits
            .iter()
            .map(|(sheet_id, cell_id, row, col, _)| (*sheet_id, *cell_id, *row, *col)),
    )?;
    let mut cache_metadata_cells: HashMap<SheetId, Vec<CellId>> = HashMap::new();
    for (sheet_id, cell_id, _, _, _) in &edits {
        stores.storage.clear_cell_metadata(*cell_id);
        // A single-cell imported CSE marker is runtime declaration state too.
        // Ordinary authored replacement must not retain its scalar-only behavior.
        mirror.cse_single_cell.remove(cell_id);
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

    crate::storage::engine::cell_metadata::refresh(&stores.storage, mirror, stores.layout_metrics);

    // Classification ran once with workbook culture, conversion policy, and format.
    // The scheduler owns the sole cell write and preserves iterative formula seeds.
    let mut result = stores
        .compute
        .set_cells(mirror, &prepared_edits, skip_cycle_check)?;
    for (_, cell_id, _, _, _) in &edits {
        register_formula_cell_identities(stores, mirror, *cell_id);
    }

    patch_direct_edit_before_snapshots(&mut result, &direct_edit_records_by_cell);
    append_missing_direct_edit_changes(&mut result, mirror, &direct_edit_records);

    attach_policy_preserved_outcomes(&mut result, preserved_outcomes);
    Ok(result)
}

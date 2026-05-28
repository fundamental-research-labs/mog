use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::cells::values as cell_values;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;

use super::{find_cell_id_at, write_cell_to_yrs};

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
                let mut new_grid = super::super::super::build_grid_from_yrs_for_sheet(
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
                (super::super::parse_rich_value(trimmed), None)
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
    crate::storage::properties::clear_formula_cache_metadata(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
        &id_to_hex(cell_id.as_u128()),
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

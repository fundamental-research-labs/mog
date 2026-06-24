use cell_types::SheetId;
use value_types::ComputeError;

use crate::engine_types::queries::FindInRangeOptions;
use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use crate::storage::infra::cell_iter;

use super::cell_mutations::mutation_set_cells_by_position;

// ---------------------------------------------------------------------------
// replace_all_in_range
// ---------------------------------------------------------------------------

/// Find matching cells and replace text, writing changes through
/// `mutation_set_cells_by_position` for proper undo/redo support.
///
/// Skips formula cells (only replaces literal values).
/// Returns the number of cells that were modified plus the resulting recalc evidence.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn replace_all_in_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    text: &str,
    replacement: &str,
    options: &FindInRangeOptions,
) -> Result<(u32, RecalcResult), ComputeError> {
    if text.is_empty() {
        return Ok((0, RecalcResult::empty()));
    }

    // replaceAll intentionally performs literal replacement for the public text
    // replacement API. Regex search syntax is only part of the read-side find API.
    let escaped = regex::escape(text);
    let pattern = if options.whole_cell.unwrap_or(false) {
        format!("^(?:{escaped})$")
    } else {
        escaped
    };
    let case_insensitive = !options.case_sensitive.unwrap_or(false);
    let re = match regex::RegexBuilder::new(&pattern)
        .case_insensitive(case_insensitive)
        .build()
    {
        Ok(r) => r,
        Err(_) => return Ok((0, RecalcResult::empty())),
    };

    // Collect matching non-formula cells
    let range = cell_types::RangePos::new(*sheet_id, start_row, start_col, end_row, end_col);
    let mut edits: Vec<(SheetId, u32, u32, CellInput)> = Vec::new();
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return Ok((0, RecalcResult::empty()));
    };

    cell_iter::for_each_cell_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        &range,
        |row, col, data| {
            if let Some(data) = data {
                // Skip formula cells
                if data.formula.is_some() {
                    return;
                }
                let display = match &data.value {
                    Some(v) if !matches!(v, value_types::CellValue::Null) => v.to_string(),
                    _ => return,
                };
                if display.is_empty() {
                    return;
                }
                if re.is_match(&display) {
                    let new_value = re.replace_all(&display, replacement).into_owned();
                    if new_value != display {
                        edits.push((*sheet_id, row, col, CellInput::Parse { text: new_value }));
                    }
                }
            }
        },
    );

    let count = edits.len() as u32;

    let recalc = if edits.is_empty() {
        RecalcResult::empty()
    } else {
        mutation_set_cells_by_position(stores, mirror, mutation, edits, false)?
    };

    Ok((count, recalc))
}

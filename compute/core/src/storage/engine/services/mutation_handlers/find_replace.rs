use cell_types::SheetId;
use value_types::ComputeError;

use crate::engine_types::queries::FindInRangeOptions;
use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

use super::cell_mutations::mutation_set_cells_by_position;

// ---------------------------------------------------------------------------
// replace_all_in_range
// ---------------------------------------------------------------------------

/// Find matching cells and replace text, writing changes through
/// `mutation_set_cells_by_position` to recalculate dependents and emit changes.
///
/// Skips formula cells (only replaces literal values).
/// Returns the number of cells that were modified plus the resulting recalc evidence.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn replace_all_in_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
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

    let mut edits: Vec<(SheetId, u32, u32, CellInput)> = Vec::new();
    if mirror.get_sheet(sheet_id).is_none() {
        return Ok((0, RecalcResult::empty()));
    }
    for row in start_row..=end_row {
        for col in start_col..=end_col {
            let pos = cell_types::SheetPos::new(row, col);
            let cell_id = mirror.resolve_cell_id(sheet_id, pos);
            if crate::storage::engine::formula_read::formula_text_at(
                stores,
                mirror,
                sheet_id,
                row,
                col,
                cell_id.as_ref(),
            )
            .is_some()
            {
                continue;
            }
            let Some(value) = mirror
                .get_cell_value_at(sheet_id, pos)
                .filter(|v| !v.is_null())
            else {
                continue;
            };
            let display = value.to_string();
            if !display.is_empty() && re.is_match(&display) {
                let new_value = re.replace_all(&display, replacement).into_owned();
                if new_value != display {
                    edits.push((*sheet_id, row, col, CellInput::Parse { text: new_value }));
                }
            }
        }
    }

    let count = edits.len() as u32;

    let recalc = if edits.is_empty() {
        RecalcResult::empty()
    } else {
        mutation_set_cells_by_position(stores, mirror, edits, false)?
    };

    Ok((count, recalc))
}

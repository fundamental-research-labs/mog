use cell_types::{SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::cells::data_ops::{RemoveDuplicatesOptions, unique_rows};
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

/// Compact unique rows through the normal cell mutation path.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_remove_duplicates(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: &[u32],
    has_headers: bool,
) -> Result<(RecalcResult, serde_json::Value), ComputeError> {
    let sheet = mirror
        .get_sheet(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    if !sheet.range_views_is_empty() {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: sheet_id.to_uuid_string(),
            operation: "remove_duplicates".into(),
        });
    }
    let first_row = u64::from(start_row) + u64::from(has_headers);
    let kept = unique_rows(
        mirror,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        &RemoveDuplicatesOptions {
            has_headers,
            columns_to_compare: columns.to_vec(),
            case_sensitive: false,
        },
    );
    let total = (u64::from(end_row) + 1).saturating_sub(first_row);
    let removed = total.saturating_sub(kept.len() as u64);
    let data = serde_json::json!({
        "duplicatesFound": removed,
        "duplicatesRemoved": removed,
        "uniqueValuesRemaining": kept.len(),
    });
    if removed == 0 {
        return Ok((RecalcResult::empty(), data));
    }

    // Capture all source inputs before applying any overlapping destination writes.
    let mut edits = Vec::new();
    for (offset, &source_row) in kept.iter().enumerate() {
        let destination_row = (first_row + offset as u64) as u32;
        if source_row == destination_row {
            continue;
        }
        for col in start_col..=end_col {
            let source_pos = SheetPos::new(source_row, col);
            let source_id = mirror.resolve_cell_id(sheet_id, source_pos);
            let formula = source_id.as_ref().and_then(|cell_id| {
                crate::storage::engine::formula_read::formula_text_for_cell_id(
                    stores, mirror, sheet_id, cell_id,
                )
            });
            let input = if let Some(formula) = formula {
                CellInput::Parse {
                    text: if formula.starts_with('=') {
                        formula
                    } else {
                        format!("={formula}")
                    },
                }
            } else {
                match mirror.get_cell_value_at(sheet_id, source_pos) {
                    None | Some(CellValue::Null) => CellInput::Clear,
                    Some(value) => CellInput::Value {
                        value: value.clone(),
                    },
                }
            };
            edits.push((*sheet_id, destination_row, col, input));
        }
    }
    for row in (first_row + kept.len() as u64)..=u64::from(end_row) {
        for col in start_col..=end_col {
            edits.push((*sheet_id, row as u32, col, CellInput::Clear));
        }
    }
    let recalc =
        super::super::cell_mutations::mutation_set_cells_by_position(stores, mirror, edits, false)?;
    Ok((recalc, data))
}

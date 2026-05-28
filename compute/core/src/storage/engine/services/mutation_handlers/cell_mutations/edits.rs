use std::collections::{HashMap, HashSet};

use cell_types::{CellId, MAX_COLS, MAX_ROWS, SheetId};
use value_types::{CellValue, ComputeError};

use crate::storage::engine::mutation::CellInput;

pub(super) fn validate_edit_bounds<I>(positions: I) -> Result<(), ComputeError>
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

pub(super) fn canonicalize_resolved_cell_inputs(
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

pub(super) fn canonicalize_resolved_raw_edits(
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

pub(super) fn canonicalize_position_cell_inputs(
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

pub(super) fn canonicalize_position_raw_edits(
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

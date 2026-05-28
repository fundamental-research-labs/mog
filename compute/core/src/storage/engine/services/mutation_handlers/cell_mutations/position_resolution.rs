use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::edits::{
    canonicalize_position_cell_inputs, canonicalize_position_raw_edits, validate_edit_bounds,
};
use super::raw_edits::mutation_set_cells_raw;
use super::set_cells::mutation_set_cells;

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
                if let Some(cell_id) = super::super::super::cell_editing::find_cell_id_at_mirrored(
                    stores, mirror, &sheet_id, row, col,
                ) {
                    resolved.push((sheet_id, cell_id, row, col, input));
                }
            }
            CellInput::Literal { .. } | CellInput::Parse { .. } => {
                // Set cell value — allocate a CellId if needed.
                // Use mirror-aware lookup so Range-resident positions get
                // their deterministic virtual CellId instead of a random one.
                let cell_id = super::super::super::cell_editing::find_cell_id_at_mirrored(
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
            if let Some(cell_id) = super::super::super::cell_editing::find_cell_id_at_mirrored(
                stores, mirror, &sheet_id, row, col,
            ) {
                resolved.push((sheet_id, cell_id, row, col, value, formula));
            }
        } else {
            let cell_id = super::super::super::cell_editing::find_cell_id_at_mirrored(
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

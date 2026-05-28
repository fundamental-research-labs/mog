use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::cse_clear::{
    collect_materialized_cells_in_range, cse_anchor_clear_targets_for_range,
    push_resolved_clear_target,
};

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

use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

use super::cse_clear::{
    collect_authored_cells_in_range, projection_anchor_clear_targets_for_range,
    push_resolved_clear_target,
};

pub(in crate::storage::engine) fn mutation_clear_range_by_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
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
    let mut resolved = projection_anchor_clear_targets_for_range(
        mirror, sheet_id, start_row, start_col, end_row, end_col,
    )?;
    let mut seen_cell_ids: HashSet<CellId> = resolved.iter().map(|(_, _, id)| *id).collect();
    for (row, col, cell_id) in collect_authored_cells_in_range(
        stores, mirror, &sheet_id, start_row, start_col, end_row, end_col,
    ) {
        if let Some((anchor_id, _)) = mirror.dynamic_spill_member_covering(&sheet_id, row, col)
            && seen_cell_ids.contains(&anchor_id)
        {
            continue;
        }
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

    // Clear cell properties for the resolved identities.
    let cell_hexes: Vec<String> = resolved
        .iter()
        .map(|(_, _, cid)| id_to_hex(cid.as_u128()).to_string())
        .collect();
    cell_iter::clear_cells_by_hex(
        &mut stores.storage,
        sheet_id,
        &cell_hexes,
        /* clear_properties = */ true,
    );

    // 2. Update mirror and build empty edits for compute recalc.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellInput)> = Vec::with_capacity(resolved.len());
    for (row, col, cell_id) in resolved {
        edits.push((sheet_id, cell_id, row, col, CellInput::Clear));
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    let mut result = super::set_cells::mutation_set_cells(stores, mirror, edits, true)?;

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

/// Clear native contents while retaining identities used by formulas and metadata.
pub(in crate::storage::engine) fn mutation_clear_cells(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    cell_ids: Vec<CellId>,
) -> Result<RecalcResult, ComputeError> {
    for cell in &cell_ids {
        if let Some(sheet) = mirror.sheet_for_cell(cell) && let Some(pos) = mirror.resolve_position(cell) {
            crate::storage::engine::history::cells::capture_cell(stores,mirror,sheet,*cell,pos.row(),pos.col());
        }
    }
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
    crate::storage::engine::cell_metadata::refresh(&stores.storage, mirror, stores.layout_metrics);
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

    for cell_id in cell_ids {
        stores.storage.clear_cell_metadata(cell_id);
        if let Some(sheet_id) = mirror.sheet_for_cell(&cell_id) {
            crate::storage::properties::clear_formula_cache_metadata_for_cell_ids(
                &mut stores.storage,
                &sheet_id,
                &[cell_id],
            );
        }
    }
    crate::storage::engine::cell_metadata::refresh(&stores.storage, mirror, stores.layout_metrics);

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
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<RecalcResult, ComputeError> {
    // 0. Resolve (row, col, CellId) tuples via the authoritative in-memory
    //    grid index. CSE arrays are atomic: a range clear may tear down the
    //    array only when the selected range fully covers the CSE rectangle.
    //    Partial overlap rejects before any mutation.
    let mut resolved: Vec<(u32, u32, CellId)> = Vec::new();
    let mut direct_edit_old_values: HashMap<CellId, CellValue> = HashMap::new();
    let mut seen_cell_ids: HashSet<CellId> = HashSet::new();

    for (row, col, cell_id) in projection_anchor_clear_targets_for_range(
        mirror, sheet_id, start_row, start_col, end_row, end_col,
    )? {
        push_resolved_clear_target(
            mirror,
            &mut resolved,
            &mut direct_edit_old_values,
            &mut seen_cell_ids,
            &sheet_id,
            row,
            col,
            cell_id,
        );
    }

    for (row, col, cell_id) in collect_authored_cells_in_range(
        stores, mirror, &sheet_id, start_row, start_col, end_row, end_col,
    ) {
        push_resolved_clear_target(
            mirror,
            &mut resolved,
            &mut direct_edit_old_values,
            &mut seen_cell_ids,
            &sheet_id,
            row,
            col,
            cell_id,
        );
    }

    // 2. Update mirror and build empty edits for compute recalc.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellInput)> = Vec::with_capacity(resolved.len());
    for (row, col, cell_id) in resolved {
        edits.push((sheet_id, cell_id, row, col, CellInput::Clear));
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    let mut result = super::set_cells::mutation_set_cells(stores, mirror, edits, true)?;

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

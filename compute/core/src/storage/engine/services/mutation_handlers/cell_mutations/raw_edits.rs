use std::collections::HashMap;

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::edits::{canonicalize_resolved_raw_edits, validate_edit_bounds};
use super::yrs_writes::write_raw_cell_edits_to_yrs;

pub(in crate::storage::engine) fn mutation_set_cells_raw(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    skip_cycle_check: bool,
) -> Result<RecalcResult, ComputeError> {
    let edits = canonicalize_resolved_raw_edits(edits)?;
    validate_edit_bounds(
        edits
            .iter()
            .map(|(sheet_id, _, row, col, _, _)| (*sheet_id, *row, *col)),
    )?;
    stores
        .compute
        .validate_raw_user_edit_region_writes(mirror, &edits)?;

    let _suppress = mutation.suppress_guard();

    let mut direct_edit_old_values: HashMap<CellId, CellValue> =
        HashMap::with_capacity(edits.len());

    write_raw_cell_edits_to_yrs(stores, &edits)?;
    for (sheet_id, cell_id, _, _, _, _) in &edits {
        crate::storage::properties::clear_formula_cache_metadata(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            sheet_id,
            &id_to_hex(cell_id.as_u128()),
        );
    }

    for (sheet_id, cell_id, row, col, value, formula) in &edits {
        // Snapshot old value from mirror BEFORE anything overwrites it.
        let old_val = mirror
            .get_cell_value(cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(*cell_id, old_val);

        // 4. Update mirror with the typed value — ONLY for plain-value edits.
        //    For formula edits, we must NOT pre-write the mirror here:
        //    `process_value_input` needs to see the prior cell value to
        //    detect "same formula re-entered" and preserve the converged
        //    iterative-calc seed. Pre-writing with the caller's `value`
        //    (typically `CellValue::Null` for formula edits) destroys the
        //    seed before the scheduler can rescue it.
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

    // 5. Delegate to ComputeCore for recalculation via lossless entry point.
    //    For formula edits, `process_value_input` owns the mirror update and
    //    will preserve the prior value as a seed when the formula matches.
    //
    //    Stream A′ trust marker: this is a user-driven path (fill, paste,
    //    move, import, collab sync). Partial writes into a CSE / Data Table
    //    region MUST reject; the unified region guard at
    //    `set_cells_raw_with_trust(WriteTrust::UserEdit)` enforces this.
    let mut result = stores.compute.set_cells_raw_with_trust(
        mirror,
        &edits,
        skip_cycle_check,
        crate::scheduler::WriteTrust::UserEdit,
    )?;

    // Patch old_value onto seed changes (direct edits) that don't already have one.
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

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::patches::merge_recalc_results;

// ---------------------------------------------------------------------------
// mutation_remove_duplicates
// ---------------------------------------------------------------------------

/// Remove duplicate rows from a range with full 5-store sync.
///
/// 1. Collect old CellIds from GridIndex for the affected range.
/// 2. Suppress observer and call cell_ops::remove_duplicates on Yrs Doc.
/// 3. Rebuild GridIndex for the affected range from Yrs state.
/// 4. Clear stale cells from mirror/compute, sync remaining cells.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_remove_duplicates(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: &[u32],
    has_headers: bool,
) -> Result<(RecalcResult, serde_json::Value), ComputeError> {
    use crate::storage::cells::data_ops as cell_ops;
    use std::collections::HashSet;

    // Range guard: reject if the target sheet is Range-backed.
    if mirror
        .get_sheet(sheet_id)
        .is_some_and(|s| !s.range_views_is_empty())
    {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: sheet_id.to_uuid_string(),
            operation: "remove_duplicates".to_string(),
        });
    }

    let options = cell_ops::RemoveDuplicatesOptions {
        has_headers,
        columns_to_compare: columns.to_vec(),
        case_sensitive: false,
    };

    let first_data_row = if has_headers {
        start_row + 1
    } else {
        start_row
    };

    // 1. Collect all pre-existing CellIds in the affected range from the
    //    GridIndex so we can diff against the post-compaction state to know
    //    which CellIds were removed and must be cleared from compute.
    let mut old_cell_ids: HashSet<CellId> = HashSet::new();
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for row in first_data_row..=end_row {
            for col in start_col..=end_col {
                if let Some(cell_id) = grid.cell_id_at(row, col) {
                    old_cell_ids.insert(cell_id);
                }
            }
        }
    }

    // 2. Suppress observer — we'll manually sync stores below.
    //    `remove_duplicates` manages cell identities through the GridIndex
    //    directly, so the GridIndex is in its final authoritative state
    //    after this call returns.
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
            })?;
    mutation.observer.set_suppressed(true);
    let result = cell_ops::remove_duplicates(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        start_row,
        start_col,
        end_row,
        end_col,
        &options,
    );
    mutation.observer.set_suppressed(false);

    let data = serde_json::json!({
        "duplicatesFound": result.duplicates_found,
        "duplicatesRemoved": result.duplicates_removed,
        "uniqueValuesRemaining": result.unique_values_remaining,
    });

    if result.duplicates_removed == 0 {
        return Ok((RecalcResult::empty(), data));
    }

    // 3. Collect the post-compaction CellIds from the GridIndex.
    let mut new_cell_ids: HashSet<CellId> = HashSet::new();
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for row in first_data_row..=end_row {
            for col in start_col..=end_col {
                if let Some(cell_id) = grid.cell_id_at(row, col) {
                    new_cell_ids.insert(cell_id);
                }
            }
        }
    }

    // 4. Clear cells that existed before but are now gone. filter viewport R5.3:
    //    capture the clear's recalc so its `Null` viewport patches reach the
    //    buffer; previously this was `let _ =` and the trailing rows kept
    //    their pre-compaction values until a viewport refresh.
    let removed_cell_ids: Vec<CellId> = old_cell_ids.difference(&new_cell_ids).copied().collect();
    let clear_recalc = if removed_cell_ids.is_empty() {
        RecalcResult::empty()
    } else {
        stores.compute.clear_cells(mirror, &removed_cell_ids)?
    };

    // 5. Sync mirror + compute for all cells still in the range.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();

    for row in first_data_row..=end_row {
        for col in start_col..=end_col {
            if let Some(grid) = stores.grid_indexes.get(sheet_id)
                && let Some(cell_id) = grid.cell_id_at(row, col)
                && let Some((value, formula, identity_formula)) =
                    stores.storage.read_cell_from_yrs(sheet_id, &cell_id)
            {
                mirror.apply_edit(
                    sheet_id,
                    cell_id,
                    SheetPos::new(row, col),
                    value.clone(),
                    identity_formula,
                );
                edits.push((*sheet_id, cell_id, row, col, value, formula));
            }
        }
    }

    let recalc = if edits.is_empty() {
        clear_recalc
    } else {
        let mut write_recalc = stores.compute.set_cells_raw_with_trust(
            mirror,
            &edits,
            true,
            crate::scheduler::WriteTrust::UserEdit,
        )?;
        merge_recalc_results(&mut write_recalc, clear_recalc);
        write_recalc
    };

    Ok((recalc, data))
}

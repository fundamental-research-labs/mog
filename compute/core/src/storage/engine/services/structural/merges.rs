use crate::mirror::CellMirror;
use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::ComputeError;

use crate::snapshot::{ChangeKind, MergeChange, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::merges;

use super::super::mutation::rebuild_merge_index;

// -------------------------------------------------------------------
// Merge Queries (read-only)
// -------------------------------------------------------------------

/// Check whether merging a range would cause data loss.
pub(in crate::storage::engine) fn check_merge_data_loss(
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> (bool, u32) {
    merges::check_merge_data_loss(mirror, *sheet_id, sr, sc, er, ec)
}

/// Check if the cell at (row, col) is the origin of a merge.
pub(in crate::storage::engine) fn is_merge_origin(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return false;
    };
    merges::is_merge_origin(&stores.storage, *sheet_id, grid, row, col)
}

// -------------------------------------------------------------------
// Merge Mutations (self-contained)
// -------------------------------------------------------------------

/// Clear all merged regions for a sheet.
pub(in crate::storage::engine) fn clear_all_merges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    merges::clear_all_merges(&mut stores.storage, *sheet_id);
    Ok(MutationResult::empty())
}

/// Validate merges and remove any whose CellIds can no longer be resolved.
/// Returns a `MutationResult` with the removed count in `data`.
pub(in crate::storage::engine) fn validate_and_clean_merges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let removed_count = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::validate_and_clean_merges(&mut stores.storage, *sheet_id, grid),
        None => 0,
    };
    Ok(MutationResult::empty().with_data(&removed_count)?)
}

/// Merge a range of cells.
pub(in crate::storage::engine) fn merge_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if start_row <= end_row && start_col <= end_col {
        register_merge_endpoints(
            stores,
            mirror,
            sheet_id,
            [(start_row, start_col), (end_row, end_col)],
        );
    }

    let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
        });
    };
    let region = merges::merge_range(
        &mut stores.storage,
        *sheet_id,
        grid,
        start_row,
        start_col,
        end_row,
        end_col,
    )?;
    rebuild_merge_index(stores, sheet_id);
    let mut result = MutationResult::empty();
    if region.is_some() {
        result.merge_changes.push(MergeChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            kind: ChangeKind::Set,
            start_row,
            start_col,
            end_row,
            end_col,
        });
    }
    Ok(result)
}

/// Unmerge a range.
pub(in crate::storage::engine) fn unmerge_range(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        merges::unmerge_range(
            &mut stores.storage,
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        );
    }
    rebuild_merge_index(stores, sheet_id);
    let mut result = MutationResult::empty();
    result.merge_changes.push(MergeChange {
        sheet_id: id_to_hex(sheet_id.as_u128()).into(),
        kind: ChangeKind::Removed,
        start_row,
        start_col,
        end_row,
        end_col,
    });
    Ok(result)
}

/// Merge across: creates one merge per row in the range.
pub(in crate::storage::engine) fn merge_across(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if start_row <= end_row && start_col <= end_col {
        register_merge_endpoints(
            stores,
            mirror,
            sheet_id,
            (start_row..=end_row).flat_map(|row| [(row, start_col), (row, end_col)]),
        );
    }

    let regions = match stores.grid_indexes.get_mut(sheet_id) {
        Some(grid) => merges::merge_across(
            &mut stores.storage,
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        ),
        None => Vec::new(),
    };
    rebuild_merge_index(stores, sheet_id);
    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let mut result = MutationResult::empty();
    for (i, _region) in regions.iter().enumerate() {
        let row = start_row + i as u32;
        result.merge_changes.push(MergeChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            start_row: row,
            start_col,
            end_row: row,
            end_col,
        });
    }
    Ok(result.with_data(&regions)?)
}

/// Merge and center: unmerge overlapping, then create a single merge.
pub(in crate::storage::engine) fn merge_and_center(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if start_row <= end_row && start_col <= end_col {
        register_merge_endpoints(
            stores,
            mirror,
            sheet_id,
            [(start_row, start_col), (end_row, end_col)],
        );
    }

    let region = match stores.grid_indexes.get_mut(sheet_id) {
        Some(grid) => merges::merge_and_center(
            &mut stores.storage,
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        )?,
        None => None,
    };
    rebuild_merge_index(stores, sheet_id);
    let mut result = MutationResult::empty();
    if region.is_some() {
        result.merge_changes.push(MergeChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            kind: ChangeKind::Set,
            start_row,
            start_col,
            end_row,
            end_col,
        });
    }
    Ok(result.with_data(&region)?)
}

fn register_merge_endpoints(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    positions: impl IntoIterator<Item = (u32, u32)>,
) {
    for (row, col) in positions {
        if let Some(id) =
            super::super::cell_editing::ensure_cell_id_mirrored(stores, mirror, sheet_id, row, col)
        {
            mirror.register_identity_position(*sheet_id, SheetPos::new(row, col), id);
        }
    }
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        mirror.install_sheet_axes(*sheet_id, grid.row_axis(), grid.col_axis());
    }
}

//! Shared merge-index updates for local mutations.

use cell_types::SheetId;

use crate::cells::CellStore;
use crate::range_manager::MergeList;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::merges;

use super::super::merge_index::{MergeRangeRef, MergeSpatialItem};

/// Rebuild the merge list for a sheet by reading all merges
/// from native metadata.
///
/// Called after merge/unmerge operations, structural changes (insert/delete
/// rows/cols), and sheet creation/copy to keep the index in sync.
pub(in crate::storage::engine) fn rebuild_merge_index(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
) {
    let resolved = match cell_store.get_sheet(sheet_id) {
        Some(grid) => merges::get_all_merges(&stores.storage, *sheet_id, grid),
        None => Vec::new(),
    };
    let items: Vec<MergeSpatialItem> = resolved
        .iter()
        .map(|m| MergeSpatialItem {
            id: m.merge.top_left_id.clone(),
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
            range_ref: MergeRangeRef {
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
            },
        })
        .collect();

    if let Some(index) = stores.merge_indexes.get_mut(sheet_id) {
        index.rebuild(items);
    } else {
        stores
            .merge_indexes
            .insert(*sheet_id, MergeList::with_items(items));
    }
}

/// Sync the CellStore's merge regions from native metadata for a sheet.
///
/// Must be called after any merge/unmerge operation so that
/// `ProjectionRegistry::check_conflict` can detect merged-cell spill blockers.
/// Without this, dynamic-array formulas (e.g. SEQUENCE) spill into merged
/// regions instead of yielding #SPILL! at the anchor.
///
/// This is separate from `rebuild_merge_index` because bridge write methods
/// have access to `CellStore` but the inner service functions do not — they
/// call `rebuild_merge_index` on the stores, then the bridge method calls this
/// helper with the cell store to complete the two-phase sync.
pub(in crate::storage::engine) fn sync_store_merge_regions(
    stores: &EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
) {
    let resolved = match cell_store.get_sheet(sheet_id) {
        Some(grid) => merges::get_all_merges(&stores.storage, *sheet_id, grid),
        None => Vec::new(),
    };
    let store_regions: Vec<crate::cells::MergeRegion> = resolved
        .iter()
        .map(|m| crate::cells::MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect();
    cell_store.set_merge_regions(sheet_id, store_regions);
}

//! Shared merge-index updates for local mutations.

use cell_types::{CellId, SheetId};

use crate::mirror::CellMirror;
use crate::range_manager::RangeSpatialIndex;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::merges;

use super::super::merge_index::{MergeRangeRef, MergeSpatialItem};

/// Parse an A1-style range string (e.g., `"A1:C5"`) into 0-based
/// `(start_row, start_col, end_row, end_col)`. Local helper for
/// reconciling the persisted CSE marker against the runtime mirror.
/// Returns `None` if the string can't be parsed as a positional range.
fn parse_a1_range_simple(s: &str) -> Option<(u32, u32, u32, u32)> {
    let range = compute_parser::parse_a1_range(s)?;
    let (sr, sc) = match range.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (er, ec) = match range.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some((sr, sc, er, ec))
}

/// Reconcile the runtime CSE state with a persisted array-formula range.
///
/// Structural range operations must call this helper after moving a cell.
/// Removing the old projection first is essential: a changed or cleared marker otherwise leaves partial-array-write
/// guards and spill reads pointing at the old sheet/position.
pub(in crate::storage::engine) fn reconcile_persisted_array_ref(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_id: &CellId,
    array_ref: Option<&str>,
) {
    mirror.projection_registry.remove(cell_id);
    mirror.unmark_cse_anchor(cell_id);
    mirror.cse_single_cell.remove(cell_id);

    let Some(array_ref) = array_ref else {
        return;
    };

    mirror.mark_cse_anchor(*cell_id);
    if let Some((sr, sc, er, ec)) = parse_a1_range_simple(array_ref) {
        let rows = er - sr + 1;
        let cols = ec - sc + 1;
        if rows == 1 && cols == 1 {
            mirror.cse_single_cell.insert(*cell_id);
        } else {
            mirror
                .projection_registry
                .register(*cell_id, *sheet_id, sr, sc, rows, cols);
        }
    }
}

/// Rebuild the merge spatial index for a sheet by reading all merges
/// from native metadata.
///
/// Called after merge/unmerge operations, structural changes (insert/delete
/// rows/cols), and sheet creation/copy to keep the index in sync.
pub(in crate::storage::engine) fn rebuild_merge_index(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) {
    let resolved = match stores.grid_indexes.get(sheet_id) {
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
            .insert(*sheet_id, RangeSpatialIndex::with_items(items));
    }
}

/// Sync the CellMirror's merge regions from native metadata for a sheet.
///
/// Must be called after any merge/unmerge operation so that
/// `ProjectionRegistry::check_conflict` can detect merged-cell spill blockers.
/// Without this, dynamic-array formulas (e.g. SEQUENCE) spill into merged
/// regions instead of yielding #SPILL! at the anchor.
///
/// This is separate from `rebuild_merge_index` because bridge write methods
/// have access to `CellMirror` but the inner service functions do not — they
/// call `rebuild_merge_index` on the stores, then the bridge method calls this
/// helper with the mirror to complete the two-phase sync.
pub(in crate::storage::engine) fn sync_mirror_merge_regions(
    stores: &EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
) {
    let resolved = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(&stores.storage, *sheet_id, grid),
        None => Vec::new(),
    };
    let mirror_regions: Vec<crate::mirror::MergeRegion> = resolved
        .iter()
        .map(|m| crate::mirror::MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect();
    mirror.set_merge_regions(sheet_id, mirror_regions);
}

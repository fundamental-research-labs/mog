use cell_types::SheetId;
use cell_types::interval_tree::IntervalTree;
use value_types::ComputeError;

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::storage::engine::stores::EngineStores;

pub(super) fn sort_range_backed_rows(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    permutation: &[(u32, u32)],
) -> Result<RecalcResult, ComputeError> {
    // Payloads and sparse cells both retain their axis identities. Reordering
    // the shared axis moves them together without touching cell-map keys.
    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.reorder_row_ids(permutation);
        cell_store.install_sheet_axes(*sheet_id, grid.row_axis(), grid.col_axis());
    }

    // (e) Rebuild col_data for Range-backed columns.
    let range_cols: Vec<u32> = {
        let sheet = cell_store.get_sheet(sheet_id);
        match sheet {
            Some(s) => {
                let cols: rustc_hash::FxHashSet<u32> = s
                    .range_views
                    .values()
                    .flat_map(|rv| rv.col_offset_by_id.keys())
                    .filter_map(|cid| s.col_index_of(&cid))
                    .collect();
                cols.into_iter().collect()
            }
            None => Vec::new(),
        }
    };
    if let Some(sheet) = cell_store.get_sheet_mut(sheet_id) {
        sheet.rebuild_column_index();
    }

    // (f) Bump col_version for all affected columns.
    for col in &range_cols {
        cell_store.bump_col_version(sheet_id, *col);
    }

    // (g) Refresh resolved merge rectangles — positional indices changed since
    //     row_to_index was remapped.
    if let Some(sheet) = cell_store.get_sheet_mut(sheet_id) {
        let row_order = (sheet.id, sheet.row_axis.clone());
        let col_order = (sheet.id, sheet.col_axis.clone());

        // Sorting can move elastic endpoint identities into the interior or
        // reverse their order. Keep the native range's spatial extent around
        // every payload identity, including empty elastic endpoint positions.
        for range in sheet.range_views.values_mut() {
            if let cell_types::RangeAnchor::Elastic {
                start_row, end_row, ..
            } = &mut range.anchor
            {
                let bounds = range
                    .row_offset_by_id
                    .position_bounds(*sheet_id, &sheet.row_axis);
                let positions: Vec<_> = [
                    bounds.map(|(first, _)| first),
                    bounds.map(|(_, last)| last),
                    sheet.row_axis.position_of(*sheet_id, *start_row),
                    sheet.row_axis.position_of(*sheet_id, *end_row),
                ]
                .into_iter()
                .flatten()
                .collect();
                if let (Some(first), Some(last)) = (positions.iter().min(), positions.iter().max())
                {
                    *start_row = sheet.row_axis.identity_at(*sheet_id, *first).unwrap();
                    *end_row = sheet.row_axis.identity_at(*sheet_id, *last).unwrap();
                }
            }
        }
        let mut extents = Vec::new();
        for rv in sheet.range_views.values() {
            if let Some(extent) = rv.compute_extent(&row_order, &col_order) {
                extents.push(extent);
            }
        }
        sheet.range_spatial_index = IntervalTree::build(&extents);
    }

    // (h) Delegate to ComputeCore::structure_change(cell_store, None) for dep graph
    //     rebuild + full recalc. This replaces the per-cell formula handling.
    cell_store.projection_registry.clear();
    stores.compute.structure_change(cell_store, None)
}

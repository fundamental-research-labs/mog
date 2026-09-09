use cell_types::interval_tree::IntervalTree;
use cell_types::{CellId, SheetId, SheetPos};
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::stores::EngineStores;

pub(super) fn sort_range_backed_rows(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    permutation: &[(u32, u32)],
) -> Result<RecalcResult, ComputeError> {
    // (b) Permute GridIndex::row_ids to match the reordered rowOrder.
    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.reorder_row_ids(permutation);
    }

    let cells_to_remap: Vec<(CellId, u32, u32)> = stores
        .grid_indexes
        .get(sheet_id)
        .map(|grid| {
            let affected_rows: rustc_hash::FxHashSet<u32> =
                permutation.iter().map(|&(old_row, _)| old_row).collect();
            grid.cells()
                .filter(|(_, row, _)| affected_rows.contains(row))
                .collect()
        })
        .unwrap_or_default();

    // (c) Update per-cell identity-to-position mappings (needed for mixed sheets).
    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.sort_rows(permutation);
    }

    let moved_cells: Vec<(CellId, SheetPos, SheetPos)> = stores
        .grid_indexes
        .get(sheet_id)
        .map(|grid| {
            cells_to_remap
                .iter()
                .filter_map(|(cell_id, old_row, old_col)| {
                    let (new_row, new_col) = grid.cell_position(cell_id)?;
                    if (*old_row, *old_col) == (new_row, new_col) {
                        return None;
                    }
                    Some((
                        *cell_id,
                        SheetPos::new(*old_row, *old_col),
                        SheetPos::new(new_row, new_col),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    // A cell retains its RowId, which now resolves to the new visible row.
    for (_, old_pos, _) in &moved_cells {
        mirror.vacate_position(sheet_id, *old_pos);
    }
    for (cell_id, _, new_pos) in &moved_cells {
        mirror.sync_cell_position_mapping(sheet_id, *cell_id, *new_pos);
    }

    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        mirror.install_sheet_axes(*sheet_id, grid.row_axis(), grid.col_axis());
    }

    // (e) Rebuild col_data for Range-backed columns.
    let range_cols: Vec<u32> = {
        let sheet = mirror.get_sheet(sheet_id);
        match sheet {
            Some(s) => {
                let cols: rustc_hash::FxHashSet<u32> = s
                    .range_views
                    .values()
                    .flat_map(|rv| rv.col_offset_by_id.keys())
                    .filter_map(|cid| s.col_index_of(cid))
                    .collect();
                cols.into_iter().collect()
            }
            None => Vec::new(),
        }
    };
    if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
        sheet.rebuild_column_index();
    }

    // (f) Bump col_version for all affected columns.
    for col in &range_cols {
        mirror.bump_col_version(sheet_id, *col);
    }

    // (g) Rebuild spatial index — positional indices changed since
    //     row_to_index was remapped.
    if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
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
                let positions: Vec<_> = range
                    .row_offset_by_id
                    .keys()
                    .copied()
                    .chain([*start_row, *end_row])
                    .filter_map(|id| {
                        sheet
                            .row_axis
                            .position_of(*sheet_id, id)
                            .map(|pos| (pos, id))
                    })
                    .collect();
                if let (Some((_, first)), Some((_, last))) = (
                    positions.iter().min_by_key(|(pos, _)| *pos),
                    positions.iter().max_by_key(|(pos, _)| *pos),
                ) {
                    *start_row = *first;
                    *end_row = *last;
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

    // (h) Delegate to ComputeCore::structure_change(mirror, None) for dep graph
    //     rebuild + full recalc. This replaces the per-cell formula handling.
    mirror.projection_registry.clear();
    crate::storage::engine::cell_metadata::refresh(&stores.storage, mirror, stores.layout_metrics);
    stores.compute.structure_change(mirror, None)
}

use cell_types::interval_tree::IntervalTree;
use cell_types::{CellId, ColId, RowId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Any, Array, Map, Origin, Out, Transact};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use crate::storage::infra::grid_helpers::get_row_order_array;

pub(super) fn sort_range_backed_rows(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    permutation: &[(u32, u32)],
) -> Result<RecalcResult, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();

    // (a) Reorder the `rowOrder` YArray using ORIGIN_USER_EDIT so undo captures it.
    mutation.observer.set_suppressed(true);
    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
            && let Some(row_order_arr) = get_row_order_array(&sheet_map, &txn)
        {
            // Read current rowOrder entries
            let len = row_order_arr.len(&txn);
            let mut entries: Vec<String> = Vec::with_capacity(len as usize);
            for i in 0..len {
                if let Some(Out::Any(Any::String(s))) = row_order_arr.get(&txn, i) {
                    entries.push(s.to_string());
                }
            }

            // Build reordered list using the permutation.
            // permutation is Vec<(old_row, new_row)> — swap entries accordingly.
            let mut reordered = entries.clone();
            for &(old_row, new_row) in permutation {
                if (old_row as usize) < entries.len() && (new_row as usize) < reordered.len() {
                    reordered[new_row as usize] = entries[old_row as usize].clone();
                }
            }

            // Remove all entries and re-insert in new order
            // (YArray doesn't have a "reorder" method — must remove+reinsert)
            row_order_arr.remove_range(&mut txn, 0, len);
            for entry in &reordered {
                row_order_arr
                    .push_back(&mut txn, Any::String(std::sync::Arc::from(entry.as_str())));
            }
        }
    }
    mutation.observer.set_suppressed(false);

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

    // Keep the live CellMirror's position maps aligned with GridIndex. Yrs
    // persistence is already identity-based through rowOrder: a cell remains
    // bound to the same RowId, which now resolves to the new visible row.
    for (_, old_pos, _) in &moved_cells {
        mirror.vacate_position(sheet_id, *old_pos);
    }
    for (cell_id, _, new_pos) in &moved_cells {
        mirror.sync_cell_position_mapping(sheet_id, *cell_id, *new_pos);
    }

    // (d) Update mirror row_to_index / index_to_row from the reordered GridIndex.
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        let row_ids = grid.row_ids_ordered();
        if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
            sheet.row_to_index.clear();
            sheet.index_to_row.clear();
            sheet.row_to_index.reserve(row_ids.len());
            sheet.index_to_row.reserve(row_ids.len());
            for (i, rid) in row_ids.into_iter().enumerate() {
                sheet.row_to_index.insert(rid, i as u32);
                sheet.index_to_row.insert(i as u32, rid);
            }
        }
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
        for col in &range_cols {
            sheet.rebuild_col_data(*col);
        }
    }

    // (f) Bump col_version for all affected columns.
    for col in &range_cols {
        mirror.bump_col_version(sheet_id, *col);
    }

    // (g) Rebuild spatial index — positional indices changed since
    //     row_to_index was remapped.
    if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
        let row_order: Vec<RowId> = (0..sheet.rows)
            .filter_map(|i| sheet.index_to_row.get(&i).copied())
            .collect();
        let col_order: Vec<ColId> = (0..sheet.cols)
            .filter_map(|i| sheet.index_to_col.get(&i).copied())
            .collect();

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
    stores.compute.structure_change(mirror, None)
}

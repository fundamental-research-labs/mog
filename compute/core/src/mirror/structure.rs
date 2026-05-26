//! Structural changes (insert/delete rows/cols, remap positions).

use cell_types::interval_tree::IntervalTree;
use cell_types::{CellId, ColId, RangeId, RowId, SheetId, SheetPos};
use formula_types::StructureChange;
use value_types::CellValue;

use rustc_hash::{FxHashMap, FxHashSet};

use super::cell_mirror::CellMirror;
use super::range_view::{RangeExtent, RangeExtentDelta};
use super::types::SheetMirror;
use crate::storage::sheet::range_storage::fold_range_to_cells;

impl CellMirror {
    /// Apply a structural change to a sheet (insert/delete rows/cols, remap positions).
    ///
    /// Returns the list of `RangeId`s that were removed (fully consumed by the
    /// structural change). Callers with Yrs access must clean up the
    /// corresponding `ranges`, `rangePayloads`, `rangeBindings`, and
    /// `rangeFormats` entries.
    ///
    /// Silently ignored (returns empty) if the sheet does not exist.
    pub fn apply_structure_change(
        &mut self,
        sheet: &SheetId,
        change: &StructureChange,
    ) -> Vec<RangeId> {
        self.projection_registry.clear();

        // For deletes, find ALL cell ids in the doomed band on this sheet
        // (caller-provided + ghost cells the mirror knows about that aren't
        // tracked by the caller's `GridIndex`).
        //
        // Walking `id_to_pos` (not `pos_to_id`) catches ghost cells that
        // share a position with a real cell but lost the `pos_to_id` slot.
        let extra_doomed: Vec<CellId> = match change {
            StructureChange::DeleteRows { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| {
                    let end = at.saturating_add(*count);
                    s.id_to_pos
                        .iter()
                        .filter(|&(_, pos)| pos.row() >= *at && pos.row() < end)
                        .map(|(&id, _)| id)
                        .collect()
                })
                .unwrap_or_default(),
            StructureChange::DeleteCols { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| {
                    let end = at.saturating_add(*count);
                    s.id_to_pos
                        .iter()
                        .filter(|&(_, pos)| pos.col() >= *at && pos.col() < end)
                        .map(|(&id, _)| id)
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };

        // Capture deleted RowIds/ColIds from identity maps BEFORE shifts modify them.
        let deleted_row_ids: Vec<RowId> = match change {
            StructureChange::DeleteRows { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| {
                    (*at..*at + *count)
                        .filter_map(|i| s.index_to_row.get(&i).copied())
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        let deleted_col_ids: Vec<ColId> = match change {
            StructureChange::DeleteCols { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| {
                    (*at..*at + *count)
                        .filter_map(|i| s.index_to_col.get(&i).copied())
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };

        // Clean up cell_to_sheet for deleted cells before mutable sheet borrow.
        let deleted_ids: Option<&Vec<CellId>> = match change {
            StructureChange::DeleteRows {
                deleted_cell_ids, ..
            }
            | StructureChange::DeleteCols {
                deleted_cell_ids, ..
            } => Some(deleted_cell_ids),
            _ => None,
        };
        if let Some(ids) = deleted_ids {
            for cell_id in ids {
                self.cell_to_sheet.remove(cell_id);
            }
        }
        for cell_id in &extra_doomed {
            self.cell_to_sheet.remove(cell_id);
        }

        // For deletes with Range views, remove virtual CellIds at deleted positions.
        if (!deleted_row_ids.is_empty() || !deleted_col_ids.is_empty())
            && let Some(s) = self.sheets.get(sheet)
        {
            let range_row_ids: FxHashSet<RowId> = s
                .range_views
                .values()
                .flat_map(|rv| rv.row_offset_by_id.keys().copied())
                .collect();
            let range_col_ids: FxHashSet<ColId> = s
                .range_views
                .values()
                .flat_map(|rv| rv.col_offset_by_id.keys().copied())
                .collect();

            let mut virtual_to_remove: Vec<CellId> = Vec::new();
            for &rid in &deleted_row_ids {
                if !range_row_ids.contains(&rid) {
                    continue;
                }
                for &cid in &range_col_ids {
                    virtual_to_remove.push(CellId::virtual_at(*sheet, rid, cid));
                }
            }
            for &cid in &deleted_col_ids {
                if !range_col_ids.contains(&cid) {
                    continue;
                }
                for &rid in &range_row_ids {
                    if deleted_row_ids.contains(&rid) {
                        continue;
                    }
                    virtual_to_remove.push(CellId::virtual_at(*sheet, rid, cid));
                }
            }
            for vid in &virtual_to_remove {
                self.cell_to_sheet.remove(vid);
            }
            if let Some(s) = self.sheets.get_mut(sheet) {
                for vid in &virtual_to_remove {
                    s.cells.remove(vid);
                    if let Some(pos) = s.id_to_pos.remove(vid) {
                        s.pos_to_id.remove(&pos);
                    }
                }
            }
        }

        let Some(s) = self.sheets.get_mut(sheet) else {
            return Vec::new();
        };

        match change {
            StructureChange::InsertRows {
                at,
                count,
                new_row_ids,
            } => {
                shift_positions(s, *at, *count, true, true);
                remap_positional_metadata(s, *at, *count, true, true);
                shift_identity_map_rows(s, *at, *count, true);
                for (i, rid) in new_row_ids.iter().enumerate() {
                    let idx = *at + i as u32;
                    s.index_to_row.insert(idx, *rid);
                    s.row_to_index.insert(*rid, idx);
                }
                s.rows = s.rows.saturating_add(*count);
                s.grid_rows = s.grid_rows.saturating_add(*count);
                s.identity_rows = s.identity_rows.saturating_add(*count);
            }
            StructureChange::DeleteRows {
                at,
                count,
                deleted_cell_ids,
            } => {
                for cell_id in deleted_cell_ids.iter().chain(extra_doomed.iter()) {
                    s.cells.remove(cell_id);
                    if let Some(pos) = s.id_to_pos.remove(cell_id) {
                        s.pos_to_id.remove(&pos);
                    }
                }
                shift_positions(s, at + count, *count, true, false);
                remap_positional_metadata(s, at + count, *count, true, false);
                for i in *at..*at + *count {
                    if let Some(rid) = s.index_to_row.remove(&i) {
                        s.row_to_index.remove(&rid);
                    }
                }
                shift_identity_map_rows(s, *at + *count, *count, false);
                s.rows = s.rows.saturating_sub(*count);
                s.grid_rows = s.grid_rows.saturating_sub(*count);
                s.identity_rows = s.identity_rows.saturating_sub(*count);
            }
            StructureChange::InsertCols {
                at,
                count,
                new_col_ids,
            } => {
                shift_positions(s, *at, *count, false, true);
                remap_positional_metadata(s, *at, *count, false, true);
                shift_identity_map_cols(s, *at, *count, true);
                for (i, cid) in new_col_ids.iter().enumerate() {
                    let idx = *at + i as u32;
                    s.index_to_col.insert(idx, *cid);
                    s.col_to_index.insert(*cid, idx);
                }
                s.cols = s.cols.saturating_add(*count);
                s.grid_cols = s.grid_cols.saturating_add(*count);
                s.identity_cols = s.identity_cols.saturating_add(*count);
            }
            StructureChange::DeleteCols {
                at,
                count,
                deleted_cell_ids,
            } => {
                for cell_id in deleted_cell_ids.iter().chain(extra_doomed.iter()) {
                    s.cells.remove(cell_id);
                    if let Some(pos) = s.id_to_pos.remove(cell_id) {
                        s.pos_to_id.remove(&pos);
                    }
                }
                shift_positions(s, at + count, *count, false, false);
                remap_positional_metadata(s, at + count, *count, false, false);
                for i in *at..*at + *count {
                    if let Some(cid) = s.index_to_col.remove(&i) {
                        s.col_to_index.remove(&cid);
                    }
                }
                shift_identity_map_cols(s, *at + *count, *count, false);
                s.cols = s.cols.saturating_sub(*count);
                s.grid_cols = s.grid_cols.saturating_sub(*count);
                s.identity_cols = s.identity_cols.saturating_sub(*count);
            }
            StructureChange::RemapPositions { updates } => {
                for (cell_id, _, _) in updates {
                    if let Some(old_pos) = s.id_to_pos.remove(cell_id) {
                        s.pos_to_id.remove(&old_pos);
                    }
                }
                for (cell_id, new_row, new_col) in updates {
                    let pos = SheetPos::new(*new_row, *new_col);
                    s.pos_to_id.insert(pos, *cell_id);
                    s.id_to_pos.insert(*cell_id, pos);
                }
            }
        }

        // --- Range-aware updates (after position shifts, before col_data rebuild) ---

        let has_ranges = !s.range_views.is_empty();
        let mut cols_to_version: Vec<u32> = Vec::new();
        let mut structurally_removed_ranges: Vec<RangeId> = Vec::new();

        if has_ranges {
            let row_order: Vec<RowId> = (0..s.rows)
                .filter_map(|i| s.index_to_row.get(&i).copied())
                .collect();
            let col_order: Vec<ColId> = (0..s.cols)
                .filter_map(|i| s.index_to_col.get(&i).copied())
                .collect();

            let range_ids: Vec<RangeId> = s.range_views.keys().copied().collect();
            let mut removed_range_ids: Vec<RangeId> = Vec::new();

            match change {
                StructureChange::InsertRows { new_row_ids, .. } => {
                    for &range_id in &range_ids {
                        let delta = {
                            let rv = s.range_views.get_mut(&range_id).unwrap();
                            rv.on_rows_inserted(new_row_ids, &row_order, &col_order)
                        };
                        if let RangeExtentDelta::Updated(_) = &delta {
                            let rv = s.range_views.get(&range_id).unwrap();
                            let extent_cells = rv.num_rows() as usize * rv.num_cols() as usize;
                            if extent_cells > 0 && extent_cells < 256 {
                                populate_virtual_cells_for_insert(
                                    s,
                                    sheet,
                                    &range_id,
                                    new_row_ids,
                                    &row_order,
                                    &mut self.cell_to_sheet,
                                );
                            }
                        }
                    }
                }
                StructureChange::InsertCols { new_col_ids, .. } => {
                    for &range_id in &range_ids {
                        let delta = {
                            let rv = s.range_views.get_mut(&range_id).unwrap();
                            rv.on_cols_inserted(new_col_ids, &row_order, &col_order)
                        };
                        match &delta {
                            RangeExtentDelta::Updated(_) => {
                                let rv = s.range_views.get(&range_id).unwrap();
                                let extent_cells = rv.num_rows() as usize * rv.num_cols() as usize;
                                if extent_cells > 0 && extent_cells < 256 {
                                    populate_virtual_cells_for_col_insert(
                                        s,
                                        sheet,
                                        &range_id,
                                        new_col_ids,
                                        &col_order,
                                        &mut self.cell_to_sheet,
                                    );
                                }
                            }
                            RangeExtentDelta::Removed => {
                                removed_range_ids.push(range_id);
                            }
                            RangeExtentDelta::Unchanged => {}
                        }
                    }
                }
                StructureChange::DeleteRows { .. } => {
                    let deleted_set: FxHashSet<RowId> = deleted_row_ids.iter().copied().collect();

                    for &range_id in &range_ids {
                        let delta = {
                            let rv = s.range_views.get_mut(&range_id).unwrap();
                            rv.on_rows_deleted(&deleted_row_ids, &row_order, &col_order)
                        };
                        match delta {
                            RangeExtentDelta::Removed => {
                                removed_range_ids.push(range_id);
                            }
                            _ => {
                                if let Some(rv) = s.range_views.get_mut(&range_id) {
                                    rv.overrides
                                        .retain(|(row_id, _), _| !deleted_set.contains(row_id));
                                    rv.override_count = rv.overrides.len() as u32;
                                }
                            }
                        }
                    }
                }
                StructureChange::DeleteCols { .. } => {
                    let deleted_set: FxHashSet<ColId> = deleted_col_ids.iter().copied().collect();

                    for &range_id in &range_ids {
                        let delta = {
                            let rv = s.range_views.get_mut(&range_id).unwrap();
                            rv.on_cols_deleted(&deleted_col_ids, &row_order, &col_order)
                        };
                        match delta {
                            RangeExtentDelta::Removed => {
                                removed_range_ids.push(range_id);
                            }
                            _ => {
                                if let Some(rv) = s.range_views.get_mut(&range_id) {
                                    rv.overrides
                                        .retain(|(_, col_id), _| !deleted_set.contains(col_id));
                                    rv.override_count = rv.overrides.len() as u32;
                                }
                            }
                        }
                    }
                }
                StructureChange::RemapPositions { .. } => {}
            }

            // Fold removed Ranges into per-cell entries.
            for range_id in &removed_range_ids {
                if let Some(rv) = s.range_views.remove(range_id) {
                    let folded = fold_range_to_cells(
                        &rv,
                        &mut s.cells,
                        &mut s.pos_to_id,
                        &mut s.id_to_pos,
                        &s.row_to_index,
                        &s.col_to_index,
                        sheet,
                    );
                    for vid in folded {
                        self.cell_to_sheet.insert(vid, *sheet);
                    }
                }
            }
            structurally_removed_ranges.extend_from_slice(&removed_range_ids);

            // Rebuild spatial index from surviving Range views.
            let row_order: Vec<RowId> = (0..s.rows)
                .filter_map(|i| s.index_to_row.get(&i).copied())
                .collect();
            let col_order: Vec<ColId> = (0..s.cols)
                .filter_map(|i| s.index_to_col.get(&i).copied())
                .collect();

            let mut extents: Vec<RangeExtent> = Vec::new();
            for rv in s.range_views.values() {
                if let Some(extent) = rv.compute_extent(&row_order, &col_order) {
                    extents.push(extent);
                }
            }
            s.range_spatial_index = IntervalTree::build(&extents);

            // Collect Range-backed column indices for version bumping.
            let range_col_indices: FxHashSet<u32> = s
                .range_views
                .values()
                .flat_map(|rv| {
                    rv.col_offset_by_id
                        .keys()
                        .filter_map(|cid| s.col_to_index.get(cid).copied())
                })
                .collect();
            cols_to_version.extend(range_col_indices);
        }

        // Rebuild col_data: standard rebuild for non-Range columns,
        // then Range-aware rebuild overwrites Range-backed columns.
        rebuild_col_data(s);
        if has_ranges {
            let range_backed_cols: FxHashSet<u32> = s
                .range_views
                .values()
                .flat_map(|rv| {
                    rv.col_offset_by_id
                        .keys()
                        .filter_map(|cid| s.col_to_index.get(cid).copied())
                })
                .collect();
            for col in &range_backed_cols {
                s.rebuild_col_data(*col);
            }
        }

        self.dense_cache.invalidate_sheet(sheet);

        for col in cols_to_version {
            self.bump_col_version(sheet, col);
        }

        structurally_removed_ranges
    }
}

/// Populate virtual CellIds for new rows that land within a sub-256 Elastic Range.
fn populate_virtual_cells_for_insert(
    s: &mut SheetMirror,
    sheet: &SheetId,
    range_id: &RangeId,
    new_row_ids: &[RowId],
    row_order: &[RowId],
    cell_to_sheet: &mut FxHashMap<CellId, SheetId>,
) {
    let new_set: FxHashSet<RowId> = new_row_ids.iter().copied().collect();

    let rv = match s.range_views.get(range_id) {
        Some(rv) => rv,
        None => return,
    };

    let (anchor_start, anchor_end) = match &rv.anchor {
        cell_types::RangeAnchor::Elastic {
            start_row, end_row, ..
        } => (*start_row, *end_row),
        _ => return,
    };

    let start_pos = row_order.iter().position(|r| *r == anchor_start);
    let end_pos = row_order.iter().position(|r| *r == anchor_end);
    let (start_idx, end_idx) = match (start_pos, end_pos) {
        (Some(s), Some(e)) => (s, e),
        _ => return,
    };

    let col_ids: Vec<ColId> = rv.col_offset_by_id.keys().copied().collect();

    let rows_in_extent: Vec<RowId> = row_order
        [start_idx..=end_idx.min(row_order.len().saturating_sub(1))]
        .iter()
        .copied()
        .filter(|rid| new_set.contains(rid))
        .collect();

    for &rid in &rows_in_extent {
        let row_idx = match s.row_to_index.get(&rid).copied() {
            Some(idx) => idx,
            None => continue,
        };
        for &cid in &col_ids {
            let col_idx = match s.col_to_index.get(&cid).copied() {
                Some(idx) => idx,
                None => continue,
            };
            let pos = SheetPos::new(row_idx, col_idx);
            if s.pos_to_id.contains_key(&pos) {
                continue;
            }
            let vid = CellId::virtual_at(*sheet, rid, cid);
            s.pos_to_id.insert(pos, vid);
            s.id_to_pos.insert(vid, pos);
            cell_to_sheet.insert(vid, *sheet);
        }
    }
}

/// Populate virtual CellIds for new columns that land within a sub-256 Elastic Range.
///
/// Symmetric to `populate_virtual_cells_for_insert` but iterates new ColIds
/// against existing RowIds in the range.
fn populate_virtual_cells_for_col_insert(
    s: &mut SheetMirror,
    sheet: &SheetId,
    range_id: &RangeId,
    new_col_ids: &[ColId],
    col_order: &[ColId],
    cell_to_sheet: &mut FxHashMap<CellId, SheetId>,
) {
    let new_set: FxHashSet<ColId> = new_col_ids.iter().copied().collect();

    let rv = match s.range_views.get(range_id) {
        Some(rv) => rv,
        None => return,
    };

    let (anchor_start_col, anchor_end_col) = match &rv.anchor {
        cell_types::RangeAnchor::Elastic {
            start_col, end_col, ..
        } => (*start_col, *end_col),
        _ => return,
    };

    let start_pos = col_order.iter().position(|c| *c == anchor_start_col);
    let end_pos = col_order.iter().position(|c| *c == anchor_end_col);
    let (start_idx, end_idx) = match (start_pos, end_pos) {
        (Some(s), Some(e)) => (s, e),
        _ => return,
    };

    let row_ids: Vec<RowId> = rv.row_offset_by_id.keys().copied().collect();

    let cols_in_extent: Vec<ColId> = col_order
        [start_idx..=end_idx.min(col_order.len().saturating_sub(1))]
        .iter()
        .copied()
        .filter(|cid| new_set.contains(cid))
        .collect();

    for &cid in &cols_in_extent {
        let col_idx = match s.col_to_index.get(&cid).copied() {
            Some(idx) => idx,
            None => continue,
        };
        for &rid in &row_ids {
            let row_idx = match s.row_to_index.get(&rid).copied() {
                Some(idx) => idx,
                None => continue,
            };
            let pos = SheetPos::new(row_idx, col_idx);
            if s.pos_to_id.contains_key(&pos) {
                continue;
            }
            let vid = CellId::virtual_at(*sheet, rid, cid);
            s.pos_to_id.insert(pos, vid);
            s.id_to_pos.insert(vid, pos);
            cell_to_sheet.insert(vid, *sheet);
        }
    }
}

/// Rebuild col_data from per-cell entries (non-Range columns only).
///
/// Range-backed columns are overwritten by `SheetMirror::rebuild_col_data(col)`
/// after this function runs.
fn rebuild_col_data(s: &mut SheetMirror) {
    s.col_data.clear();
    s.col_data_state.clear();
    for (cell_id, &pos) in &s.id_to_pos {
        if let Some(entry) = s.cells.get(cell_id) {
            let col_vec = s.col_data.entry(pos.col()).or_default();
            let ri = pos.row() as usize;
            if ri >= col_vec.len() {
                col_vec.resize(ri + 1, CellValue::Null);
            }
            col_vec[ri] = entry.value.clone();
        }
    }
    let target_len = s.rows as usize;
    for col_vec in s.col_data.values_mut() {
        if col_vec.len() < target_len {
            col_vec.resize(target_len, CellValue::Null);
        }
    }
}

/// Shift positions in the pos_to_id and id_to_pos maps.
///
/// - `threshold`: positions at or after this value are shifted.
/// - `amount`: how much to shift by.
/// - `is_row`: if true, shift rows; if false, shift columns.
/// - `forward`: if true, shift forward (insert); if false, shift backward (delete).
fn shift_positions(s: &mut SheetMirror, threshold: u32, amount: u32, is_row: bool, forward: bool) {
    let to_shift: Vec<(SheetPos, CellId)> = s
        .pos_to_id
        .iter()
        .filter(|&(&pos, _)| {
            if is_row {
                pos.row() >= threshold
            } else {
                pos.col() >= threshold
            }
        })
        .map(|(&pos, &id)| (pos, id))
        .collect();

    for &(pos, cell_id) in &to_shift {
        s.pos_to_id.remove(&pos);
        s.id_to_pos.remove(&cell_id);
    }

    for &(pos, cell_id) in &to_shift {
        let new_pos = if is_row {
            if forward {
                SheetPos::new(pos.row() + amount, pos.col())
            } else {
                SheetPos::new(pos.row() - amount, pos.col())
            }
        } else if forward {
            SheetPos::new(pos.row(), pos.col() + amount)
        } else {
            SheetPos::new(pos.row(), pos.col() - amount)
        };
        s.pos_to_id.insert(new_pos, cell_id);
        s.id_to_pos.insert(cell_id, new_pos);
    }
}

/// Remap position-keyed metadata maps after a structural insert/delete.
fn remap_positional_metadata(
    s: &mut SheetMirror,
    threshold: u32,
    amount: u32,
    is_row: bool,
    forward: bool,
) {
    if !forward {
        let delete_start = threshold - amount;
        if is_row {
            s.row_heights
                .retain(|&k, _| k < delete_start || k >= threshold);
            s.hidden_rows
                .retain(|&k| k < delete_start || k >= threshold);
        } else {
            s.col_widths
                .retain(|&k, _| k < delete_start || k >= threshold);
            s.hidden_cols
                .retain(|&k| k < delete_start || k >= threshold);
        }
    }

    if is_row {
        remap_hashmap_u32(&mut s.row_heights, threshold, amount, forward);
        remap_hashset_u32(&mut s.hidden_rows, threshold, amount, forward);
    } else {
        remap_hashmap_u32(&mut s.col_widths, threshold, amount, forward);
        remap_hashset_u32(&mut s.hidden_cols, threshold, amount, forward);
    }
}

fn remap_hashmap_u32<V>(map: &mut FxHashMap<u32, V>, threshold: u32, amount: u32, forward: bool) {
    let keys_to_shift: Vec<u32> = map.keys().filter(|&&k| k >= threshold).copied().collect();
    let entries: Vec<(u32, V)> = keys_to_shift
        .into_iter()
        .filter_map(|k| map.remove(&k).map(|v| (k, v)))
        .collect();
    for (k, v) in entries {
        let new_k = if forward {
            k + amount
        } else {
            k.saturating_sub(amount)
        };
        map.insert(new_k, v);
    }
}

fn remap_hashset_u32(set: &mut FxHashSet<u32>, threshold: u32, amount: u32, forward: bool) {
    let keys_to_shift: Vec<u32> = set.iter().filter(|&&k| k >= threshold).copied().collect();
    for k in keys_to_shift {
        set.remove(&k);
        let new_k = if forward {
            k + amount
        } else {
            k.saturating_sub(amount)
        };
        set.insert(new_k);
    }
}

/// Shift `index_to_row` / `row_to_index` so that the Range-aware section
/// sees correct identity maps. Same pattern as `shift_positions` but for
/// the RowId↔index maps rather than CellId↔pos maps.
fn shift_identity_map_rows(s: &mut SheetMirror, threshold: u32, amount: u32, forward: bool) {
    let to_shift: Vec<(u32, RowId)> = s
        .index_to_row
        .iter()
        .filter(|(idx, _)| **idx >= threshold)
        .map(|(&idx, &rid)| (idx, rid))
        .collect();
    for &(idx, rid) in &to_shift {
        s.index_to_row.remove(&idx);
        s.row_to_index.remove(&rid);
    }
    for &(idx, rid) in &to_shift {
        let new_idx = if forward { idx + amount } else { idx - amount };
        s.index_to_row.insert(new_idx, rid);
        s.row_to_index.insert(rid, new_idx);
    }
}

/// Symmetric to `shift_identity_map_rows` for columns.
fn shift_identity_map_cols(s: &mut SheetMirror, threshold: u32, amount: u32, forward: bool) {
    let to_shift: Vec<(u32, ColId)> = s
        .index_to_col
        .iter()
        .filter(|(idx, _)| **idx >= threshold)
        .map(|(&idx, &cid)| (idx, cid))
        .collect();
    for &(idx, cid) in &to_shift {
        s.index_to_col.remove(&idx);
        s.col_to_index.remove(&cid);
    }
    for &(idx, cid) in &to_shift {
        let new_idx = if forward { idx + amount } else { idx - amount };
        s.index_to_col.insert(new_idx, cid);
        s.col_to_index.insert(cid, new_idx);
    }
}

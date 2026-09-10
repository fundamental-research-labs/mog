//! Structural changes (insert/delete rows/cols, remap positions).

use cell_types::interval_tree::IntervalTree;
use cell_types::{CellId, ColId, RangeId, RowId, SheetId, SheetPos};
use formula_types::StructureChange;

use rustc_hash::{FxHashMap, FxHashSet};

use super::cell_store::CellStore;
use super::range_view::{RangeExtent, RangeExtentDelta};
use super::types::SheetStore;
use crate::storage::sheet::range_storage::fold_range_to_cells;

impl CellStore {
    /// Apply a structural change to a sheet (insert/delete rows/cols, remap positions).
    ///
    /// Returns the list of `RangeId`s that were removed (fully consumed by the
    /// structural change), so callers can remove associated range metadata.
    ///
    /// Silently ignored (returns empty) if the sheet does not exist.
    pub fn apply_structure_change(
        &mut self,
        sheet: &SheetId,
        change: &StructureChange,
    ) -> Vec<RangeId> {
        self.apply_structure_change_with_axes(sheet, change, None)
    }

    pub(crate) fn apply_structure_change_with_axes(
        &mut self,
        sheet: &SheetId,
        change: &StructureChange,
        axes: Option<(
            std::sync::Arc<compute_document::identity::AxisIndex<RowId>>,
            std::sync::Arc<compute_document::identity::AxisIndex<ColId>>,
        )>,
    ) -> Vec<RangeId> {
        self.projection_registry.clear();

        // Include metadata anchors and sparse edits in the deleted axis band.
        let extra_doomed: Vec<CellId> = match change {
            StructureChange::DeleteRows { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| {
                    let end = at.saturating_add(*count);
                    s.cells()
                        .filter(|(_, row, _)| *row >= *at && *row < end)
                        .map(|(id, _, _)| id)
                        .collect()
                })
                .unwrap_or_default(),
            StructureChange::DeleteCols { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| {
                    let end = at.saturating_add(*count);
                    s.cells()
                        .filter(|(_, _, col)| *col >= *at && *col < end)
                        .map(|(id, _, _)| id)
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
                .map(|s| (*at..*at + *count).filter_map(|i| s.row_id_at(i)).collect())
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        let deleted_col_ids: Vec<ColId> = match change {
            StructureChange::DeleteCols { at, count, .. } => self
                .sheets
                .get(sheet)
                .map(|s| (*at..*at + *count).filter_map(|i| s.col_id_at(i)).collect())
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
                self.cells.remove(cell_id);
                self.formulas.remove(cell_id);
            }
        }
        for cell_id in &extra_doomed {
            self.cell_to_sheet.remove(cell_id);
            self.cells.remove(cell_id);
            self.formulas.remove(cell_id);
        }

        let Some(s) = self.sheets.get_mut(sheet) else {
            return Vec::new();
        };

        // Imported array members are metadata-only package cells. Rebase their
        // positional compatibility fields alongside native identities so a
        // later rebuild cannot restore the pre-structure coordinates.
        s.apply_structure_change_to_imported_array_caches(change, &self.cells, &self.formulas);

        match change {
            StructureChange::InsertRows {
                at,
                count,
                new_row_ids,
            } => {
                remap_positional_metadata(s, *at, *count, true, true);
                if let Some((rows, _)) = &axes {
                    s.row_axis = rows.clone();
                } else {
                    std::sync::Arc::make_mut(&mut s.row_axis).insert_explicit(
                        *sheet,
                        *at,
                        new_row_ids.iter().copied(),
                    );
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
                    s.remove_cell_identity(cell_id);
                }
                remap_positional_metadata(s, at + count, *count, true, false);
                if let Some((rows, _)) = &axes {
                    s.row_axis = rows.clone();
                } else {
                    std::sync::Arc::make_mut(&mut s.row_axis).delete_range(*at, *count);
                }
                s.rows = s.rows.saturating_sub(*count);
                s.grid_rows = s.grid_rows.saturating_sub(*count);
                s.identity_rows = s.identity_rows.saturating_sub(*count);
            }
            StructureChange::InsertCols {
                at,
                count,
                new_col_ids,
            } => {
                remap_positional_metadata(s, *at, *count, false, true);
                if let Some((_, cols)) = &axes {
                    s.col_axis = cols.clone();
                } else {
                    std::sync::Arc::make_mut(&mut s.col_axis).insert_explicit(
                        *sheet,
                        *at,
                        new_col_ids.iter().copied(),
                    );
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
                    s.remove_cell_identity(cell_id);
                }
                remap_positional_metadata(s, at + count, *count, false, false);
                if let Some((_, cols)) = &axes {
                    s.col_axis = cols.clone();
                } else {
                    std::sync::Arc::make_mut(&mut s.col_axis).delete_range(*at, *count);
                }
                s.cols = s.cols.saturating_sub(*count);
                s.grid_cols = s.grid_cols.saturating_sub(*count);
                s.identity_cols = s.identity_cols.saturating_sub(*count);
            }
            StructureChange::RemapPositions { updates } => {
                for (cell_id, _, _) in updates {
                    s.remove_cell_identity(cell_id);
                }
                for (cell_id, new_row, new_col) in updates {
                    let pos = SheetPos::new(*new_row, *new_col);
                    if let Some(displaced) = s.authored_cell_id_at(pos).filter(|id| id != cell_id) {
                        s.remove_cell_identity(&displaced);
                        self.cell_to_sheet.remove(&displaced);
                        self.cells.remove(&displaced);
                        self.formulas.remove(&displaced);
                    }
                    s.register_cell(*cell_id, pos.row(), pos.col());
                    if !s.is_ghost(cell_id, &self.cells, &self.formulas) {
                        s.expand_extent(pos);
                    } else {
                        s.expand_identity_extent(pos);
                    }
                }
            }
        }

        // Stable identities are authoritative for moved cache members. The
        // positional pass above handles range boundaries and deleted bands;
        // this pass resolves the surviving source/child coordinates after the
        // native identity maps have shifted.
        s.rebind_imported_array_caches(&self.cells, &self.formulas);

        // --- Range-aware updates (after position shifts, before column_values rebuild) ---

        let has_ranges = !s.range_views.is_empty();
        let mut cols_to_version: Vec<u32> = Vec::new();
        let mut structurally_removed_ranges: Vec<RangeId> = Vec::new();

        if has_ranges {
            let row_order = (s.id, s.row_axis.clone());
            let col_order = (s.id, s.col_axis.clone());

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
                    for &range_id in &range_ids {
                        let delta = {
                            let rv = s.range_views.get_mut(&range_id).unwrap();
                            rv.on_rows_deleted(&deleted_row_ids, &row_order, &col_order)
                        };
                        match delta {
                            RangeExtentDelta::Removed => {
                                removed_range_ids.push(range_id);
                            }
                            _ => {}
                        }
                    }
                }
                StructureChange::DeleteCols { .. } => {
                    for &range_id in &range_ids {
                        let delta = {
                            let rv = s.range_views.get_mut(&range_id).unwrap();
                            rv.on_cols_deleted(&deleted_col_ids, &row_order, &col_order)
                        };
                        match delta {
                            RangeExtentDelta::Removed => {
                                removed_range_ids.push(range_id);
                            }
                            _ => {}
                        }
                    }
                }
                StructureChange::RemapPositions { .. } => {}
            }

            // Fold removed Ranges into per-cell entries.
            for range_id in &removed_range_ids {
                if let Some(rv) = s.range_views.remove(range_id) {
                    let folded = fold_range_to_cells(&rv, s, &mut self.cells, &self.formulas);
                    for vid in folded {
                        self.cell_to_sheet.insert(vid, *sheet);
                    }
                }
            }
            structurally_removed_ranges.extend_from_slice(&removed_range_ids);

            // Rebuild spatial index from surviving Range views.
            let row_order = (s.id, s.row_axis.clone());
            let col_order = (s.id, s.col_axis.clone());

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
                        .filter_map(|cid| s.col_axis.position_of(s.id, cid))
                })
                .collect();
            cols_to_version.extend(range_col_indices);
        }

        s.projected_columns.clear();
        s.generated_values.clear();
        s.rebuild_column_index(&self.cells, &self.formulas);

        self.refresh_axis_ownership(*sheet);
        self.dense_cache.invalidate_sheet(sheet);
        for &col in self.sheets[sheet].column_lengths.keys() {
            self.dense_cache.register_column(*sheet, col);
        }

        for col in cols_to_version {
            self.bump_col_version(sheet, col);
        }

        structurally_removed_ranges
    }
}

/// Populate virtual CellIds for new rows that land within a sub-256 Elastic Range.
fn populate_virtual_cells_for_insert(
    s: &mut SheetStore,
    sheet: &SheetId,
    range_id: &RangeId,
    new_row_ids: &[RowId],
    cell_to_sheet: &mut FxHashMap<CellId, SheetId>,
) {
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

    let start_pos = s.row_index_of(&anchor_start);
    let end_pos = s.row_index_of(&anchor_end);
    let (start_idx, end_idx) = match (start_pos, end_pos) {
        (Some(s), Some(e)) => (s, e),
        _ => return,
    };

    let col_ids: Vec<ColId> = rv.col_offset_by_id.keys().collect();

    let rows_in_extent: Vec<RowId> = new_row_ids
        .iter()
        .copied()
        .filter(|id| {
            s.row_index_of(id)
                .is_some_and(|pos| pos >= start_idx && pos <= end_idx)
        })
        .collect();

    for &rid in &rows_in_extent {
        let row_idx = match s.row_index_of(&rid) {
            Some(idx) => idx,
            None => continue,
        };
        for &cid in &col_ids {
            let col_idx = match s.col_index_of(&cid) {
                Some(idx) => idx,
                None => continue,
            };
            let pos = SheetPos::new(row_idx, col_idx);
            if s.authored_cell_id_at(pos).is_some() {
                continue;
            }
            let vid = CellId::virtual_at(*sheet, rid, cid);
            s.register_cell(vid, (pos).row(), (pos).col());
            cell_to_sheet.insert(vid, *sheet);
        }
    }
}

/// Populate virtual CellIds for new columns that land within a sub-256 Elastic Range.
///
/// Symmetric to `populate_virtual_cells_for_insert` but iterates new ColIds
/// against existing RowIds in the range.
fn populate_virtual_cells_for_col_insert(
    s: &mut SheetStore,
    sheet: &SheetId,
    range_id: &RangeId,
    new_col_ids: &[ColId],
    cell_to_sheet: &mut FxHashMap<CellId, SheetId>,
) {
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

    let start_pos = s.col_index_of(&anchor_start_col);
    let end_pos = s.col_index_of(&anchor_end_col);
    let (start_idx, end_idx) = match (start_pos, end_pos) {
        (Some(s), Some(e)) => (s, e),
        _ => return,
    };

    let row_ids: Vec<RowId> = rv.row_offset_by_id.keys().collect();

    let cols_in_extent: Vec<ColId> = new_col_ids
        .iter()
        .copied()
        .filter(|id| {
            s.col_index_of(id)
                .is_some_and(|pos| pos >= start_idx && pos <= end_idx)
        })
        .collect();

    for &cid in &cols_in_extent {
        let col_idx = match s.col_index_of(&cid) {
            Some(idx) => idx,
            None => continue,
        };
        for &rid in &row_ids {
            let row_idx = match s.row_index_of(&rid) {
                Some(idx) => idx,
                None => continue,
            };
            let pos = SheetPos::new(row_idx, col_idx);
            if s.authored_cell_id_at(pos).is_some() {
                continue;
            }
            let vid = CellId::virtual_at(*sheet, rid, cid);
            s.register_cell(vid, (pos).row(), (pos).col());
            cell_to_sheet.insert(vid, *sheet);
        }
    }
}

/// Remap position-keyed metadata maps after a structural insert/delete.
fn remap_positional_metadata(
    s: &mut SheetStore,
    threshold: u32,
    amount: u32,
    is_row: bool,
    forward: bool,
) {
    if !forward {
        let delete_start = threshold - amount;
        if is_row {
            s.hidden_rows
                .retain(|&k| k < delete_start || k >= threshold);
        } else {
            s.hidden_cols
                .retain(|&k| k < delete_start || k >= threshold);
        }
    }

    if is_row {
        remap_hashset_u32(&mut s.hidden_rows, threshold, amount, forward);
    } else {
        remap_hashset_u32(&mut s.hidden_cols, threshold, amount, forward);
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

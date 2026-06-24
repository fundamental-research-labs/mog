use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::observe::DocumentChanges;
use value_types::ComputeError;

use crate::scheduler::ComputeCore;
use crate::snapshot::{ChangeKind, MutationResult, RecalcResult};

use super::grid_indexing::apply_grid_index_changes;
use super::sync_authored_cells::{
    AuthoredCellSnapshot, diff_authored_cell_changes, snapshot_authored_cells,
};
use super::{YrsComputeEngine, construction, services, viewport};

mod axis_capacity;
mod repair;
mod runtime_settings;

impl YrsComputeEngine {
    pub(super) fn rebuild_from_yrs_after_sync(
        &mut self,
        pre_sheet_order: Vec<SheetId>,
        pre_authored_cells: AuthoredCellSnapshot,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        use crate::snapshot::{
            Axis, DimensionChange, MergeChange, SheetChange, SheetChangeField,
            StructureChangeResult, StructureChangeType, VisibilityChange,
        };
        use crate::storage::sheet::dimensions;
        use value_types::FiniteF64;

        let pre_merges: HashMap<SheetId, HashSet<(u32, u32, u32, u32)>> = pre_sheet_order
            .iter()
            .map(|sid| {
                let regions: HashSet<_> = self
                    .stores
                    .merge_indexes
                    .get(sid)
                    .map(|idx| {
                        idx.items()
                            .iter()
                            .map(|m| (m.start_row, m.start_col, m.end_row, m.end_col))
                            .collect()
                    })
                    .unwrap_or_default();
                (*sid, regions)
            })
            .collect();

        let pre_row_counts: HashMap<SheetId, usize> = pre_sheet_order
            .iter()
            .filter_map(|sid| {
                self.stores
                    .grid_indexes
                    .get(sid)
                    .map(|g| (*sid, g.row_count() as usize))
            })
            .collect();
        let pre_col_counts: HashMap<SheetId, usize> = pre_sheet_order
            .iter()
            .filter_map(|sid| {
                self.stores
                    .grid_indexes
                    .get(sid)
                    .map(|g| (*sid, g.col_count() as usize))
            })
            .collect();

        repair::repair_orphaned_cell_bindings_after_sync(self)?;

        let workbook_snap = construction::build_workbook_snapshot_from_yrs(&self.stores.storage)?;

        self.stores.grid_indexes = construction::build_grid_indexes_from_yrs(
            &self.stores.storage,
            &workbook_snap,
            self.stores.grid_id_alloc.clone(),
        )?;
        let mut rebuilt_mirror = construction::build_finalized_mirror_from_snapshot(
            &self.stores.storage,
            &workbook_snap,
            &self.stores.grid_indexes,
        )?;

        self.stores.compute = ComputeCore::new();
        let recalc = self
            .stores
            .compute
            .init_from_snapshot_with_prebuilt_mirror(&mut rebuilt_mirror, workbook_snap.clone())?;
        self.stores
            .compute
            .set_id_alloc(self.stores.grid_id_alloc.clone());
        self.mirror = rebuilt_mirror;

        self.stores.merge_indexes = construction::build_merge_indexes(
            &self.stores.storage,
            &workbook_snap,
            &self.stores.grid_indexes,
        )?;
        self.stores.layout_indexes = construction::build_layout_indexes(
            &self.stores.storage,
            &workbook_snap,
            &self.stores.grid_indexes,
        )?;

        self.settings = construction::derive_settings(&self.stores.storage);
        self.init_cf_caches();

        let mut result = services::mutation_handlers::build_mutation_result_for_hydration(
            &self.stores,
            &self.mirror,
            recalc,
        );
        let post_authored_cells = snapshot_authored_cells(&self.mirror, &self.stores.compute);
        result.authored_cell_changes =
            diff_authored_cell_changes(&pre_authored_cells, &post_authored_cells);

        let post_sheet_order: Vec<SheetId> = self.stores.storage.sheet_order();
        let doc = self.stores.storage.doc();
        let sheets_ref = self.stores.storage.sheets();

        for sid in &pre_sheet_order {
            if !post_sheet_order.contains(sid) {
                result.sheet_changes.push(SheetChange {
                    sheet_id: sid.to_uuid_string(),
                    kind: ChangeKind::Removed,
                    field: SheetChangeField::Sheet,
                    name: None,
                    old_name: None,
                    index: None,
                    old_index: None,
                    hidden: None,
                    source_sheet_id: None,
                    frozen_rows: None,
                    old_frozen_rows: None,
                    frozen_cols: None,
                    old_frozen_cols: None,
                    color: None,
                    old_color: None,
                });
            }
        }

        for sid in &post_sheet_order {
            let current_merges = services::queries::get_all_merges_in_sheet(&self.stores, sid);
            let sheet_id_str = sid.to_uuid_string();

            let current_set: HashSet<(u32, u32, u32, u32)> = current_merges
                .iter()
                .map(|m| (m.start_row, m.start_col, m.end_row, m.end_col))
                .collect();

            for m in &current_merges {
                result.merge_changes.push(MergeChange {
                    sheet_id: sheet_id_str.clone(),
                    kind: ChangeKind::Set,
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                });
            }

            if let Some(old_merges) = pre_merges.get(sid) {
                for &(sr, sc, er, ec) in old_merges {
                    if !current_set.contains(&(sr, sc, er, ec)) {
                        result.merge_changes.push(MergeChange {
                            sheet_id: sheet_id_str.clone(),
                            kind: ChangeKind::Removed,
                            start_row: sr,
                            start_col: sc,
                            end_row: er,
                            end_col: ec,
                        });
                    }
                }
            }
        }

        for sid in &post_sheet_order {
            let sheet_id_str = sid.to_uuid_string();
            let grid = self.stores.grid_indexes.get(sid);

            for (row, height) in dimensions::get_all_custom_row_heights(doc, sheets_ref, sid, grid)
            {
                result.dimension_changes.push(DimensionChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Row,
                    index: row as u32,
                    kind: ChangeKind::Set,
                    size: FiniteF64::new(height.0),
                });
            }

            for (col, width) in dimensions::get_all_custom_col_widths(doc, sheets_ref, sid, grid) {
                result.dimension_changes.push(DimensionChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Col,
                    index: col as u32,
                    kind: ChangeKind::Set,
                    size: FiniteF64::new(width.0),
                });
            }
        }

        for sid in &post_sheet_order {
            let sheet_id_str = sid.to_uuid_string();

            for row in dimensions::get_hidden_rows(doc, sheets_ref, sid) {
                result.visibility_changes.push(VisibilityChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Row,
                    index: row,
                    hidden: true,
                });
            }

            for col in dimensions::get_hidden_columns(doc, sheets_ref, sid) {
                result.visibility_changes.push(VisibilityChange {
                    sheet_id: sheet_id_str.clone(),
                    axis: Axis::Col,
                    index: col,
                    hidden: true,
                });
            }
        }

        for sid in &post_sheet_order {
            let sheet_id_str = sid.to_uuid_string();
            if let Some(grid) = self.stores.grid_indexes.get(sid) {
                let post_rows = grid.row_count() as usize;
                let post_cols = grid.col_count() as usize;
                let pre_rows = pre_row_counts.get(sid).copied().unwrap_or(0);
                let pre_cols = pre_col_counts.get(sid).copied().unwrap_or(0);

                if post_rows > pre_rows {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::InsertRows,
                        at: pre_rows as u32,
                        count: (post_rows - pre_rows) as u32,
                    });
                } else if post_rows < pre_rows {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::DeleteRows,
                        at: post_rows as u32,
                        count: (pre_rows - post_rows) as u32,
                    });
                }

                if post_cols > pre_cols {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::InsertCols,
                        at: pre_cols as u32,
                        count: (post_cols - pre_cols) as u32,
                    });
                } else if post_cols < pre_cols {
                    result.structure_changes.push(StructureChangeResult {
                        sheet_id: sheet_id_str.clone(),
                        change_type: StructureChangeType::DeleteCols,
                        at: post_cols as u32,
                        count: (pre_cols - post_cols) as u32,
                    });
                }
            }
        }

        Ok((vec![], result))
    }

    fn bootstrap_sheet_from_yrs(&mut self, sheet_id: SheetId) -> Result<bool, ComputeError> {
        if self.stores.grid_indexes.contains_key(&sheet_id) {
            return Ok(false);
        }

        let Some(sheet_snap) =
            construction::build_sheet_snapshot_from_yrs(&self.stores.storage, &sheet_id)?
        else {
            return Ok(false);
        };

        let grid = crate::storage::engine::build_grid_from_yrs_for_sheet(
            &self.stores.storage,
            sheet_id,
            &sheet_snap,
            self.stores.grid_id_alloc.clone(),
        )?;
        self.stores.grid_indexes.insert(sheet_id, grid);

        let _ = self.mirror.add_sheet(sheet_snap.clone());

        {
            use crate::storage::sheet::visibility;
            let enabled = visibility::is_sheet_calculation_enabled(
                self.stores.storage.doc(),
                self.stores.storage.sheets(),
                &sheet_id,
            );
            self.mirror.set_enable_calculation(&sheet_id, enabled);
        }

        let li = construction::build_layout_index_for_sheet(
            &self.stores.storage,
            &sheet_id,
            sheet_snap.rows,
            sheet_snap.cols,
            self.stores.grid_indexes.get(&sheet_id),
        );
        self.stores.layout_indexes.insert(sheet_id, li);

        Ok(true)
    }

    fn collect_observer_touched_sheet_ids(
        &self,
        doc_changes: &DocumentChanges,
    ) -> HashSet<SheetId> {
        let mut sheet_ids = HashSet::new();

        sheet_ids.extend(doc_changes.sheet_additions.iter().copied());
        sheet_ids.extend(doc_changes.cells.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.properties.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.row_heights.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.col_widths.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.merges.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.hidden_rows.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.hidden_cols.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.comments.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.filters.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.grouping.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.sparklines.iter().map(|change| change.sheet_id));
        sheet_ids.extend(
            doc_changes
                .conditional_formats
                .iter()
                .map(|change| change.sheet_id),
        );
        sheet_ids.extend(
            doc_changes
                .floating_objects
                .iter()
                .map(|change| change.sheet_id),
        );
        sheet_ids.extend(
            doc_changes
                .pivot_tables
                .iter()
                .map(|change| change.sheet_id),
        );
        sheet_ids.extend(doc_changes.sheet_meta.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.row_formats.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.col_formats.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.sorting.iter().map(|change| change.sheet_id));
        sheet_ids.extend(doc_changes.structural_changes.iter().copied());
        sheet_ids.extend(doc_changes.grid_index.iter().map(|change| change.sheet_id));

        if doc_changes.sheet_order_changed {
            sheet_ids.extend(self.stores.storage.sheet_order());
        }

        sheet_ids
    }

    fn sync_sheet_names_from_yrs(&mut self, doc_changes: &DocumentChanges) {
        let mut seen = HashSet::new();
        for change in &doc_changes.sheet_meta {
            if change.field.as_deref() != Some("name") || !seen.insert(change.sheet_id) {
                continue;
            }
            if let Some(name) = crate::storage::sheet::properties::get_sheet_name(
                self.stores.storage.doc(),
                self.stores.storage.sheets(),
                &change.sheet_id,
            ) {
                self.mirror.rename_sheet(&change.sheet_id, &name);
            }
        }
    }

    fn hydrate_table_change_metadata_from_mirror(&self, doc_changes: &mut DocumentChanges) {
        for change in &mut doc_changes.tables {
            if change.name.is_some() && change.sheet_id.is_some() {
                continue;
            }
            let Some(table) = self.mirror.get_table_by_id(&change.key) else {
                continue;
            };
            if change.name.is_none() {
                change.name = Some(table.name.clone());
            }
            if change.sheet_id.is_none() {
                change.sheet_id = SheetId::from_uuid_str(&table.sheet_id).ok();
            }
        }
    }

    /// Drain observer changes, sync mirror + recalc, and return domain changes.
    fn apply_all_observer_changes(
        &mut self,
    ) -> Result<(RecalcResult, DocumentChanges), ComputeError> {
        let mut doc_changes = self.mutation.observer.drain_all_changes();

        if doc_changes.is_empty() {
            return Ok((RecalcResult::empty(), doc_changes));
        }

        if doc_changes.workbook_settings_changed {
            self.sync_runtime_calculation_settings_from_storage();
        }

        let mut sheet_lifecycle_changed = false;

        for &sheet_id in &doc_changes.sheet_additions {
            self.bootstrap_sheet_from_yrs(sheet_id)?;
            sheet_lifecycle_changed = true;
        }

        for &sheet_id in &doc_changes.sheet_deletions {
            if self.stores.grid_indexes.remove(&sheet_id).is_some() {
                sheet_lifecycle_changed = true;
            }
            self.mirror.remove_sheet(&sheet_id);
            self.stores.layout_indexes.remove(&sheet_id);
        }

        let deleted_sheets: HashSet<SheetId> =
            doc_changes.sheet_deletions.iter().copied().collect();
        for sheet_id in self.collect_observer_touched_sheet_ids(&doc_changes) {
            if deleted_sheets.contains(&sheet_id) {
                continue;
            }
            if self.bootstrap_sheet_from_yrs(sheet_id)? {
                sheet_lifecycle_changed = true;
            }
        }

        if sheet_lifecycle_changed {
            let workbook_snap =
                construction::build_workbook_snapshot_from_yrs(&self.stores.storage)?;

            self.stores.grid_indexes = construction::build_grid_indexes_from_yrs(
                &self.stores.storage,
                &workbook_snap,
                self.stores.grid_id_alloc.clone(),
            )?;
            let mut rebuilt_mirror = construction::build_finalized_mirror_from_snapshot(
                &self.stores.storage,
                &workbook_snap,
                &self.stores.grid_indexes,
            )?;

            self.stores.compute = ComputeCore::new();
            let recalc = self
                .stores
                .compute
                .init_from_snapshot_with_prebuilt_mirror(
                    &mut rebuilt_mirror,
                    workbook_snap.clone(),
                )?;
            self.stores
                .compute
                .set_id_alloc(self.stores.grid_id_alloc.clone());
            self.mirror = rebuilt_mirror;

            self.stores.merge_indexes = construction::build_merge_indexes(
                &self.stores.storage,
                &workbook_snap,
                &self.stores.grid_indexes,
            )?;
            self.stores.layout_indexes = construction::build_layout_indexes(
                &self.stores.storage,
                &workbook_snap,
                &self.stores.grid_indexes,
            )?;

            self.settings = construction::derive_settings(&self.stores.storage);
            self.init_cf_caches();
            return Ok((recalc, doc_changes));
        }

        self.sync_sheet_names_from_yrs(&doc_changes);

        let capacity_axis_sheets =
            axis_capacity::capacity_replay_sheets(&self.stores, &doc_changes);
        axis_capacity::apply_tail_inserts(&mut self.stores, &doc_changes, &capacity_axis_sheets)?;

        // --- Identity: mirror gridIndex/posToId entries into in-memory GridIndex ---
        // The yrs `gridIndex/posToId` sub-map is the CRDT-synchronised source of
        // truth for (row, col) ↔ CellId mappings (post-R51). When a peer
        // receives a metadata write on a previously-empty cell (comment,
        // format, hyperlink, …) the payload alone is not sufficient —
        // subsequent position-based lookups must resolve, so we hydrate the
        // in-memory GridIndex from every observed `posToId` entry change here,
        // BEFORE any cell/comment/etc. processing reads the index.
        // Vacated positions: (sheet_id, old_pos) pairs for cells that moved
        // due to a gridIndex change. We emit a synthetic Null viewport patch
        // for each one so the old screen position is visually cleared
        // (e.g. A1 during redo of a cut-paste that originally moved A1→C1).
        let mut vacated_positions: Vec<(SheetId, SheetPos)> = Vec::new();
        let mut occupied_positions: Vec<(SheetId, CellId, SheetPos)> = Vec::new();

        if !doc_changes.grid_index.is_empty() {
            apply_grid_index_changes(&mut self.stores, &doc_changes.grid_index)?;

            // For cells that changed position in the yrs gridIndex (undo/redo of
            // same-sheet relocate_cells writes updated posToId/idToPos entries),
            // update the mirror so apply_cell_changes can resolve the correct
            // position when the cell fires as Modified.
            //
            // Without this, the mirror retains the stale post-relocation
            // id_to_pos entry (e.g. X→C1) and apply_cell_changes would apply
            // the cell's value at the wrong position, leaving the source cells
            // empty after undo (half-undo bug).
            use compute_document::observe::CellChangeKind;
            for change in &doc_changes.grid_index {
                if matches!(change.kind, CellChangeKind::Modified) {
                    // Resolve the new position from the just-updated grid index.
                    let new_pos = self
                        .stores
                        .grid_indexes
                        .get(&change.sheet_id)
                        .and_then(|g| g.cell_position(&change.cell_id))
                        .map(|(r, c)| cell_types::SheetPos::new(r, c));
                    if let Some(new_pos) = new_pos {
                        // Vacate the stale old mirror position (clears pos_to_id
                        // and col_data at the former slot so apply_edit at the
                        // new position doesn't fight with the old mapping).
                        if let Some(old_pos) = self.mirror.resolve_position(&change.cell_id)
                            && old_pos != new_pos
                        {
                            self.mirror.vacate_position(&change.sheet_id, old_pos);
                            // Record the old position so we can emit a
                            // synthetic Null viewport patch for it (e.g.
                            // during redo, A1 must visually clear even though
                            // no yrs cell change targets A1 directly).
                            vacated_positions.push((change.sheet_id, old_pos));
                        }
                        // Update id_to_pos immediately so apply_cell_changes reads
                        // the correct position. Then, after all old positions have
                        // been vacated, repopulate pos_to_id/col_data for
                        // gridIndex-only moves that do not emit cell changes.
                        self.mirror
                            .update_id_to_pos(&change.sheet_id, change.cell_id, new_pos);
                        occupied_positions.push((change.sheet_id, change.cell_id, new_pos));
                    }
                }
            }

            for (sheet_id, cell_id, new_pos) in &occupied_positions {
                self.mirror
                    .sync_cell_position_mapping(sheet_id, *cell_id, *new_pos);
            }
        }

        // Detect structural meta changes (rows/cols modified by undo/redo/sync).
        // When structural changes are detected, the in-memory GridIndex and
        // CellMirror have stale positions — we must rebuild them from yrs
        // (the CRDT source of truth) rather than patching incrementally.
        let structural_sheets: Vec<SheetId> = {
            let mut seen = std::collections::HashSet::new();
            let mut sheets = Vec::new();
            for sheet_id in &doc_changes.structural_changes {
                if seen.insert(*sheet_id) {
                    sheets.push(*sheet_id);
                }
            }
            for change in &doc_changes.axis_order {
                if capacity_axis_sheets.contains(&change.sheet_id) {
                    continue;
                }
                if seen.insert(change.sheet_id) {
                    sheets.push(change.sheet_id);
                }
            }
            sheets
        };

        let mut recalc = if !structural_sheets.is_empty() {
            self.rebuild_after_structural_observer_change(&structural_sheets, &doc_changes)?
        } else {
            // Normal path: incremental cell changes only.
            if !vacated_positions.is_empty() {
                self.stores
                    .compute
                    .regenerate_formula_strings_and_cell_formula_text(&self.mirror);
            }
            if !doc_changes.cells.is_empty() {
                services::mutation::apply_cell_changes(
                    &mut self.stores,
                    &mut self.mirror,
                    &doc_changes.cells,
                )?
            } else {
                RecalcResult::empty()
            }
        };

        let occupied_position_set: std::collections::HashSet<(SheetId, u32, u32)> =
            occupied_positions
                .iter()
                .map(|(sheet_id, _, pos)| (*sheet_id, pos.row(), pos.col()))
                .collect();

        // Emit synthetic Null patches for positions vacated by gridIndex moves
        // (undo/redo of same-sheet relocate_cells). These clear old screen
        // positions unless the same observer batch reoccupied that position
        // (for example, sort undo permutes identities within the same range).
        if !vacated_positions.is_empty() {
            use snapshot_types::CellChange as SnapCellChange;
            use snapshot_types::CellPosition as SnapCellPosition;
            for (sheet_id, old_pos) in vacated_positions {
                if occupied_position_set.contains(&(sheet_id, old_pos.row(), old_pos.col())) {
                    continue;
                }
                recalc.changed_cells.push(SnapCellChange {
                    cell_id: String::new(),
                    sheet_id: sheet_id.to_uuid_string(),
                    position: Some(SnapCellPosition {
                        row: old_pos.row(),
                        col: old_pos.col(),
                    }),
                    value: value_types::CellValue::Null,
                    display_text: None,
                    old_display_text: None,
                    old_formula: None,
                    new_formula: None,
                    number_format: None,
                    format_idx: None,
                    extra_flags: 0,
                    old_value: None,
                });
            }
        }

        if !occupied_positions.is_empty() {
            use snapshot_types::CellChange as SnapCellChange;
            use snapshot_types::CellPosition as SnapCellPosition;

            let mut emitted_positions: std::collections::HashSet<(SheetId, u32, u32)> = recalc
                .changed_cells
                .iter()
                .filter_map(|change| {
                    let pos = change.position.as_ref()?;
                    let sheet_id = SheetId::from_uuid_str(&change.sheet_id).ok()?;
                    Some((sheet_id, pos.row, pos.col))
                })
                .collect();

            for (sheet_id, cell_id, new_pos) in occupied_positions {
                if !emitted_positions.insert((sheet_id, new_pos.row(), new_pos.col())) {
                    continue;
                }
                let value = self
                    .mirror
                    .get_cell_value_at(&sheet_id, new_pos)
                    .cloned()
                    .unwrap_or(value_types::CellValue::Null);
                recalc.changed_cells.push(SnapCellChange {
                    cell_id: cell_id.to_uuid_string(),
                    sheet_id: sheet_id.to_uuid_string(),
                    position: Some(SnapCellPosition {
                        row: new_pos.row(),
                        col: new_pos.col(),
                    }),
                    value,
                    display_text: None,
                    old_display_text: None,
                    old_formula: None,
                    new_formula: None,
                    number_format: None,
                    format_idx: None,
                    extra_flags: 0,
                    old_value: None,
                });
            }
        }

        axis_capacity::apply_tail_removals(&mut self.stores, &doc_changes, &capacity_axis_sheets);
        if !capacity_axis_sheets.is_empty() {
            doc_changes
                .axis_order
                .retain(|change| !capacity_axis_sheets.contains(&change.sheet_id));
            doc_changes
                .structural_changes
                .retain(|sheet_id| !capacity_axis_sheets.contains(sheet_id));
        }

        // Update layout indexes for dimension changes.
        services::mutation::apply_dimension_changes_to_layout(
            &mut self.stores,
            &mut self.mirror,
            &doc_changes,
        );

        // Rebuild merge indexes for merge changes, and sync into CellMirror.
        services::mutation::apply_merge_changes_to_index(
            &mut self.stores,
            &mut self.mirror,
            &doc_changes,
        );

        // Sync tables from yrs if tables changed.
        if !doc_changes.tables.is_empty() {
            self.hydrate_table_change_metadata_from_mirror(&mut doc_changes);
            self.sync_tables_from_yrs();
        }

        // Sync named ranges from yrs if named ranges changed.
        if !doc_changes.named_ranges.is_empty() {
            self.sync_named_ranges_from_yrs();
        }

        Ok((recalc, doc_changes))
    }

    /// Rebuild in-memory indexes and ComputeCore after a structural change
    /// detected via the observer (undo/redo/sync of insert/delete rows/cols).
    ///
    /// The yrs CRDT is the source of truth. Structural operations only modify
    /// `meta.rows`/`meta.cols` in yrs — the yrs grid index (`idToPos`) is
    /// never touched by structural ops, so after undo it naturally contains
    /// the correct pre-structural positions.
    ///
    /// Rebuilds: GridIndex, CellMirror, LayoutIndex, merge indexes for
    /// affected sheets, then ComputeCore for the entire workbook (since
    /// formulas can cross-reference sheets).
    fn rebuild_after_structural_observer_change(
        &mut self,
        structural_sheets: &[SheetId],
        doc_changes: &DocumentChanges,
    ) -> Result<RecalcResult, ComputeError> {
        // 1. Rebuild GridIndex + CellMirror + LayoutIndex for affected sheets
        //    by reading directly from yrs.
        //
        //    Collect (sheet_id, formula_a1, cell_id) for cells that have a legacy
        //    formula (KEY_FORMULA in yrs) but no IdentityFormula (KEY_FORMULA_TEMPLATE).
        //    These arise when formulas are set via the API (set_cell_value), which
        //    only writes KEY_FORMULA. The IdentityFormula was built in-memory by
        //    parse_and_register_formula but never persisted to yrs, so rebuilding
        //    the mirror from yrs loses it. We re-parse these below so that
        //    regenerate_formula_strings (inside structure_change) can produce the
        //    correct A1 display strings.
        let mut formulas_needing_identity: Vec<(SheetId, CellId, String)> = Vec::new();
        let mut rebuilt_runtimes = Vec::new();

        for sheet_id in structural_sheets {
            if let Some(runtime) = construction::rebuild_sheet_runtime_from_yrs(
                &self.stores.storage,
                *sheet_id,
                self.stores.grid_id_alloc.clone(),
            )? {
                // Collect cells with legacy formula but no IdentityFormula.
                for cell_data in &runtime.sheet_snapshot.cells {
                    if cell_data.identity_formula.is_none()
                        && let Some(ref formula) = cell_data.formula
                        && let Ok(cell_id) = CellId::from_uuid_str(&cell_data.cell_id)
                    {
                        formulas_needing_identity.push((*sheet_id, cell_id, formula.clone()));
                    }
                }
                rebuilt_runtimes.push(runtime);
            }
        }
        construction::finalize_rebuilt_sheet_runtimes(
            &mut self.stores,
            &mut self.mirror,
            rebuilt_runtimes,
        )?;

        // 1b. Re-parse legacy formulas into IdentityFormulas so that
        //     regenerate_formula_strings (inside structure_change) works.
        for (sheet_id, cell_id, formula_a1) in &formulas_needing_identity {
            if let Ok(idf) =
                self.stores
                    .compute
                    .to_identity_formula(&mut self.mirror, sheet_id, formula_a1)
            {
                self.mirror.set_formula(cell_id, Some(idf));
            }
        }

        // 2. Process cell changes for NON-structural sheets via the normal path.
        let non_structural_cells: Vec<_> = doc_changes
            .cells
            .iter()
            .filter(|c| !structural_sheets.contains(&c.sheet_id))
            .cloned()
            .collect();
        let cell_recalc = if !non_structural_cells.is_empty() {
            services::mutation::apply_cell_changes(
                &mut self.stores,
                &mut self.mirror,
                &non_structural_cells,
            )?
        } else {
            RecalcResult::empty()
        };

        // 3. Clear the ProjectionRegistry before structure_change. The spatial index
        //    stores (origin_row, origin_col) tuples that are now stale after row/col
        //    shifts. full_recalc (inside structure_change) will re-evaluate all
        //    dynamic array formulas and re-register projections at correct positions.
        self.mirror.projection_registry.clear();

        // 4. Update ComputeCore's range extents and formula strings for the structural
        //    change. The CellId-keyed graph edges and ASTs are stable — only position-
        //    derived data (RangePos extents, A1 display strings) needs updating.
        //    The mirror and GridIndex were already rebuilt from yrs in step 1.
        let mut recalc = self
            .stores
            .compute
            .structure_change(&mut self.mirror, None)?;
        self.init_cf_caches();

        // Sync merge regions into the mirror for structural sheets.
        // The mirror was rebuilt from yrs (step 1), which does not carry merge
        // regions in the snapshot. Re-reading from yrs keeps the mirror's
        // merge_regions in sync so ProjectionRegistry::check_conflict works.
        for sheet_id in structural_sheets {
            services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        }

        // 5. Produce structural viewport patches for ALL viewport positions
        //    in affected sheets. Observer replay currently reports only the
        //    touched sheet id, not the axis/index/count needed to populate
        //    MutationResult.structure_changes. Undo/redo/sync therefore still
        //    need explicit patches for shifted-but-unchanged cells.
        for sheet_id in structural_sheets {
            let structural_patches = self.produce_structural_patches(sheet_id);
            services::structural::merge_viewport_patches_into_recalc(
                &mut recalc,
                structural_patches,
            );
        }

        // 6. Merge recalc results (non-structural cells + structural rebuild)
        recalc.changed_cells.extend(cell_recalc.changed_cells);
        recalc
            .projection_changes
            .extend(cell_recalc.projection_changes);
        recalc.errors.extend(cell_recalc.errors);

        Ok(recalc)
    }

    fn build_mutation_result_from_changes(
        &self,
        recalc: RecalcResult,
        changes: &DocumentChanges,
    ) -> MutationResult {
        services::mutation_handlers::build_mutation_result_from_changes(
            &self.stores,
            &self.mirror,
            &self.settings,
            recalc,
            changes,
            &|sheet_id, row, col| {
                services::resolve_structured_format_at_cell(&self.mirror, sheet_id, row, col)
            },
        )
    }

    /// Unified observer pipeline: drain changes, build viewport patches, build MutationResult.
    pub(super) fn apply_observer_changes_with_patches(
        &mut self,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (mut recalc, doc_changes) = self.apply_all_observer_changes()?;

        // Build format viewport patches from property changes
        let format_patches = if !doc_changes.properties.is_empty() {
            self.produce_observer_format_patches(&doc_changes)
        } else {
            vec![]
        };

        // Build value viewport patches from recalc
        self.prepare_recalc_for_flush(&mut recalc);
        let value_patches = self.flush_viewport_patches();

        // CF rule observer changes are sheet-wide visual mutations. Undo/redo
        // reaches this observer path rather than the direct CF CRUD methods,
        // so rebuild the affected sheet viewports here as the forward path does.
        let cf_patch_sets = if doc_changes.conditional_formats.is_empty() {
            vec![]
        } else {
            let mut sheets = std::collections::HashSet::new();
            for change in &doc_changes.conditional_formats {
                sheets.insert(change.sheet_id);
            }

            let mut patch_sets = Vec::with_capacity(sheets.len());
            for sheet_id in sheets {
                self.refresh_cf_cache(&sheet_id);
                patch_sets.push(self.produce_cf_viewport_patches(&sheet_id));
            }
            patch_sets
        };

        let mut full_viewport_sheets = std::collections::HashSet::new();
        full_viewport_sheets.extend(doc_changes.sparklines.iter().map(|change| change.sheet_id));
        let mut row_col_format_sheets =
            std::collections::HashMap::<SheetId, (Vec<u32>, Vec<u32>)>::new();
        for change in &doc_changes.row_formats {
            if let Some(row) = change.key.as_deref().and_then(|key| {
                services::mutation::resolve_hex_id_to_position(
                    &self.stores,
                    &change.sheet_id,
                    key,
                    true,
                )
            }) {
                row_col_format_sheets
                    .entry(change.sheet_id)
                    .or_default()
                    .0
                    .push(row);
            } else {
                full_viewport_sheets.insert(change.sheet_id);
            }
        }
        for change in &doc_changes.col_formats {
            if let Some(col) = change.key.as_deref().and_then(|key| {
                services::mutation::resolve_hex_id_to_position(
                    &self.stores,
                    &change.sheet_id,
                    key,
                    false,
                )
            }) {
                row_col_format_sheets
                    .entry(change.sheet_id)
                    .or_default()
                    .1
                    .push(col);
            } else {
                full_viewport_sheets.insert(change.sheet_id);
            }
        }
        let row_col_format_patch_sets = row_col_format_sheets
            .into_iter()
            .map(|(sheet_id, (rows, cols))| {
                self.produce_row_col_format_viewport_patches(&sheet_id, &rows, &cols)
            })
            .collect::<Vec<_>>();
        let full_viewport_patch_sets = full_viewport_sheets
            .into_iter()
            .map(|sheet_id| self.produce_full_viewport_patches(&sheet_id))
            .collect::<Vec<_>>();

        // Merge value + format + sheet-wide visual patches into a single binary payload.
        let mut combined_patches = viewport::service::ViewportService::merge_patch_binaries(
            &value_patches,
            &format_patches,
        );
        for patches in cf_patch_sets
            .into_iter()
            .chain(row_col_format_patch_sets)
            .chain(full_viewport_patch_sets)
        {
            combined_patches = viewport::service::ViewportService::merge_patch_binaries(
                &combined_patches,
                &patches,
            );
        }

        // Build complete MutationResult from recalc + document changes
        let result = self.build_mutation_result_from_changes(recalc, &doc_changes);

        Ok((combined_patches, result))
    }
}

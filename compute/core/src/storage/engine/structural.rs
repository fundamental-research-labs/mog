//! Structural operations (structure changes, dimensions, merges) for YrsComputeEngine.

use super::YrsComputeEngine;
use super::mutation::{CellInput, EngineMutation, MutationOutput};
use super::services;
use super::validation;
use crate::snapshot::{FloatingObjectChange, MutationResult, RecalcResult};
use crate::storage::cells::values::{remove_cell_position_from_yrs, write_cell_position_to_yrs};
use bridge_core as bridge;
use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_STRUCTURAL;
use compute_wire::mutation::serialize_multi_viewport_patches;
use formula_types::StructureChange;
use value_types::{CellValue, ComputeError};
use yrs::{Origin, Transact};

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "structural",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Structural changes
    // -------------------------------------------------------------------

    /// Insert/delete rows/cols with full three-phase update.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn structure_change(
        &mut self,
        sheet_id: &SheetId,
        change: &StructureChange,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Pass 1: Suppress observer, apply structural ops + merge rebuild + formula recalc.
        //
        // Wrap the entire operation in an undo group so the separate Yrs
        // transactions emitted by `apply_structure_change` (StructuralOps
        // rowOrder/colOrder edit, metadata_shift writes, and
        // invalidate_stale_yrs_formulas formula-body refresh) collapse into a
        // single undoable step. Without the group, each inner transaction is
        // its own undo entry and a single `undo()` would only peel the last
        // one — leaving positions shifted while the formula string reverted,
        // or vice versa (FT-007 `undo-structural-formula-revert`).
        self.mutation.undo_manager.begin_undo_group();
        let _guard = self.mutation.suppress_guard();
        let apply_result = services::structural::apply_structure_change(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            change,
        );
        drop(_guard);
        self.mutation.undo_manager.end_undo_group();
        let recalc = apply_result?;

        // R2.3 — structural layout mutated; stale column-indexed matrices
        // must miss on next evaluate. Column deletes in particular can't
        // leave a stale override pinned to a position that belongs to a
        // different column now.
        self.security.bump_structure_version();

        self.finish_structure_change(sheet_id, recalc, Some(change))
    }

    /// Move cell values from a source range to a target position (value-only move).
    /// Copies computed values to the target, clears the source. Does NOT move formulas
    /// or update formula refs.
    #[bridge::write(scope = "sheet")]
    #[allow(clippy::too_many_arguments)]
    pub fn relocate_cells(
        &mut self,
        sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_row: u32,
        target_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Range guard: reject if the sheet is Range-backed. Relocating cells
        // on a Range-backed sheet would mint random CellIds via ensure_cell_id,
        // corrupting the virtual CellId scheme.
        if self
            .mirror
            .get_sheet(sheet_id)
            .is_some_and(|s| !s.range_views_is_empty())
        {
            return Err(ComputeError::RangeGuardViolation {
                sheet_id: sheet_id.to_uuid_string(),
                operation: "relocate_cells".to_string(),
            });
        }

        // 1. Collect source cell values as typed CellValues. Errors and arrays
        //    survive verbatim — `collect_relocate_values` used to render via
        //    `cell_value_to_input_string` and lose them; now it keeps them typed
        //    and we hand them off to `import_values` (lossless entry point).
        let cells_to_move = services::structural::collect_relocate_values(
            &self.mirror,
            sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
        );

        // 2. Clear source cells.
        let mut last_result = (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::from_recalc(RecalcResult::empty()),
        );
        for row in src_start_row..=src_end_row {
            for col in src_start_col..=src_end_col {
                let grid = self.stores.grid_indexes.get_mut(sheet_id).ok_or_else(|| {
                    ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    }
                })?;
                let cell_id = grid.ensure_cell_id(row, col);
                last_result = self.set_cell(
                    sheet_id,
                    cell_id,
                    row,
                    col,
                    super::mutation::CellInput::Clear,
                )?;
            }
        }

        // 3. Write typed values to target positions via the lossless import path.
        //    Skip Null entries — those came from empty source cells.
        let updates: Vec<(u32, u32, CellValue, Option<String>)> = cells_to_move
            .into_iter()
            .filter(|(_, _, v)| !matches!(v, CellValue::Null))
            .map(|(dr, dc, value)| (target_row + dr, target_col + dc, value, None))
            .collect();

        if !updates.is_empty() {
            last_result = self.import_values(sheet_id, updates)?;
        }

        Ok(last_result)
    }

    /// Insert cells with shift (right or down) in a sub-range.
    /// Extends the StructuralOps pattern for partial-range shifts.
    #[bridge::structural(scope = "sheet")]
    pub fn insert_cells_with_shift(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if row_count == 0 || col_count == 0 {
            return Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        self.ensure_partial_cell_shift_supported(sheet_id, "insert_cells_with_shift")?;
        let updates = self.collect_insert_cell_shift_updates(
            sheet_id,
            row,
            col,
            row_count,
            col_count,
            shift_right,
        )?;
        self.apply_partial_insert_shift(sheet_id, updates)
    }

    /// Delete cells with shift (left or up) in a sub-range.
    #[bridge::structural(scope = "sheet")]
    pub fn delete_cells_with_shift(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_left: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if row_count == 0 || col_count == 0 {
            return Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        self.ensure_partial_cell_shift_supported(sheet_id, "delete_cells_with_shift")?;
        let (deleted_cell_ids, updates) = self
            .collect_delete_cell_shift_plan(sheet_id, row, col, row_count, col_count, shift_left)?;
        self.apply_partial_delete_shift(sheet_id, deleted_cell_ids, updates)
    }

    // -------------------------------------------------------------------
    // Dimension operations
    // -------------------------------------------------------------------

    /// Set row height (in pixels from UI).
    #[bridge::write(scope = "sheet")]
    pub fn set_row_height(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        height_px: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Validate in canonical units (points)
        let height_px = domain_types::units::Pixels(height_px);
        let height_pt = domain_types::units::pixels_to_points(height_px);
        validation::structure::validate_row_height(height_pt)?;
        services::structural::set_row_height(&mut self.stores, sheet_id, row, height_px)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Set column width (in pixels from UI).
    #[bridge::write(scope = "sheet")]
    pub fn set_col_width(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        width_px: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Validate in canonical units (char-width)
        let width_px = domain_types::units::Pixels(width_px);
        let mdw = domain_types::units::platform_mdw();
        let width_cw = domain_types::units::pixels_to_char_width(width_px, mdw);
        validation::structure::validate_col_width(width_cw)?;
        services::structural::set_col_width(&mut self.stores, sheet_id, col, width_px)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Set multiple column widths (in pixels from UI).
    #[bridge::write(scope = "sheet")]
    pub fn set_col_widths(
        &mut self,
        sheet_id: &SheetId,
        widths: &[(u32, f64)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mdw = domain_types::units::platform_mdw();
        let widths_px: Vec<(u32, domain_types::units::Pixels)> = widths
            .iter()
            .map(|(col, width)| (*col, domain_types::units::Pixels(*width)))
            .collect();
        for (_, width_px) in &widths_px {
            let width_cw = domain_types::units::pixels_to_char_width(*width_px, mdw);
            validation::structure::validate_col_width(width_cw)?;
        }
        services::structural::set_col_widths(&mut self.stores, sheet_id, &widths_px)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Set column width in character-width units (OOXML-native).
    #[bridge::write(scope = "sheet")]
    pub fn set_col_width_chars(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        width_chars: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let width_cw = domain_types::units::CharWidth(width_chars);
        validation::structure::validate_col_width(width_cw)?;
        services::structural::set_col_width_chars(&mut self.stores, sheet_id, col, width_cw)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Set multiple column widths in character-width units (OOXML-native).
    #[bridge::write(scope = "sheet")]
    pub fn set_col_widths_chars(
        &mut self,
        sheet_id: &SheetId,
        widths: &[(u32, f64)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let widths_cw: Vec<(u32, domain_types::units::CharWidth)> = widths
            .iter()
            .map(|(col, width)| (*col, domain_types::units::CharWidth(*width)))
            .collect();
        for (_, width_cw) in &widths_cw {
            validation::structure::validate_col_width(*width_cw)?;
        }
        services::structural::set_col_widths_chars(&mut self.stores, sheet_id, &widths_cw)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Hide rows.
    #[bridge::write(scope = "sheet")]
    pub fn hide_rows(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::hide_rows(&mut self.stores, sheet_id, rows)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Unhide rows.
    #[bridge::write(scope = "sheet")]
    pub fn unhide_rows(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::unhide_rows(&mut self.stores, sheet_id, rows)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Hide columns.
    #[bridge::write(scope = "sheet")]
    pub fn hide_columns(
        &mut self,
        sheet_id: &SheetId,
        cols: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::hide_columns(&mut self.stores, sheet_id, cols)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Unhide columns.
    #[bridge::write(scope = "sheet")]
    pub fn unhide_columns(
        &mut self,
        sheet_id: &SheetId,
        cols: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::unhide_columns(&mut self.stores, sheet_id, cols)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    // -------------------------------------------------------------------
    // Merge operations
    // -------------------------------------------------------------------

    fn merge_recalc_into(dst: &mut RecalcResult, src: RecalcResult) {
        dst.changed_cells.extend(src.changed_cells);
        dst.projection_changes.extend(src.projection_changes);
        dst.errors.extend(src.errors);
        dst.validation_annotations
            .extend(src.validation_annotations);
        dst.old_values.extend(src.old_values);
    }

    fn clear_merge_child_values(
        &mut self,
        sheet_id: &SheetId,
        merge_ranges: &[(u32, u32, u32, u32)],
    ) -> Result<RecalcResult, ComputeError> {
        let mut edits = Vec::new();
        let mut old_values = std::collections::HashMap::new();
        let mut seen = std::collections::HashSet::new();

        {
            let Some(grid) = self.stores.grid_indexes.get(sheet_id) else {
                return Ok(RecalcResult::empty());
            };

            for &(start_row, start_col, end_row, end_col) in merge_ranges {
                for row in start_row..=end_row {
                    for col in start_col..=end_col {
                        if row == start_row && col == start_col {
                            continue;
                        }
                        let Some(cell_id) = grid.cell_id_at(row, col) else {
                            continue;
                        };
                        if !seen.insert(cell_id) {
                            continue;
                        }

                        let old_value = self
                            .mirror
                            .get_cell_value(&cell_id)
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        let has_formula = self.mirror.get_formula(&cell_id).is_some();
                        if matches!(old_value, CellValue::Null) && !has_formula {
                            continue;
                        }

                        old_values.insert(cell_id, old_value);
                        edits.push((*sheet_id, cell_id, row, col, CellInput::Clear));
                    }
                }
            }
        }

        if edits.is_empty() {
            return Ok(RecalcResult::empty());
        }

        let mut result = self
            .stores
            .compute
            .set_cells(&mut self.mirror, &edits, true)?;
        for change in &mut result.changed_cells {
            if change.old_value.is_none()
                && let Ok(cell_id) = CellId::from_uuid_str(&change.cell_id)
                && let Some(old_value) = old_values.remove(&cell_id)
            {
                change.old_value = Some(old_value);
            }
        }
        Ok(result)
    }

    fn merge_ranges_from_changes(result: &MutationResult) -> Vec<(u32, u32, u32, u32)> {
        result
            .merge_changes
            .iter()
            .filter(|change| matches!(change.kind, crate::snapshot::ChangeKind::Set))
            .map(|change| {
                (
                    change.start_row,
                    change.start_col,
                    change.end_row,
                    change.end_col,
                )
            })
            .collect()
    }

    /// Merge a range of cells.
    #[bridge::write(scope = "range")]
    pub fn merge_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        let operation = (|| -> Result<(Vec<u8>, MutationResult), ComputeError> {
            let mut result = {
                let _guard = self.mutation.suppress_guard();
                services::structural::merge_range(
                    &mut self.stores,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?
            };
            let merge_ranges = Self::merge_ranges_from_changes(&result);
            let mut recalc = self.clear_merge_child_values(sheet_id, &merge_ranges)?;
            let patches = if recalc.changed_cells.is_empty()
                && recalc.projection_changes.is_empty()
                && recalc.errors.is_empty()
            {
                serialize_multi_viewport_patches(&[])
            } else {
                self.prepare_recalc_for_flush(&mut recalc);
                Self::merge_recalc_into(&mut result.recalc, recalc);
                self.flush_viewport_patches()
            };
            Ok((patches, result))
        })();
        self.mutation.undo_manager.end_undo_group();
        let (patches, result) = operation?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        Ok((patches, result))
    }

    /// Unmerge a range.
    #[bridge::write(scope = "range")]
    pub fn unmerge_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut result = services::structural::unmerge_range(
            &mut self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        // Re-evaluate spill formulas that were blocked by the now-removed merge region.
        let unblocked = self.stores.compute.drain_spill_blockers_for_region(
            &self.mirror,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        );
        if !unblocked.is_empty() {
            let extra = self.stores.compute.recalc(&mut self.mirror, &unblocked)?;
            result.recalc.changed_cells.extend(extra.changed_cells);
            result
                .recalc
                .projection_changes
                .extend(extra.projection_changes);
            self.prepare_recalc_for_flush(&mut result.recalc);
            return Ok((self.flush_viewport_patches(), result));
        }
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Merge across: creates one merge per row in the range.
    #[bridge::write(scope = "range")]
    pub fn merge_across(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        let operation = (|| -> Result<(Vec<u8>, MutationResult), ComputeError> {
            let mut result = {
                let _guard = self.mutation.suppress_guard();
                services::structural::merge_across(
                    &mut self.stores,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?
            };
            let merge_ranges = Self::merge_ranges_from_changes(&result);
            let mut recalc = self.clear_merge_child_values(sheet_id, &merge_ranges)?;
            let patches = if recalc.changed_cells.is_empty()
                && recalc.projection_changes.is_empty()
                && recalc.errors.is_empty()
            {
                serialize_multi_viewport_patches(&[])
            } else {
                self.prepare_recalc_for_flush(&mut recalc);
                Self::merge_recalc_into(&mut result.recalc, recalc);
                self.flush_viewport_patches()
            };
            Ok((patches, result))
        })();
        self.mutation.undo_manager.end_undo_group();
        let (patches, result) = operation?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        Ok((patches, result))
    }

    /// Merge and center: unmerge overlapping, then create a single merge.
    #[bridge::write(scope = "range")]
    pub fn merge_and_center(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        let operation = (|| -> Result<MutationResult, ComputeError> {
            let mut result = {
                let _guard = self.mutation.suppress_guard();
                services::structural::merge_and_center(
                    &mut self.stores,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?
            };
            let merge_ranges = Self::merge_ranges_from_changes(&result);
            let mut recalc = self.clear_merge_child_values(sheet_id, &merge_ranges)?;
            if !recalc.changed_cells.is_empty()
                || !recalc.projection_changes.is_empty()
                || !recalc.errors.is_empty()
            {
                self.prepare_recalc_for_flush(&mut recalc);
                Self::merge_recalc_into(&mut result.recalc, recalc);
            }
            Ok(result)
        })();
        self.mutation.undo_manager.end_undo_group();
        let mut result = operation?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        // Drain spill blockers for the target region — merge_and_center first
        // unmerges any existing overlap before (re-)merging, so previously-blocked
        // spills may now be free.
        let unblocked = self.stores.compute.drain_spill_blockers_for_region(
            &self.mirror,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        );
        if !unblocked.is_empty() {
            let extra = self.stores.compute.recalc(&mut self.mirror, &unblocked)?;
            result.recalc.changed_cells.extend(extra.changed_cells);
            result
                .recalc
                .projection_changes
                .extend(extra.projection_changes);
            self.prepare_recalc_for_flush(&mut result.recalc);
            return Ok((self.flush_viewport_patches(), result));
        }
        if result.recalc.changed_cells.is_empty()
            && result.recalc.projection_changes.is_empty()
            && result.recalc.errors.is_empty()
        {
            Ok((serialize_multi_viewport_patches(&[]), result))
        } else {
            Ok((self.flush_viewport_patches(), result))
        }
    }

    /// Check whether merging a range would cause data loss.
    #[bridge::read(scope = "range")]
    pub fn check_merge_data_loss(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> (bool, u32) {
        services::structural::check_merge_data_loss(
            &self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
    }

    /// Check if the cell at (row, col) is the origin of a merge.
    #[bridge::read(scope = "cell")]
    pub fn is_merge_origin(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        services::structural::is_merge_origin(&self.stores, sheet_id, row, col)
    }

    /// Clear all merged regions for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_merges(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut result = services::structural::clear_all_merges(&mut self.stores, sheet_id)?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        // All merges removed — drain all sheet-level spill blockers and recalc.
        let unblocked = self
            .stores
            .compute
            .drain_spill_blockers_for_sheet(&self.mirror, sheet_id);
        if !unblocked.is_empty() {
            let extra = self.stores.compute.recalc(&mut self.mirror, &unblocked)?;
            result.recalc.changed_cells.extend(extra.changed_cells);
            result
                .recalc
                .projection_changes
                .extend(extra.projection_changes);
            self.prepare_recalc_for_flush(&mut result.recalc);
            return Ok((self.flush_viewport_patches(), result));
        }
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Validate merges and remove any whose CellIds can no longer be resolved.
    /// Returns a `MutationResult` with the removed count in `data`.
    #[bridge::write(scope = "sheet")]
    pub fn validate_and_clean_merges(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::structural::validate_and_clean_merges(&mut self.stores, sheet_id)?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // -------------------------------------------------------------------
    // Cell identity and position mutations
    // -------------------------------------------------------------------

    /// Get or create a CellId at a position in the Yrs document.
    ///
    /// If a cell already exists at (row, col), returns its CellId. Otherwise,
    /// creates a new marker cell (null value) with a fresh UUID and returns it.
    /// This writes to the Yrs CRDT document, establishing a stable identity
    /// for the position.
    ///
    /// The CellId hex string is returned in `data`.
    #[bridge::write(scope = "cell")]
    pub fn get_or_create_cell_id(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::get_or_create_cell_id(&mut self.stores, sheet_id, row, col)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Update a cell's position in the Yrs document grid index.
    ///
    /// Moves the cell from its current position to (new_row, new_col) in the
    /// Yrs CRDT's posToId/idToPos maps. Also updates the in-memory GridIndex.
    /// The caller is responsible for ensuring the target position is available.
    #[bridge::write(scope = "sheet")]
    pub fn update_cell_position(
        &mut self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
        new_row: u32,
        new_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::update_cell_position(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            cell_id_hex,
            new_row,
            new_col,
        )
        .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    /// Relocate cells from a source range to a target position with CellId preservation.
    ///
    /// This is the architecturally correct implementation for cut-paste and
    /// drag-move operations. Unlike `relocate_cells` in the core engine methods
    /// (which does value-level copy), this preserves CellIds so that formulas
    /// referencing moved cells continue to resolve correctly.
    ///
    /// Handles same-sheet and cross-sheet moves, overlapping ranges, and
    /// clears target cells that are not part of the move.
    ///
    /// Routes through `apply_mutation()` for proper recalc + viewport patches.
    /// Returns a `MutationResult` with `RelocateResult` in `data`.
    ///
    /// Viewport patches (filter viewport R5.3): the relocation pipeline emits
    /// (a) clear-patches for source cells (via `clear_cells` inside
    /// `mutation_relocate_cells`), and (b) write-patches for every target
    /// position (via `set_cells_raw`). Previously this method returned
    /// empty patches because patches were stashed in
    /// `pending_recalc` but never flushed — same-sheet cut-paste in the
    /// kernel had to fall back to `executePaste` (creates new CellIds)
    /// or call `forceRefreshAllViewports` cross-sheet to mask the gap.
    /// Whenever the source and target sheets differ we additionally
    /// rebuild full viewport binaries on both sheets so the cross-sheet
    /// path no longer needs the kernel-side force-refresh.
    #[bridge::write(scope = "sheet")]
    #[allow(clippy::too_many_arguments)]
    pub fn relocate_cells_yrs(
        &mut self,
        source_sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_sheet_id: &SheetId,
        target_row: u32,
        target_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::RelocateCells {
            source_sheet_id: *source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id: *target_sheet_id,
            target_row,
            target_col,
        })? {
            MutationOutput::Recalc(result) => {
                // Flush incremental recalc patches (clears for source +
                // writes for targets, both produced by
                // `mutation_relocate_cells`).
                let mut patches = self.flush_viewport_patches();
                // Cross-sheet: incremental patches only cover the sheet
                // the recalc touched. Rebuild the *other* sheet's
                // viewport binary so vacated source cells (cross-sheet
                // case) and freshly-written target cells (each from
                // their own sheet's perspective) are both up-to-date.
                if source_sheet_id != target_sheet_id {
                    let source_full = self.produce_full_viewport_patches(source_sheet_id);
                    let target_full = self.produce_full_viewport_patches(target_sheet_id);
                    patches = compute_wire::mutation::concat_multi_viewport_patches(&[
                        patches,
                        source_full,
                        target_full,
                    ]);
                }
                Ok((patches, result))
            }
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }
}

// =============================================================================
// Private helpers (outside #[bridge::api] block)
// =============================================================================

impl YrsComputeEngine {
    fn ensure_partial_cell_shift_supported(
        &self,
        sheet_id: &SheetId,
        operation: &str,
    ) -> Result<(), ComputeError> {
        if self
            .mirror
            .get_sheet(sheet_id)
            .is_some_and(|s| !s.range_views_is_empty())
        {
            return Err(ComputeError::RangeGuardViolation {
                sheet_id: sheet_id.to_uuid_string(),
                operation: operation.to_string(),
            });
        }
        Ok(())
    }

    fn collect_insert_cell_shift_updates(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<Vec<(CellId, u32, u32)>, ComputeError> {
        let grid =
            self.stores
                .grid_indexes
                .get(sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;

        let mut updates = Vec::new();
        if shift_right {
            let row_end = row.saturating_add(row_count).min(grid.row_count());
            let col_limit = grid.col_count();
            if col >= col_limit {
                return Ok(updates);
            }
            for r in row..row_end {
                for c in (col..col_limit).rev() {
                    if let Some(cell_id) = grid.cell_id_at(r, c) {
                        updates.push((cell_id, r, c.saturating_add(col_count)));
                    }
                }
            }
        } else {
            let col_end = col.saturating_add(col_count).min(grid.col_count());
            let row_limit = grid.row_count();
            if row >= row_limit {
                return Ok(updates);
            }
            for c in col..col_end {
                for r in (row..row_limit).rev() {
                    if let Some(cell_id) = grid.cell_id_at(r, c) {
                        updates.push((cell_id, r.saturating_add(row_count), c));
                    }
                }
            }
        }
        Ok(updates)
    }

    fn collect_delete_cell_shift_plan(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_left: bool,
    ) -> Result<(Vec<CellId>, Vec<(CellId, u32, u32)>), ComputeError> {
        let grid =
            self.stores
                .grid_indexes
                .get(sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;

        let mut deleted_cell_ids = Vec::new();
        let mut updates = Vec::new();

        if shift_left {
            let row_end = row.saturating_add(row_count).min(grid.row_count());
            let delete_end = col.saturating_add(col_count).min(grid.col_count());
            let col_limit = grid.col_count();
            if col >= col_limit {
                return Ok((deleted_cell_ids, updates));
            }
            for r in row..row_end {
                for c in col..delete_end {
                    if let Some(cell_id) = grid.cell_id_at(r, c) {
                        deleted_cell_ids.push(cell_id);
                    }
                }
                for c in delete_end..col_limit {
                    if let Some(cell_id) = grid.cell_id_at(r, c) {
                        updates.push((cell_id, r, c.saturating_sub(col_count)));
                    }
                }
            }
        } else {
            let col_end = col.saturating_add(col_count).min(grid.col_count());
            let delete_end = row.saturating_add(row_count).min(grid.row_count());
            let row_limit = grid.row_count();
            if row >= row_limit {
                return Ok((deleted_cell_ids, updates));
            }
            for c in col..col_end {
                for r in row..delete_end {
                    if let Some(cell_id) = grid.cell_id_at(r, c) {
                        deleted_cell_ids.push(cell_id);
                    }
                }
                for r in delete_end..row_limit {
                    if let Some(cell_id) = grid.cell_id_at(r, c) {
                        updates.push((cell_id, r.saturating_sub(row_count), c));
                    }
                }
            }
        }

        Ok((deleted_cell_ids, updates))
    }

    fn apply_partial_insert_shift(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let recalc = self.apply_partial_cell_remap(sheet_id, updates)?;
        self.security.bump_structure_version();
        self.finish_structure_change(sheet_id, recalc, None)
    }

    fn apply_partial_delete_shift(
        &mut self,
        sheet_id: &SheetId,
        deleted_cell_ids: Vec<CellId>,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let recalc =
            self.apply_partial_cell_delete_and_remap(sheet_id, deleted_cell_ids, updates)?;
        self.security.bump_structure_version();
        self.finish_structure_change(sheet_id, recalc, None)
    }

    fn apply_partial_cell_remap(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<RecalcResult, ComputeError> {
        if updates.is_empty() {
            return Ok(RecalcResult::empty());
        }

        let change = StructureChange::RemapPositions { updates };
        self.mutation.undo_manager.begin_undo_group();
        let _guard = self.mutation.suppress_guard();
        let apply_result = services::structural::apply_structure_change(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            &change,
        );
        let persist_result = apply_result.and_then(|recalc| {
            Self::persist_remapped_cell_positions(
                &self.stores,
                sheet_id,
                match &change {
                    StructureChange::RemapPositions { updates } => updates,
                    _ => unreachable!(),
                },
            )?;
            Ok(recalc)
        });
        drop(_guard);
        self.mutation.undo_manager.end_undo_group();
        persist_result
    }

    fn apply_partial_cell_delete_and_remap(
        &mut self,
        sheet_id: &SheetId,
        deleted_cell_ids: Vec<CellId>,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<RecalcResult, ComputeError> {
        if deleted_cell_ids.is_empty() && updates.is_empty() {
            return Ok(RecalcResult::empty());
        }

        self.mutation.undo_manager.begin_undo_group();
        let _guard = self.mutation.suppress_guard();

        let clear_result = if deleted_cell_ids.is_empty() {
            Ok(())
        } else {
            Self::clear_cells_for_partial_structural_delete(
                &mut self.stores,
                &mut self.mirror,
                sheet_id,
                &deleted_cell_ids,
            )
        };

        let recalc_result = match clear_result {
            Err(err) => Err(err),
            Ok(()) if updates.is_empty() => {
                self.stores.compute.structure_change(&mut self.mirror, None)
            }
            Ok(()) => {
                let change = StructureChange::RemapPositions { updates };
                let recalc = services::structural::apply_structure_change(
                    &mut self.stores,
                    &mut self.mirror,
                    sheet_id,
                    &change,
                )?;
                Self::persist_remapped_cell_positions(
                    &self.stores,
                    sheet_id,
                    match &change {
                        StructureChange::RemapPositions { updates } => updates,
                        _ => unreachable!(),
                    },
                )?;
                Ok(recalc)
            }
        };

        drop(_guard);
        self.mutation.undo_manager.end_undo_group();
        recalc_result
    }

    fn clear_cells_for_partial_structural_delete(
        stores: &mut super::stores::EngineStores,
        mirror: &mut crate::mirror::CellMirror,
        sheet_id: &SheetId,
        cell_ids: &[CellId],
    ) -> Result<(), ComputeError> {
        stores.compute.clear_cells(mirror, cell_ids)?;
        for cell_id in cell_ids {
            stores.storage.remove_cell_with_origin(
                mirror,
                sheet_id,
                cell_id,
                Some(ORIGIN_STRUCTURAL),
            );
            let grid = stores.grid_indexes.get_mut(sheet_id).ok_or_else(|| {
                ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                }
            })?;
            grid.remove_cell(cell_id);
        }
        Ok(())
    }

    fn persist_remapped_cell_positions(
        stores: &super::stores::EngineStores,
        sheet_id: &SheetId,
        updates: &[(CellId, u32, u32)],
    ) -> Result<(), ComputeError> {
        if updates.is_empty() {
            return Ok(());
        }

        let grid =
            stores
                .grid_indexes
                .get(sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;
        let mut position_writes = Vec::with_capacity(updates.len());
        for (cell_id, row, col) in updates {
            let row_hex = grid
                .row_id_hex(*row)
                .ok_or_else(|| ComputeError::InvalidInput {
                    message: format!("missing row identity for remapped row {row}"),
                })?;
            let col_hex = grid
                .col_id_hex(*col)
                .ok_or_else(|| ComputeError::InvalidInput {
                    message: format!("missing column identity for remapped column {col}"),
                })?;
            position_writes.push((
                String::from(id_to_hex(cell_id.as_u128())),
                String::from(row_hex),
                String::from(col_hex),
            ));
        }

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let doc = stores.storage.doc();
        let sheets = stores.storage.sheets();
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
        for (cell_hex, _, _) in &position_writes {
            remove_cell_position_from_yrs(&mut txn, sheets, &sheet_hex, cell_hex);
        }
        for (cell_hex, row_hex, col_hex) in &position_writes {
            write_cell_position_to_yrs(&mut txn, sheets, &sheet_hex, cell_hex, row_hex, col_hex);
        }
        Ok(())
    }

    fn finish_structure_change(
        &mut self,
        sheet_id: &SheetId,
        mut recalc: RecalcResult,
        change: Option<&StructureChange>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Pass 2: Produce structural viewport patches and merge into recalc
        let structural_patches = self.produce_structural_patches(sheet_id);
        services::structural::merge_viewport_patches_into_recalc(&mut recalc, structural_patches);

        // Pass 3: Flush viewport patches, build result.
        //
        // CF re-eval through structural mutations (filter viewport finding 10):
        // an Insert/Delete rows/cols call `metadata_shift::shift_all_metadata_ranges`
        // to shift CF target ranges, but the incremental recalc patch path
        // emits CF colors only for cells in `recalc.changed_cells`. Cells
        // that *moved* into / out of a (now-shifted) CF range without their
        // value changing — the dominant case for an insert-row-then-evaluate
        // flow — would render with stale CF colors. Force the CF cache to
        // re-evaluate on the affected sheet, then rebuild full viewport
        // binaries (the CF path) instead of incremental patches whenever
        // the sheet carries any CF format.
        self.prepare_recalc_for_flush(&mut recalc);
        let cf_active = !services::formatting::get_all_cf_rules(&self.stores, sheet_id).is_empty();
        let patches = if cf_active {
            // Discard the pending incremental recalc — the full-viewport
            // rebuild below subsumes it. The metadata_shift step in
            // apply_structure_change already moved CF range geometry, and
            // refresh_cf_cache re-evaluates rules at the new positions.
            self.mutation.pending_recalc = None;
            self.refresh_cf_cache(sheet_id);
            self.produce_cf_viewport_patches(sheet_id)
        } else {
            self.flush_viewport_patches()
        };
        let mut result = MutationResult::from_recalc(recalc);
        result.floating_object_changes =
            services::structural::recompute_floating_object_bounds(&self.stores, sheet_id);
        if let Some(change) = change
            && let Some(sc) = services::structural::build_structure_change_result(sheet_id, change)
        {
            result.structure_changes = vec![sc];
        }
        Ok((patches, result))
    }

    /// Recompute pixel bounds for all cell-anchored floating objects on a sheet.
    ///
    /// Delegates to the structural service function.
    #[allow(dead_code)]
    pub(crate) fn recompute_floating_object_bounds(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<FloatingObjectChange> {
        services::structural::recompute_floating_object_bounds(&self.stores, sheet_id)
    }
}

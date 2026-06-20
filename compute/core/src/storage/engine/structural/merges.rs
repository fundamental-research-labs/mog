use super::super::YrsComputeEngine;
use super::super::mutation::CellInput;
use super::super::services;
use crate::snapshot::{MutationResult, RecalcResult};
use cell_types::{CellId, SheetId};
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::{CellValue, ComputeError};

impl YrsComputeEngine {
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
        let mut old_formulas = std::collections::HashMap::new();
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
                            .stores
                            .compute
                            .get_cell_value(&self.mirror, &cell_id)
                            .cloned()
                            .or_else(|| self.mirror.get_cell_value(&cell_id).cloned())
                            .unwrap_or(CellValue::Null);
                        let old_formula =
                            self.stores.compute.get_formula(&cell_id).map(str::to_owned);
                        let has_formula = old_formula.is_some();
                        if matches!(old_value, CellValue::Null) && !has_formula {
                            continue;
                        }

                        old_values.insert(cell_id, old_value);
                        if let Some(old_formula) = old_formula {
                            old_formulas.insert(cell_id, old_formula);
                        }
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
            if let Ok(cell_id) = CellId::from_uuid_str(&change.cell_id) {
                if let Some(old_value) = old_values.remove(&cell_id) {
                    change.old_value = Some(old_value);
                }
                if change.old_formula.is_none()
                    && let Some(old_formula) = old_formulas.remove(&cell_id)
                {
                    change.old_formula = Some(old_formula);
                }
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

    pub(super) fn apply_merge_range(
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

    pub(super) fn apply_unmerge_range(
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

    pub(super) fn apply_merge_across(
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

    pub(super) fn apply_merge_and_center(
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

    pub(super) fn apply_check_merge_data_loss(
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

    pub(super) fn apply_is_merge_origin(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        services::structural::is_merge_origin(&self.stores, sheet_id, row, col)
    }

    pub(super) fn apply_clear_all_merges(
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

    pub(super) fn apply_validate_and_clean_merges(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::structural::validate_and_clean_merges(&mut self.stores, sheet_id)?;
        services::mutation::sync_mirror_merge_regions(&self.stores, &mut self.mirror, sheet_id);
        Ok((serialize_multi_viewport_patches(&[]), result))
    }
}

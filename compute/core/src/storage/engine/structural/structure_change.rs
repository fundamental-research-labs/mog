use super::super::YrsComputeEngine;
use super::super::construction;
use super::super::services;
use crate::snapshot::{FloatingObjectChange, MutationResult, RecalcResult};
use cell_types::SheetId;
use formula_types::StructureChange;
use value_types::ComputeError;

impl YrsComputeEngine {
    pub(super) fn apply_structure_change_bridge(
        &mut self,
        sheet_id: &SheetId,
        change: &StructureChange,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.complete_deferred_hydration_for_structure_change()?;

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

    fn complete_deferred_hydration_for_structure_change(&mut self) -> Result<(), ComputeError> {
        let Some(mut completion) = construction::stage_deferred_hydration(self)? else {
            return Ok(());
        };

        if completion.calculation.full_calc_on_load || completion.calculation.force_full_calc {
            Self::materialize_all_pivots_for_import_open(
                &mut completion.stores,
                &mut completion.mirror,
            );
        }
        construction::commit_deferred_hydration(self, completion);
        Ok(())
    }

    pub(super) fn finish_structure_change(
        &mut self,
        sheet_id: &SheetId,
        mut recalc: RecalcResult,
        change: Option<&StructureChange>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Pass 2: Row/column changes are represented by `structure_changes`
        // below. The TS bridge invalidates structural prefetch before the
        // mutation and force-refreshes registered viewports after it returns,
        // so shifted-but-unchanged cells should not be expanded into a
        // viewport-sized synthetic patch payload.
        //
        // Partial cell shifts use the same remap machinery but do not emit a
        // StructureChangeResult, so they still need explicit patches for
        // shifted-but-unchanged cells.
        let needs_explicit_shift_patches =
            matches!(change, None | Some(StructureChange::RemapPositions { .. }));
        if needs_explicit_shift_patches {
            let structural_patches = self.produce_structural_patches(sheet_id);
            services::structural::merge_viewport_patches_into_recalc(
                &mut recalc,
                structural_patches,
            );
        }

        // Pass 3: Flush viewport patches, build result.
        //
        // CF re-eval through structural mutations (filter viewport finding 10):
        // row/column Insert/Delete shifts CF target ranges, while the
        // incremental recalc patch path only covers `recalc.changed_cells`.
        // Refresh the CF cache at the new positions and return a full viewport
        // rebuild when CF is active. Incremental recalc patches only cover
        // value changes, while structural shifts can move unchanged cells into
        // or out of a CF range.
        self.prepare_recalc_for_flush(&mut recalc);
        let cf_active = !services::formatting::get_all_cf_rules(&self.stores, sheet_id).is_empty();
        if cf_active {
            self.refresh_cf_cache(sheet_id);
        }
        let patches = if cf_active {
            // Discard the pending incremental recalc — the full-viewport
            // rebuild below subsumes it.
            self.mutation.pending_recalc = None;
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

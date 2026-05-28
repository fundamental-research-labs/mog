use super::super::YrsComputeEngine;
use super::super::services;
use crate::snapshot::{FloatingObjectChange, MutationResult, RecalcResult};
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use formula_types::StructureChange;
use value_types::ComputeError;

impl YrsComputeEngine {
    pub(super) fn apply_structure_change_bridge(
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

    pub(super) fn finish_structure_change(
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

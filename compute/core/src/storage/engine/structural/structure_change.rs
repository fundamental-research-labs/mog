use super::super::ComputeEngine;
use super::super::construction;
use super::super::services;
use crate::snapshot::{FloatingObjectChange, MutationResult, RecalcResult};
use cell_types::SheetId;
use formula_types::StructureChange;
use value_types::ComputeError;

impl ComputeEngine {
    pub(super) fn apply_structure_change_bridge(
        &mut self,
        sheet_id: &SheetId,
        change: &StructureChange,
    ) -> Result<MutationResult, ComputeError> {
        self.complete_deferred_hydration_for_structure_change()?;

        // Pass 1: Suppress observer, apply structural ops + merge rebuild + formula recalc.
        let apply_result = services::structural::apply_structure_change(
            &mut self.stores,
            &mut self.cell_store,
            sheet_id,
            change,
        );

        let recalc = apply_result?;

        self.finish_structure_change(sheet_id, recalc, Some(change))
    }

    fn complete_deferred_hydration_for_structure_change(&mut self) -> Result<(), ComputeError> {
        let Some(mut completion) = construction::stage_deferred_hydration(self)? else {
            return Ok(());
        };

        if completion.calculation.full_calc_on_load || completion.calculation.force_full_calc {
            Self::materialize_all_pivots_for_import_open(
                &mut completion.stores,
                &mut completion.cell_store,
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
    ) -> Result<MutationResult, ComputeError> {
        self.postprocess_mutation_recalc(&mut recalc);
        let cf_active = !services::formatting::get_all_cf_rules(&self.stores, sheet_id).is_empty();
        if cf_active {
            self.refresh_cf_cache(sheet_id);
        }

        let mut result = MutationResult::from_recalc(recalc);
        result.floating_object_changes = services::structural::recompute_floating_object_bounds(
            &self.stores,
            &self.cell_store,
            sheet_id,
        );
        if let Some(change) = change
            && let Some(sc) = services::structural::build_structure_change_result(sheet_id, change)
        {
            result.structure_changes = vec![sc];
        }
        Ok(result)
    }

    /// Recompute pixel bounds for all cell-anchored floating objects on a sheet.
    ///
    /// Delegates to the structural service function.
    #[allow(dead_code)]
    pub(crate) fn recompute_floating_object_bounds(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<FloatingObjectChange> {
        services::structural::recompute_floating_object_bounds(
            &self.stores,
            &self.cell_store,
            sheet_id,
        )
    }
}

#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(test)]
static RECALC_OPTIONS_PANIC_BEFORE_FULL_RECALC: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
pub(in super::super) fn set_recalc_options_panic_before_full_recalc_for_tests(enabled: bool) {
    RECALC_OPTIONS_PANIC_BEFORE_FULL_RECALC.store(enabled, Ordering::SeqCst);
}

use super::*;

impl ComputeCore {
    // -----------------------------------------------------------------------
    // Internal: recalculation
    // -----------------------------------------------------------------------

    /// Perform a partial recalculation starting from the given changed cells.
    ///
    /// The returned `RecalcResult.changed_cells` includes **both**:
    /// - Directly-edited non-formula seed cells (values already written to the mirror)
    /// - Formula cells whose computed values changed as a result of recalculation
    ///
    /// This ensures downstream consumers (e.g. viewport buffer patching) see the
    /// complete set of cell changes without callers needing manual fixup.
    ///
    /// Visibility: `pub` so the engine layer (`YrsComputeEngine`) can drive
    /// incremental recalcs from non-cell mutation entry points (named-range
    /// CRUD, etc.). Within the scheduler, prefer `set_cell` / `apply_changes`
    /// which combine the mirror write with the recalc call.
    pub fn recalc(
        &mut self,
        mirror: &mut CellMirror,
        changed_cells: &[CellId],
    ) -> Result<RecalcResult, ComputeError> {
        if self.is_manual_calculation() {
            return self.recalc_manual_edit(mirror, changed_cells);
        }

        self.recalc_automatic(mirror, changed_cells)
    }

    fn recalc_automatic(
        &mut self,
        mirror: &mut CellMirror,
        changed_cells: &[CellId],
    ) -> Result<RecalcResult, ComputeError> {
        // Deferred graph build: if init_from_snapshot_minimal was used, the
        // dependency graph hasn't been built yet. Build it now before recalc.
        self.ensure_graph_built(mirror)?;

        let changed_with_formula_text: Vec<CellId> = {
            let mut changed = changed_cells.to_vec();
            let mut seen: FxHashSet<CellId> = changed.iter().copied().collect();
            for cell_id in changed_cells {
                for dependent in self.mark_formula_text_changed(mirror, *cell_id) {
                    if seen.insert(dependent) {
                        changed.push(dependent);
                    }
                }
            }
            changed
        };

        // Include non-formula seed cells in the result. These are cells whose
        // values were written to the mirror before recalc was called (plain-value
        // edits, clears). Formula seeds are handled by topo_evaluate_cells below.
        let mut seed_changes = Vec::new();
        for cell_id in &changed_with_formula_text {
            if !self.ast_cache.contains_key(cell_id)
                && let Some(value) = mirror.get_cell_value(cell_id).cloned()
                && let Some((_sid, change)) = self.make_cell_change(mirror, cell_id, &value)
            {
                seed_changes.push(change);
            }
        }

        // Range-aware affected-cell computation
        let affected = self
            .graph
            .affected_cells(&changed_with_formula_text, &*mirror)
            .into_value();
        // Filter out cells whose sheet has calculation disabled.
        // These cells stay in the dependency graph but skip evaluation,
        // retaining their last computed values.
        let affected: Vec<CellId> = affected
            .into_iter()
            .filter(|cell_id| {
                mirror
                    .sheet_for_cell(cell_id)
                    .is_none_or(|sid| mirror.is_calculation_enabled(&sid))
            })
            .collect();
        let mut result = self.topo_evaluate_cells(mirror, &affected)?;

        // Prepend seed changes (edits first, then formula dependents), deduplicating
        // against any formula cells that recalc may have also reported.
        if !seed_changes.is_empty() {
            let recalc_ids: FxHashSet<&str> = result
                .changed_cells
                .iter()
                .map(|c| c.cell_id.as_str())
                .collect();
            seed_changes.retain(|c| !recalc_ids.contains(c.cell_id.as_str()));
            if !seed_changes.is_empty() {
                seed_changes.append(&mut result.changed_cells);
                result.changed_cells = seed_changes;
            }
        }

        // Schema validation — also runs in prepare_recalc_for_flush() for the engine
        // path, but needed here for direct ComputeCore usage and tests.
        if let Some(ref schemas) = self.schema_map {
            result.validation_annotations =
                self.validate_dirty_cells(mirror, &changed_with_formula_text, schemas);
        }

        Ok(result)
    }

    fn recalc_manual_edit(
        &mut self,
        mirror: &mut CellMirror,
        changed_cells: &[CellId],
    ) -> Result<RecalcResult, ComputeError> {
        self.ensure_graph_built(mirror)?;
        let changed_cells: Vec<CellId> = {
            let mut changed = changed_cells.to_vec();
            let mut seen: FxHashSet<CellId> = changed.iter().copied().collect();
            let seeds = changed.clone();
            for cell_id in seeds {
                for dependent in self.mark_formula_text_changed(mirror, cell_id) {
                    if seen.insert(dependent) {
                        changed.push(dependent);
                    }
                }
            }
            changed
        };
        self.pending_manual_dirty_cells
            .extend(changed_cells.iter().copied());
        self.mark_dirty();

        // Manual mode still reflects the user's direct edits immediately. It
        // does not walk graph dependents; formula cells that depend on these
        // seeds retain their last displayed value until an explicit calculate.
        let mut seed_changes = Vec::new();
        let mut formula_seeds = Vec::new();
        for cell_id in &changed_cells {
            if self.ast_cache.contains_key(cell_id) {
                formula_seeds.push(*cell_id);
            } else if let Some(value) = mirror.get_cell_value(cell_id).cloned()
                && let Some((_sid, change)) = self.make_cell_change(mirror, cell_id, &value)
            {
                seed_changes.push(change);
            }
        }

        let mut result = if formula_seeds.is_empty() {
            RecalcResult::empty()
        } else {
            // A newly-entered or edited formula should calculate its own cell so
            // the user sees a value immediately. Downstream dependents remain
            // pending because we intentionally do not call affected_cells().
            self.topo_evaluate_cells(mirror, &formula_seeds)?
        };

        if !seed_changes.is_empty() {
            let recalc_ids: FxHashSet<&str> = result
                .changed_cells
                .iter()
                .map(|c| c.cell_id.as_str())
                .collect();
            seed_changes.retain(|c| !recalc_ids.contains(c.cell_id.as_str()));
            if !seed_changes.is_empty() {
                seed_changes.append(&mut result.changed_cells);
                result.changed_cells = seed_changes;
            }
        }

        if let Some(ref schemas) = self.schema_map {
            let mut dirty: Vec<CellId> = changed_cells.to_vec();
            dirty.extend(formula_seeds);
            result.validation_annotations = self.validate_dirty_cells(mirror, &dirty, schemas);
        }

        Ok(result)
    }

    /// Perform a full recalculation of all formula cells.
    #[tracing::instrument(name = "full_recalc", skip_all)]
    pub(crate) fn full_recalc(
        &mut self,
        mirror: &mut CellMirror,
    ) -> Result<RecalcResult, ComputeError> {
        self.ensure_graph_built(mirror)?;
        let deadline = make_deadline(self.recalc_timeout);

        #[cfg(feature = "journal")]
        {
            let formula_count = self.ast_cache.len() as u32;
            crate::journal::record(crate::journal::JournalEvent::RecalcStart {
                mode: "full",
                total_formula_cells: formula_count,
            });
        }

        // Re-register cell formulas that were rejected by incremental cycle detection
        // or seeded by deferred import before graph construction. The cell formula
        // text registry is the readback source; `formula_strings` can also contain
        // variable formulas, so it is not the right cell enumeration boundary here.
        let orphaned: Vec<(CellId, String)> = self
            .cell_formula_text
            .iter()
            .filter(|(cid, _)| !self.ast_cache.contains_key(cid))
            .map(|(cid, s)| (*cid, s.clone()))
            .collect();
        for (cell_id, formula) in orphaned {
            if let Some(sheet_id) = mirror.sheet_for_cell(&cell_id) {
                // Clear the stale #REF! error set during incremental edit rejection.
                // The cycle handler seeds Null cells to 0.0 for convergence; leaving
                // #REF! would cause every formula referencing this cell to propagate
                // the error instead of converging.
                mirror.set_value_mut(&cell_id, CellValue::Null);
                self.parse_and_register_formula(mirror, cell_id, sheet_id, formula, true);
            }
        }

        let filter_calc_enabled = |levels: Vec<Vec<CellId>>| -> Vec<Vec<CellId>> {
            levels
                .into_iter()
                .map(|level| {
                    level
                        .into_iter()
                        .filter(|cell_id| {
                            mirror
                                .sheet_for_cell(cell_id)
                                .is_none_or(|sid| mirror.is_calculation_enabled(&sid))
                        })
                        .collect()
                })
                .filter(|level: &Vec<CellId>| !level.is_empty())
                .collect()
        };

        let (levels, cycle_cores, downstream_levels) =
            self.graph.evaluation_levels_full(&*mirror).into_value();
        let levels = filter_calc_enabled(levels);

        let mut result: RecalcResult = if cycle_cores.is_empty() {
            let cell_count: usize = levels.iter().map(|l| l.len()).sum();
            let _eval_count =
                tracing::info_span!("full_recalc_eval_count", count = cell_count).entered();
            self.topo_evaluate_levels_with_deadline(mirror, levels, &deadline)?
        } else {
            let downstream_levels = filter_calc_enabled(downstream_levels);
            return self.handle_cycles_with_precomputed_levels(
                mirror,
                levels,
                cycle_cores,
                downstream_levels,
                &deadline,
            );
        };

        // Schema validation for full recalc — validate all changed cells.
        if let Some(ref schemas) = self.schema_map {
            let all_dirty: Vec<CellId> = result
                .changed_cells
                .iter()
                .filter_map(|c| CellId::from_uuid_str(&c.cell_id).ok())
                .collect();
            result.validation_annotations = self.validate_dirty_cells(mirror, &all_dirty, schemas);
        }

        Ok(result)
    }

    /// Perform a full recalculation with per-call iterative calculation overrides.
    ///
    /// Temporarily overrides `iterative_calc`, `max_iterations`, and `max_change`
    /// for the duration of this call, then restores the workbook-level settings.
    pub(crate) fn full_recalc_with_options(
        &mut self,
        mirror: &mut CellMirror,
        options: &snapshot_types::RecalcOptions,
    ) -> Result<RecalcResult, ComputeError> {
        // Save workbook-level settings
        let saved_iterative = self.iterative_calc;
        let saved_max_iterations = self.max_iterations;
        let saved_max_change = self.max_change;

        // Apply per-call overrides
        if let Some(iterative) = options.iterative {
            self.iterative_calc = iterative;
        }
        if let Some(max_iterations) = options.max_iterations {
            self.max_iterations = max_iterations;
        }
        if let Some(max_change) = options.max_change {
            self.max_change = max_change.get();
        }

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            #[cfg(test)]
            if RECALC_OPTIONS_PANIC_BEFORE_FULL_RECALC.swap(false, Ordering::SeqCst) {
                panic!("test panic before full_recalc_with_options production recalc");
            }

            self.full_recalc(mirror)
        }));

        self.iterative_calc = saved_iterative;
        self.max_iterations = saved_max_iterations;
        self.max_change = saved_max_change;

        let result = match result {
            Ok(result) => result,
            Err(payload) => std::panic::resume_unwind(payload),
        };
        if result.is_ok() {
            self.pending_manual_dirty_cells.clear();
        }
        result
    }
}

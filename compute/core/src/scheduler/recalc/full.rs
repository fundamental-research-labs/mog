use super::*;

impl ComputeCore {
    /// Evaluate pre-computed topological levels with a deadline for timeout.
    ///
    /// Unlike `topo_evaluate_cells_with_deadline`, this takes pre-computed levels
    /// from `DependencyGraph::evaluation_levels()` and passes them directly to
    /// the evaluation pass, eliminating the duplicate topo sort.
    pub(super) fn topo_evaluate_levels_with_deadline(
        &mut self,
        mirror: &mut CellMirror,
        levels: Vec<Vec<CellId>>,
        deadline: &Deadline,
    ) -> Result<RecalcResult, ComputeError> {
        self.begin_sumifs_cache_epoch();
        clear_thread_local_caches();

        #[cfg(feature = "journal")]
        {
            let cell_count: u32 = levels.iter().map(|l| l.len() as u32).sum();
            crate::journal::record(crate::journal::JournalEvent::RecalcStart {
                mode: "topo",
                total_formula_cells: cell_count,
            });
        }

        let mut metrics = self.init_recalc_metrics();
        let ast_cap_before = self.ast_cache.capacity();

        // Pre-size changed_cells: in full recalc, most formulas produce a change.
        let cell_count: usize = levels.iter().map(|l| l.len()).sum();
        let mut merged_changed_cells = Vec::with_capacity(cell_count);
        let mut merged_projection_changes = Vec::new();
        let mut merged_errors = Vec::new();

        // Epoch-scoped RangeStore: lives across all spill passes and all
        // topological levels so that data-only ranges are cached once and
        // reused, with per-level additive pre-materialization and dirty
        // invalidation after each level's apply phase.
        let mut epoch_range_store = crate::eval::cache::range_store::RangeStore::new();

        // Pass 1: Single-pass topo evaluation with pre-computed levels
        let (changed_cells, projection_changes, errors, projection_deltas) = self
            .topo_evaluate_pass_with_levels(
                mirror,
                levels,
                deadline,
                &mut epoch_range_store,
                &mut metrics,
            )?;

        merged_changed_cells.extend(changed_cells);
        merged_projection_changes.extend(projection_changes);
        merged_errors.extend(errors);

        // Pass 1.5: Selective dep fixup pass (hybrid Kahn's + deferral).
        //
        // Selective range deps (INDEX, VLOOKUP, etc.) get no barriers in the
        // barrier graph — they're ordered by cell-to-cell edges only. Some may
        // have evaluated before their range's formula cells, reading stale values.
        // Re-evaluate them now that all cells have computed values.
        //
        // Optimization: build a spatial index of cells that actually changed
        // value during the main pass. Only fixup selective deps whose ranges
        // overlap with changed cells. In XLSX full-recalc, most formulas produce
        // the same value as the cache, so this eliminates the vast majority of
        // unnecessary fixup re-evaluations.
        if !past_deadline(deadline) {
            let changed_index = super::cache_invalidation::build_changed_position_index(
                &merged_changed_cells,
                &merged_projection_changes,
            );
            let (fixup_changes, fixup_proj, fixup_errors) = self.selective_dep_fixup_pass(
                mirror,
                &mut epoch_range_store,
                &mut metrics,
                None,
                Some(&changed_index),
            );
            merged_changed_cells.extend(fixup_changes);
            merged_projection_changes.extend(fixup_proj);
            merged_errors.extend(fixup_errors);
        }

        // Pass 2: Projection stabilization — required even for full recalc.
        //
        // During bulk init, the projection registry is empty when dependencies
        // are extracted, so formulas reading from spill target positions (e.g.,
        // SUM(D4:D5) where D4 is a TRANSPOSE spill target) don't get Cell(source)
        // dependency edges. The barrier graph therefore can't order TRANSPOSE
        // sources before their dependents, causing those formulas to evaluate
        // with null/0 spill targets.
        //
        // Stabilization re-extracts deps (now projection-aware) and re-evaluates
        // affected formulas with the correct spill values. This also adds
        // Cell(source) edges for future incremental recalcs ("self-eliminating").
        if !projection_deltas.is_empty() {
            // NOTE: projection_conflicts metric is already tracked incrementally
            // in topo_evaluate_pass_with_levels (per-conflict as they happen).
            // Do NOT overwrite it here with a recount — that would double-count.
            let (stab_changes, stab_projection_changes, stab_errors) = self.projection_stabilize(
                mirror,
                &projection_deltas,
                deadline,
                0,
                &mut epoch_range_store,
            )?;
            merged_changed_cells.extend(stab_changes);
            merged_projection_changes.extend(stab_projection_changes);
            merged_errors.extend(stab_errors);
        }

        self.track_capacity_metrics(&mut metrics, ast_cap_before);
        self.collect_cache_metrics(&mut metrics);

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::RecalcEnd {
                changed_count: merged_changed_cells.len() as u32,
                projection_delta_count: projection_deltas.len() as u32,
            });
        }

        Ok(Self::build_recalc_result(
            merged_changed_cells,
            merged_projection_changes,
            merged_errors,
            metrics,
        ))
    }
}

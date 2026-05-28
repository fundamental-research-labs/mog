use super::*;

impl ComputeCore {
    /// Evaluate a list of cells in order and return changes.
    ///
    /// Cells are grouped by topological level. Within each level, cells have no
    /// mutual dependencies and can be evaluated in parallel (on native targets
    /// with rayon). Small levels are evaluated sequentially to avoid overhead.
    pub(super) fn topo_evaluate_cells(
        &mut self,
        mirror: &mut CellMirror,
        cells: &[CellId],
    ) -> Result<RecalcResult, ComputeError> {
        // No deadline — create a very large deadline (effectively infinite).
        // Use 1 year to avoid overflow with Instant::now().
        let deadline = make_deadline(std::time::Duration::from_secs(365 * 24 * 3600));
        self.topo_evaluate_cells_with_deadline(mirror, cells, &deadline)
    }

    /// Evaluate a list of cells in order with a deadline for timeout.
    pub(super) fn topo_evaluate_cells_with_deadline(
        &mut self,
        mirror: &mut CellMirror,
        cells: &[CellId],
        deadline: &Deadline,
    ) -> Result<RecalcResult, ComputeError> {
        self.begin_sumifs_cache_epoch();
        clear_thread_local_caches();

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::RecalcStart {
                mode: "topo",
                total_formula_cells: cells.len() as u32,
            });
        }

        let mut metrics = self.init_recalc_metrics();
        let ast_cap_before = self.ast_cache.capacity();

        // Pre-size changed_cells: in full recalc, most formulas produce a change.
        let mut merged_changed_cells = Vec::with_capacity(cells.len());
        let mut merged_projection_changes = Vec::new();
        let mut merged_errors = Vec::new();

        // NOTE: Cycle detection uses two strategies:
        // 1. During interactive edits, parse_and_register_formula performs incremental
        //    would_create_cycle checks per-edge (DFS from target to source). Cycles
        //    are caught before edges are added, and cells are set to #REF!.
        // 2. During bulk init (init_from_snapshot, apply_structure_change), per-edge
        //    cycle detection is skipped. Cycles are caught here by full_recalc's
        //    topological sort (get_evaluation_order), which returns Err(GraphError::CycleDetected)
        //    handled by handle_cycles_and_recalc. This avoids O(F^2*D) overhead.

        let current_cells: Vec<CellId> = cells.to_vec();

        // Epoch-scoped RangeStore: lives across all spill passes and all
        // topological levels so that data-only ranges are cached once and
        // reused, with per-level additive pre-materialization and dirty
        // invalidation after each level's apply phase.
        let mut epoch_range_store = crate::eval::cache::range_store::RangeStore::new();

        // Pass 1: Single-pass topo evaluation
        // (Phantom propagation loop removed — projection stabilization handles
        // dynamic array correctness via pass 2 below.)
        let (changed_cells, projection_changes, errors, projection_deltas, topo_cycle_cells) = self
            .topo_evaluate_pass(
                mirror,
                &current_cells,
                deadline,
                &mut epoch_range_store,
                &mut metrics,
            )?;

        merged_changed_cells.extend(changed_cells);
        merged_projection_changes.extend(projection_changes);
        merged_errors.extend(errors);

        // Phase 1b: Cycle handling — evaluate formula cells that topo ordering
        // could not schedule due to circular dependencies. Without this, cycle
        // cells remain at CellValue::Null (reads as 0) after incremental recalc.
        //
        // handle_cycles_and_recalc evaluates cycle cells then re-evaluates ALL
        // non-cycle formula cells. The non-cycle re-eval is necessary because
        // pass 1 may have computed them with stale/0 cycle inputs. Phase 1b
        // results supersede pass 1 results, so we deduplicate below.
        //
        // Future optimization: limit Phase 1b's non-cycle re-eval to only cells
        // that transitively depend on cycle cells.
        if !topo_cycle_cells.is_empty() {
            let cycle_result =
                self.handle_cycles_and_recalc(mirror, vec![topo_cycle_cells], deadline)?;

            // Deduplicate: Phase 1b results supersede pass 1 results for the
            // same cells (Phase 1b has correct values from updated cycle inputs).
            if !cycle_result.changed_cells.is_empty() {
                let cycle_ids: FxHashSet<&str> = cycle_result
                    .changed_cells
                    .iter()
                    .map(|c| c.cell_id.as_str())
                    .collect();
                merged_changed_cells.retain(|c| !cycle_ids.contains(c.cell_id.as_str()));
                merged_changed_cells.extend(cycle_result.changed_cells);
            }
            merged_projection_changes.extend(cycle_result.projection_changes);
            merged_errors.extend(cycle_result.errors);

            // Propagate cycle metrics (has_circular_refs, iterative_*) to the
            // caller's metrics so incremental recalc results report cycles.
            metrics.has_circular_refs = cycle_result.metrics.has_circular_refs;
            metrics.circular_cell_count = cycle_result.metrics.circular_cell_count;
            metrics.iterative_converged = cycle_result.metrics.iterative_converged;
            metrics.iterative_iterations = cycle_result.metrics.iterative_iterations;
            metrics.iterative_max_delta = cycle_result.metrics.iterative_max_delta;
        }

        // Phase 1c: Selective dep fixup pass (hybrid Kahn's + deferral).
        // For incremental recalc, only fixup selective deps that were in the
        // affected cell set (others retain correct values from prior recalcs).
        if !past_deadline(deadline) {
            let scope: FxHashSet<CellId> = current_cells.iter().copied().collect();
            let changed_index = super::cache_invalidation::build_changed_position_index(
                &merged_changed_cells,
                &merged_projection_changes,
            );
            let (fixup_changes, fixup_proj, fixup_errors) = self.selective_dep_fixup_pass(
                mirror,
                &mut epoch_range_store,
                &mut metrics,
                Some(&scope),
                Some(&changed_index),
            );
            merged_changed_cells.extend(fixup_changes);
            merged_projection_changes.extend(fixup_proj);
            merged_errors.extend(fixup_errors);
        }

        // Pass 2: Projection stabilization — only runs when projections changed shape/existence
        if !projection_deltas.is_empty() {
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

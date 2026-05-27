//! Recalculation engine — top-level recalc entry points and topo evaluation pass.
//!
//! Input processing, formula registration, level evaluation, spill handling, and
//! cycle detection have been extracted into sibling modules (`formula_reg`,
//! `level_eval`, `spill`, `cycles`).

use std::collections::HashMap;

use super::*;

#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(test)]
static RECALC_OPTIONS_PANIC_BEFORE_FULL_RECALC: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
pub(super) fn set_recalc_options_panic_before_full_recalc_for_tests(enabled: bool) {
    RECALC_OPTIONS_PANIC_BEFORE_FULL_RECALC.store(enabled, Ordering::SeqCst);
}

/// Result tuple from topo evaluation: (changes, projections, errors, projection_deltas, deferred_cells).
type TopoEvalResult = (
    Vec<CellChange>,
    Vec<ProjectionChange>,
    Vec<CellErrorInfo>,
    Vec<ProjectionDelta>,
    Vec<CellId>,
);

/// Result tuple from pre-leveled evaluation: (changes, projections, errors, projection_deltas).
type PreLeveledEvalResult = (
    Vec<CellChange>,
    Vec<ProjectionChange>,
    Vec<CellErrorInfo>,
    Vec<ProjectionDelta>,
);

// ---------------------------------------------------------------------------
// Deadline abstraction — uses WasmSafeInstant which works on both native and
// WASM targets (delegates to js_sys::Date::now() on WASM).
// ---------------------------------------------------------------------------

use crate::time_compat::WasmSafeInstant;

mod selective_fixup;

pub(super) type Deadline = WasmSafeInstant;

pub(super) fn make_deadline(timeout: std::time::Duration) -> Deadline {
    WasmSafeInstant::now()
        .checked_add(timeout)
        .unwrap_or_else(|| WasmSafeInstant::now() + std::time::Duration::from_secs(365 * 24 * 3600))
}

pub(super) fn past_deadline(deadline: &Deadline) -> bool {
    WasmSafeInstant::now() > *deadline
}

/// Clear all thread-local caches to avoid stale entries from previous recalc
/// sessions (e.g. if the user switches between demand-driven and topo
/// strategies, or runs multiple topo recalcs in sequence).
///
/// Caches backed by `thread_local!` live in the calling thread. The topo
/// evaluator runs formulas on rayon worker threads, which persist their
/// thread-locals across recalc calls. Clearing only the main thread leaves
/// stale entries on workers — the SUMIFS result cache keys by pointer
/// identity of the column slice, and mirror mutations reuse the same
/// column pointer, so a worker's cached result from a prior recalc
/// silently "hits" on a new recalc with different underlying data.
///
/// Under the `native` feature we broadcast the clear across the rayon
/// thread pool so every worker invalidates its thread-local.
pub(super) fn clear_thread_local_caches() {
    clear_current_thread_caches();
    #[cfg(feature = "native")]
    rayon::broadcast(|_| clear_current_thread_caches());
}

#[inline]
fn clear_current_thread_caches() {
    compute_functions::helpers::sorted_cache::clear();
    compute_functions::helpers::frequency_cache::clear();
    compute_functions::helpers::bitmask_cache::clear();
    compute_functions::helpers::column_index::clear();
    compute_functions::helpers::sumifs_result_cache::clear();
    crate::eval::cache::subexpr_cache::clear();
    crate::mirror::clear_caches();
}

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

    /// Evaluate a list of cells in order and return changes.
    ///
    /// Cells are grouped by topological level. Within each level, cells have no
    /// mutual dependencies and can be evaluated in parallel (on native targets
    /// with rayon). Small levels are evaluated sequentially to avoid overhead.
    fn topo_evaluate_cells(
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
    fn topo_evaluate_cells_with_deadline(
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
            let changed_index = {
                let mut idx: FxHashMap<(SheetId, u32), Vec<u32>> = FxHashMap::default();
                for change in &merged_changed_cells {
                    if let (Ok(sid), Some(pos)) = (
                        SheetId::from_uuid_str(&change.sheet_id),
                        change.position.as_ref(),
                    ) {
                        idx.entry((sid, pos.col)).or_default().push(pos.row);
                    }
                }
                for change in &merged_projection_changes {
                    if let Ok(sid) = SheetId::from_uuid_str(&change.sheet_id) {
                        for cell in &change.projection_cells {
                            idx.entry((sid, cell.col)).or_default().push(cell.row);
                        }
                    }
                }
                for rows in idx.values_mut() {
                    rows.sort_unstable();
                    rows.dedup();
                }
                idx
            };
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

    /// Evaluate pre-computed topological levels with a deadline for timeout.
    ///
    /// Unlike `topo_evaluate_cells_with_deadline`, this takes pre-computed levels
    /// from `DependencyGraph::evaluation_levels()` and passes them directly to
    /// the evaluation pass, eliminating the duplicate topo sort.
    fn topo_evaluate_levels_with_deadline(
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
            let changed_index = {
                let mut idx: FxHashMap<(SheetId, u32), Vec<u32>> = FxHashMap::default();
                for change in &merged_changed_cells {
                    if let (Ok(sid), Some(pos)) = (
                        SheetId::from_uuid_str(&change.sheet_id),
                        change.position.as_ref(),
                    ) {
                        idx.entry((sid, pos.col)).or_default().push(pos.row);
                    }
                }
                for change in &merged_projection_changes {
                    if let Ok(sid) = SheetId::from_uuid_str(&change.sheet_id) {
                        for cell in &change.projection_cells {
                            idx.entry((sid, cell.col)).or_default().push(cell.row);
                        }
                    }
                }
                for rows in idx.values_mut() {
                    rows.sort_unstable();
                    rows.dedup();
                }
                idx
            };
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

    /// Evaluate cells in topological order, returning changes and any cycle cells.
    ///
    /// Returns `(changed_cells, projection_changes, errors, projection_deltas, cycle_cells)`
    /// where `cycle_cells` are formula cells that topo ordering could not schedule
    /// due to circular dependencies. Callers should route these through
    /// `handle_cycles_and_recalc` for proper evaluation.
    ///
    /// NOTE: The per-level evaluation loop (pre-materialize, timeout, parallel/
    /// sequential dispatch, dirty invalidation) is structurally identical to
    /// `topo_evaluate_pass_with_levels`. They are kept separate because:
    /// 1. This method computes topo levels via `subset_levels` and gets cycle cells.
    /// 2. `_with_levels` takes pre-computed levels (no cycles) and runs a deferred
    ///    agg prepass mid-loop that mutates the levels array.
    /// 3. The agg prepass entanglement (6+ mutable state variables, level mutation)
    ///    makes merging the loops via parameterization more complex than the
    ///    duplication cost. Any changes to the per-level body must be mirrored.
    pub(super) fn topo_evaluate_pass(
        &mut self,
        mirror: &mut CellMirror,
        cells: &[CellId],
        deadline: &Deadline,
        epoch_range_store: &mut crate::eval::cache::range_store::RangeStore,
        metrics: &mut RecalcMetrics,
    ) -> Result<TopoEvalResult, ComputeError> {
        // Pre-size changed_cells for the common case where most cells change.
        let mut changed_cells = Vec::with_capacity(cells.len());
        let mut projection_changes = Vec::new();
        let mut errors = Vec::new();
        let mut projection_deltas = Vec::new();
        let sumifs_epoch = self
            .current_sumifs_cache_epoch()
            .expect("SUMIFS cache epoch must be initialized before topo evaluation");

        // Filter to only formula cells for level-based evaluation
        let eval_cells: Vec<CellId> = cells
            .iter()
            .copied()
            .filter(|c| self.ast_cache.contains_key(c))
            .collect();

        // Build the dirty_set once for both agg and data table prepasses.
        // Only rebuilt if agg prepass actually removes cells from eval_cells.
        let mut dirty_set: FxHashSet<CellId> = {
            let n = eval_cells.len();
            let mut s = FxHashSet::with_capacity_and_hasher(n, Default::default());
            s.extend(eval_cells.iter().copied());
            s
        };

        // Aggregation prepass: resolve COUNTIFS/SUMIFS/AVERAGEIFS groups before
        // level-based evaluation. Resolved cells are written to the mirror and
        // removed from the evaluation set.
        //
        // Pre-eval blocker cells: formula cells in agg data columns (e.g.,
        // ANCHORARRAY formulas at row 4) may not be in the dirty set but exist
        // in ast_cache. The data_formula_guard rightly bails when these aren't
        // evaluated. We detect and evaluate them first so the guard passes.
        let (eval_cells, sumifs_warm_data) = {
            // Detect agg groups and pre-evaluate blocker cells in data columns.
            let mut already_evaluated: FxHashSet<CellId> = FxHashSet::default();
            {
                let ast_cache = &self.ast_cache;
                let get_ast = |cell_id: &CellId| -> Option<&compute_parser::ASTNode> {
                    ast_cache.get(cell_id).map(|entry| &entry.ast)
                };
                let groups = crate::scheduler::agg_prepass::detect_agg_groups(
                    &dirty_set,
                    get_ast,
                    &*mirror,
                    agg_prepass::AGG_MIN_GROUP_SIZE,
                );
                if !groups.is_empty() {
                    let agg_group_cell_ids: FxHashSet<CellId> = groups
                        .iter()
                        .flat_map(|g| g.cell_ids.iter().copied())
                        .collect();
                    let blocker_cells = self.collect_agg_data_column_blockers(
                        &*mirror,
                        &agg_group_cell_ids,
                        &already_evaluated,
                    );
                    if !blocker_cells.is_empty() {
                        let _span = tracing::info_span!(
                            "agg_prepass_pre_eval",
                            cells = blocker_cells.len(),
                        )
                        .entered();

                        // Order blockers by dependency level so dynamic array
                        // sources (e.g., UNIQUE) evaluate and spill before cells
                        // that read from their spill columns (e.g., XLOOKUP).
                        let (blocker_levels, _blocker_cycles) = self
                            .graph
                            .subset_levels(&blocker_cells, &*mirror)
                            .into_value();

                        for level in &blocker_levels {
                            // Pre-materialize ranges for this level's cells
                            {
                                let plan: crate::eval::cache::range_store::DataPlan = level
                                    .iter()
                                    .filter_map(|cid| self.cell_range_keys.get(cid))
                                    .flat_map(|keys| keys.iter().copied())
                                    .collect();
                                epoch_range_store.pre_materialize_additive(&plan, mirror);
                            }

                            let deltas_before = projection_deltas.len();

                            self.topo_evaluate_level_sequential(
                                mirror,
                                level,
                                &mut changed_cells,
                                &mut projection_changes,
                                &mut errors,
                                epoch_range_store,
                                &mut projection_deltas,
                                metrics,
                            );

                            // Invalidate cached ranges for evaluated cells
                            let dirty_positions: Vec<(SheetId, u32, u32)> = level
                                .iter()
                                .filter_map(|cid| {
                                    let sid = mirror.sheet_for_cell(cid)?;
                                    let pos = mirror.resolve_position(cid)?;
                                    Some((sid, pos.row(), pos.col()))
                                })
                                .collect();

                            // Also invalidate spill target regions so the next
                            // level reads fresh data from the mirror, not stale
                            // range store cache. Use range-based invalidation to
                            // avoid materializing every cell position.
                            let mut dirty_ranges: Vec<(SheetId, u32, u32, u32, u32)> = Vec::new();
                            for delta in &projection_deltas[deltas_before..] {
                                if let Some(proj) = &delta.new {
                                    dirty_ranges.push((
                                        proj.sheet,
                                        proj.origin_row,
                                        proj.origin_col,
                                        proj.origin_row + proj.rows.saturating_sub(1),
                                        proj.origin_col + proj.cols.saturating_sub(1),
                                    ));
                                }
                            }

                            if !dirty_positions.is_empty() {
                                epoch_range_store.invalidate_dirty(&dirty_positions);
                            }
                            if !dirty_ranges.is_empty() {
                                epoch_range_store.invalidate_dirty_ranges(&dirty_ranges);
                            }
                        }

                        for &cid in &blocker_cells {
                            already_evaluated.insert(cid);
                        }
                    }
                }
            }

            let (agg_resolved, warm_data) =
                self.run_agg_prepass(&*mirror, &dirty_set, &already_evaluated, sumifs_epoch);
            if agg_resolved.is_empty() {
                (eval_cells, warm_data)
            } else {
                // Track agg prepass metrics (Task 1.5e)
                metrics.agg_prepass_cells += agg_resolved.len() as u64;
                let mut resolved_set = FxHashSet::default();
                for (cell_id, mut new_value) in agg_resolved {
                    // Excel coercion: formula Null -> Number(0)
                    if matches!(new_value, CellValue::Null) {
                        new_value = CellValue::number(0.0);
                    }

                    #[cfg(feature = "journal")]
                    {
                        crate::journal::record(crate::journal::JournalEvent::AggPrepassResolved {
                            cell: cell_id,
                            function: "COUNTIFS/SUMIFS/AVERAGEIFS",
                            value_summary: crate::journal::journal_fmt_value(&new_value),
                        });
                    }

                    let old = mirror
                        .get_cell_value(&cell_id)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    mirror.set_value_mut(&cell_id, new_value.clone());
                    if !values_equal(&old, &new_value)
                        && let Some((_sid, change)) =
                            self.make_cell_change(mirror, &cell_id, &new_value)
                    {
                        changed_cells.push(change);
                    }
                    resolved_set.insert(cell_id);
                    // Remove resolved cells from dirty_set so the data table
                    // prepass doesn't need to rebuild it from scratch.
                    dirty_set.remove(&cell_id);
                }
                (
                    eval_cells
                        .into_iter()
                        .filter(|c| !resolved_set.contains(c))
                        .collect(),
                    warm_data,
                )
            }
        };

        // Data table prepass: resolve TABLE cells before level-based evaluation.
        // Reuses the dirty_set maintained above (already updated by agg prepass
        // removals), avoiding a redundant O(N) FxHashSet construction.
        let eval_cells = {
            let dt_resolved = self.run_data_table_prepass(mirror, &dirty_set);
            if dt_resolved.is_empty() {
                eval_cells
            } else {
                let mut resolved_set = FxHashSet::default();
                for (cell_id, mut new_value) in dt_resolved {
                    // Excel coercion: formula Null -> Number(0)
                    if matches!(new_value, CellValue::Null) {
                        new_value = CellValue::number(0.0);
                    }

                    let old = mirror
                        .get_cell_value(&cell_id)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    mirror.set_value_mut(&cell_id, new_value.clone());
                    if !values_equal(&old, &new_value)
                        && let Some((_sid, change)) =
                            self.make_cell_change(mirror, &cell_id, &new_value)
                    {
                        changed_cells.push(change);
                    }
                    resolved_set.insert(cell_id);
                }
                eval_cells
                    .into_iter()
                    .filter(|c| !resolved_set.contains(c))
                    .collect()
            }
        };

        let _formula_count_span =
            tracing::info_span!("evaluate_cells", formula_count = eval_cells.len()).entered();

        // Group remaining cells by topological level. Cycle cells (non-zero
        // in-degree after Kahn's) are returned separately for cycle handling.
        let (levels, cycle_cells) = {
            let _span =
                tracing::info_span!("topo_levels", input_cells = eval_cells.len()).entered();
            self.graph.subset_levels(&eval_cells, &*mirror).into_value()
        };

        let _level_count_span =
            tracing::info_span!("evaluate_levels", level_count = levels.len()).entered();

        // Record topo levels metric (Task 1.5b)
        metrics.topo_levels = levels.len() as u64;

        let total_levels = levels.len();
        for (level_idx, level) in levels.iter().enumerate() {
            if level.is_empty() {
                continue;
            }

            // Pre-materialize ranges for this level using pre-computed per-cell keys.
            {
                let plan: crate::eval::cache::range_store::DataPlan = level
                    .iter()
                    .filter_map(|cid| self.cell_range_keys.get(cid))
                    .flat_map(|keys| keys.iter().copied())
                    .collect();
                epoch_range_store.pre_materialize_additive(&plan, mirror);
            }

            // Check timeout before each level (cheap: single clock read per level)
            if past_deadline(deadline) {
                tracing::warn!(
                    remaining_levels = total_levels - level_idx,
                    "recalc timeout exceeded, marking remaining cells as #CALC! error"
                );
                metrics.timed_out = true;
                // Mark all remaining formula cells as #CALC! error
                for remaining_level in &levels[level_idx..] {
                    for &cell_id in remaining_level {
                        let timeout_value = CellValue::Error(CellError::Calc, None);
                        mirror.set_value_mut(&cell_id, timeout_value.clone());
                        if let Some((_sid, change)) =
                            self.make_cell_change(mirror, &cell_id, &timeout_value)
                        {
                            changed_cells.push(change);
                        }
                        if let Some(sheet_id) = self.find_sheet_for_cell(mirror, &cell_id) {
                            errors.push(CellErrorInfo {
                                cell_id: cell_id.to_uuid_string(),
                                sheet_id: sheet_id.to_uuid_string(),
                                error: "Recalculation timeout exceeded".to_string(),
                            });
                        }
                    }
                }
                break;
            }

            // Track how many changed_cells and projection_changes exist before
            // this level, so we can identify new entries for dirty invalidation.
            let changed_cells_before = changed_cells.len();
            let projections_before = projection_changes.len();
            let deltas_before = projection_deltas.len();

            // Decide: parallel or sequential based on level size
            #[cfg(feature = "native")]
            let use_parallel = level.len() >= level_eval::PARALLEL_THRESHOLD;
            #[cfg(not(feature = "native"))]
            let use_parallel = false;

            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::LevelStart {
                    level_index: level_idx as u32,
                    total_levels: total_levels as u32,
                    cell_count: level.len() as u32,
                    parallel: use_parallel,
                });
            }

            if use_parallel {
                #[cfg(feature = "native")]
                {
                    metrics.levels_parallel += 1;
                    metrics.parallel_batch_cells += level.len() as u64;
                    let _span = tracing::info_span!("evaluate_level_parallel", cells = level.len())
                        .entered();
                    self.topo_evaluate_level_parallel(
                        mirror,
                        level,
                        &mut changed_cells,
                        &mut projection_changes,
                        &mut errors,
                        epoch_range_store,
                        &mut projection_deltas,
                        metrics,
                        &sumifs_warm_data,
                    );
                }
            } else {
                metrics.levels_sequential += 1;
                let _span =
                    tracing::info_span!("evaluate_level_sequential", cells = level.len()).entered();
                self.topo_evaluate_level_sequential(
                    mirror,
                    level,
                    &mut changed_cells,
                    &mut projection_changes,
                    &mut errors,
                    epoch_range_store,
                    &mut projection_deltas,
                    metrics,
                );
            }

            // Invalidate cached ranges that overlap cells changed in this level
            // so subsequent levels see fresh data instead of stale snapshots.
            let dirty_positions: Vec<(SheetId, u32, u32)> = changed_cells[changed_cells_before..]
                .iter()
                .filter_map(|change| {
                    let sheet_id = SheetId::from_uuid_str(&change.sheet_id).ok()?;
                    let pos = change.position.as_ref()?;
                    Some((sheet_id, pos.row, pos.col))
                })
                .collect();

            // Also invalidate spill target regions so subsequent levels and
            // projection stabilization read fresh data from the mirror, not
            // stale range store cache. Without this, formulas like SUM(D4:D5)
            // where D4/D5 are TRANSPOSE spill targets will read cached zeros.
            // Use range-based invalidation to avoid materializing every cell position.
            let mut dirty_ranges: Vec<(SheetId, u32, u32, u32, u32)> = Vec::new();
            let deltas_in_level = &projection_deltas[deltas_before..];
            for delta in deltas_in_level {
                if let Some(proj) = &delta.new {
                    dirty_ranges.push((
                        proj.sheet,
                        proj.origin_row,
                        proj.origin_col,
                        proj.origin_row + proj.rows.saturating_sub(1),
                        proj.origin_col + proj.cols.saturating_sub(1),
                    ));
                }
            }

            if !dirty_positions.is_empty() {
                epoch_range_store.invalidate_dirty(&dirty_positions);
            }
            if !dirty_ranges.is_empty() {
                epoch_range_store.invalidate_dirty_ranges(&dirty_ranges);
            }

            // Invalidate LookupIndexCache for columns written by spill
            // materialization in this level. materialize_projection writes
            // spill target values to col_data but cannot invalidate the
            // LookupIndexCache (it lives in EpochRangeStore, not CellMirror).
            // Without this, XLOOKUP/VLOOKUP on spill-populated columns may
            // hit a stale index that was built before the spill values existed.
            // Note: invalidate_dirty_ranges already handles lookup cache
            // invalidation for the projection ranges above. This block handles
            // the projection_changes (which have the per-cell col info) for
            // any additional columns not covered by deltas.
            #[cfg(feature = "native")]
            {
                for proj in &projection_changes[projections_before..] {
                    if let Ok(sheet_id) = SheetId::from_uuid_str(&proj.sheet_id) {
                        // Deduplicate columns to avoid redundant remove_column calls
                        let cols: FxHashSet<u32> =
                            proj.projection_cells.iter().map(|cd| cd.col).collect();
                        for col in cols {
                            epoch_range_store
                                .lookup_cache()
                                .remove_column(sheet_id, col);
                        }
                    }
                }
            }
        }

        // Track projection metrics (Task 1.5e)
        for delta in &projection_deltas {
            if delta.new.is_some() {
                metrics.projections_registered += 1;
            }
            if delta.old.is_some() && delta.new.is_none() {
                // Projection was removed — could indicate a conflict
                metrics.projection_conflicts += 1;
            }
        }
        metrics.projections_materialized += projection_changes.len() as u64;

        Ok((
            changed_cells,
            projection_changes,
            errors,
            projection_deltas,
            cycle_cells,
        ))
    }

    /// Evaluation pass with pre-computed topological levels.
    ///
    /// Like `topo_evaluate_pass` but uses pre-computed topological levels
    /// directly. Agg/datatable prepass cells are filtered from
    /// the existing levels rather than requiring a re-sort.
    ///
    /// See `topo_evaluate_pass` doc comment for why these loops are kept separate.
    pub(super) fn topo_evaluate_pass_with_levels(
        &mut self,
        mirror: &mut CellMirror,
        pre_levels: Vec<Vec<CellId>>,
        deadline: &Deadline,
        epoch_range_store: &mut crate::eval::cache::range_store::RangeStore,
        metrics: &mut RecalcMetrics,
    ) -> Result<PreLeveledEvalResult, ComputeError> {
        // Filter pre-computed levels to formula cells only
        let mut formula_levels: Vec<Vec<CellId>> = pre_levels
            .into_iter()
            .map(|level| {
                level
                    .into_iter()
                    .filter(|c| self.ast_cache.contains_key(c))
                    .collect::<Vec<_>>()
            })
            .filter(|level: &Vec<CellId>| !level.is_empty())
            .collect();

        // Collect all formula cells for prepass
        let all_eval_cells: Vec<CellId> = formula_levels
            .iter()
            .flat_map(|l| l.iter().copied())
            .collect();

        // Pre-size result vectors based on formula count to avoid reallocation.
        // In a full recalc most formula cells produce a changed value.
        let formula_count = all_eval_cells.len();
        let mut changed_cells = Vec::with_capacity(formula_count);
        let mut projection_changes = Vec::new();
        let mut errors = Vec::new();
        let mut projection_deltas = Vec::new();

        // Build dirty_set for group detection and data table prepass
        let dirty_set: FxHashSet<CellId> = {
            let n = all_eval_cells.len();
            let mut s = FxHashSet::with_capacity_and_hasher(n, Default::default());
            s.extend(all_eval_cells.iter().copied());
            s
        };

        // Data table prepass: resolve TABLE cells before level-based evaluation.
        let dt_resolved_set = {
            let dt_resolved = self.run_data_table_prepass(mirror, &dirty_set);
            if dt_resolved.is_empty() {
                FxHashSet::default()
            } else {
                let mut resolved_set = FxHashSet::default();
                for (cell_id, mut new_value) in dt_resolved {
                    // Excel coercion: formula Null -> Number(0)
                    if matches!(new_value, CellValue::Null) {
                        new_value = CellValue::number(0.0);
                    }

                    let old = mirror
                        .get_cell_value(&cell_id)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    mirror.set_value_mut(&cell_id, new_value.clone());
                    if !values_equal(&old, &new_value)
                        && let Some((_sid, change)) =
                            self.make_cell_change(mirror, &cell_id, &new_value)
                    {
                        changed_cells.push(change);
                    }
                    resolved_set.insert(cell_id);
                }
                resolved_set
            }
        };

        // Filter data-table-resolved cells from levels
        if !dt_resolved_set.is_empty() {
            formula_levels = formula_levels
                .into_iter()
                .map(|level| {
                    level
                        .into_iter()
                        .filter(|c| !dt_resolved_set.contains(c))
                        .collect::<Vec<_>>()
                })
                .filter(|level: &Vec<CellId>| !level.is_empty())
                .collect();
        }

        // Build cell-to-level map for determining when to run the agg prepass.
        let cell_level_map: FxHashMap<CellId, usize> = {
            let n = all_eval_cells.len();
            let mut m = FxHashMap::with_capacity_and_hasher(n, Default::default());
            for (level_idx, level) in formula_levels.iter().enumerate() {
                for &cell_id in level {
                    m.insert(cell_id, level_idx);
                }
            }
            m
        };

        // Determine the agg prepass trigger level: detect groups and find the
        // earliest level containing group cells. We run the agg prepass right
        // before that level, after all earlier levels have been evaluated so
        // formula cells in data ranges have fresh values.
        let (agg_trigger_level, agg_group_cell_ids): (Option<usize>, FxHashSet<CellId>) = {
            let ast_cache = &self.ast_cache;
            let get_ast = |cell_id: &CellId| -> Option<&compute_parser::ASTNode> {
                ast_cache.get(cell_id).map(|entry| &entry.ast)
            };
            let groups = crate::scheduler::agg_prepass::detect_agg_groups(
                &dirty_set,
                get_ast,
                &*mirror,
                agg_prepass::AGG_MIN_GROUP_SIZE,
            );
            if groups.is_empty() {
                (None, FxHashSet::default())
            } else {
                let cell_ids: FxHashSet<CellId> = groups
                    .iter()
                    .flat_map(|g| g.cell_ids.iter().copied())
                    .collect();
                let min_level = cell_ids
                    .iter()
                    .filter_map(|cid| cell_level_map.get(cid).copied())
                    .min();
                (min_level, cell_ids)
            }
        };

        // Track cells evaluated so far (grows as levels complete).
        // Used by the deferred agg prepass to determine which formula cells
        // in data ranges have fresh values.
        let remaining_count: usize = formula_levels.iter().map(|l| l.len()).sum();
        let mut already_evaluated: FxHashSet<CellId> =
            FxHashSet::with_capacity_and_hasher(remaining_count, Default::default());
        // Whether the agg prepass has been run (we run it exactly once).
        let mut agg_prepass_done = agg_trigger_level.is_none();
        // Pre-warmed SUMIFS cache data to seed into rayon worker threads.
        // Populated when the agg prepass runs (may be deferred to a later level).
        let mut sumifs_warm_data: Option<
            compute_functions::helpers::sumifs_result_cache::SumifsWarmData,
        > = None;
        let _formula_count_span =
            tracing::info_span!("evaluate_cells", formula_count = remaining_count).entered();

        // Use pre-computed levels directly
        let mut levels = formula_levels;

        let _level_count_span =
            tracing::info_span!("evaluate_levels", level_count = levels.len()).entered();

        // Record topo levels metric (Task 1.5b)
        metrics.topo_levels = levels.len() as u64;

        let total_levels = levels.len();
        for level_idx in 0..total_levels {
            if levels[level_idx].is_empty() {
                continue;
            }

            // Deferred agg prepass: run once, right before the first level that
            // contains agg group cells. At this point, all earlier levels have
            // been evaluated so formula cells in data ranges have fresh values.
            //
            // Pre-eval blocker cells: full-column range deps ($AH:$AH) don't
            // create cell-level dependency edges, so formula cells in data
            // columns (e.g., row-4 ANCHORARRAY formulas) may not appear in
            // the topo-sort levels at all, or may land at the same level as
            // the SUMIFS cells. The prepass guard (`check_data_formulas`)
            // rightly bails when those cells aren't in `already_evaluated`.
            // Fix: scan the agg groups' data columns, find formula cells that
            // aren't yet evaluated, evaluate them, then run the prepass.
            if !agg_prepass_done && Some(level_idx) >= agg_trigger_level {
                agg_prepass_done = true;

                // Phase A: find and evaluate "blocker" formula cells in data
                // columns. These are formula cells that the guard would flag
                // (in ast_cache but not in already_evaluated). They may be
                // outside the topo levels entirely (orphan formulas) or at the
                // current/later levels.
                let blocker_cells = self.collect_agg_data_column_blockers(
                    &*mirror,
                    &agg_group_cell_ids,
                    &already_evaluated,
                );

                if !blocker_cells.is_empty() {
                    let _span =
                        tracing::info_span!("agg_prepass_pre_eval", cells = blocker_cells.len(),)
                            .entered();

                    // Pre-materialize ranges for these cells
                    {
                        let plan: crate::eval::cache::range_store::DataPlan = blocker_cells
                            .iter()
                            .filter_map(|cid| self.cell_range_keys.get(cid))
                            .flat_map(|keys| keys.iter().copied())
                            .collect();
                        epoch_range_store.pre_materialize_additive(&plan, mirror);
                    }

                    self.topo_evaluate_level_sequential(
                        mirror,
                        &blocker_cells,
                        &mut changed_cells,
                        &mut projection_changes,
                        &mut errors,
                        epoch_range_store,
                        &mut projection_deltas,
                        metrics,
                    );

                    // Add to already_evaluated so the prepass guard passes
                    for &cid in &blocker_cells {
                        already_evaluated.insert(cid);
                    }

                    // Invalidate cached ranges that overlap pre-eval changes so
                    // the agg prepass reads fresh column data.
                    let pre_eval_dirty: Vec<(SheetId, u32, u32)> = blocker_cells
                        .iter()
                        .filter_map(|cid| {
                            let sid = mirror.sheet_for_cell(cid)?;
                            let pos = mirror.resolve_position(cid)?;
                            Some((sid, pos.row(), pos.col()))
                        })
                        .collect();
                    if !pre_eval_dirty.is_empty() {
                        epoch_range_store.invalidate_dirty(&pre_eval_dirty);
                    }

                    // Remove blocker cells from levels if they were there
                    // (prevents double-evaluation).
                    let blocker_set: FxHashSet<CellId> = blocker_cells.into_iter().collect();
                    for lvl in &mut levels[level_idx..] {
                        lvl.retain(|c| !blocker_set.contains(c));
                    }
                }

                // Phase B: run the agg prepass (guards should now pass).
                let remaining_dirty: FxHashSet<CellId> = {
                    let mut s = FxHashSet::default();
                    for lvl in &levels[level_idx..] {
                        s.extend(lvl.iter().copied());
                    }
                    s
                };
                let (agg_resolved, warm_data) = self.run_agg_prepass(
                    &*mirror,
                    &remaining_dirty,
                    &already_evaluated,
                    self.current_sumifs_cache_epoch()
                        .expect("SUMIFS cache epoch must be initialized before agg prepass"),
                );
                // Store warmed SUMIFS cache data for seeding into rayon workers
                if let Some(wd) = warm_data {
                    sumifs_warm_data = Some(wd);
                }
                if !agg_resolved.is_empty() {
                    metrics.agg_prepass_cells += agg_resolved.len() as u64;
                    let mut agg_resolved_set = FxHashSet::default();
                    for (cell_id, mut new_value) in agg_resolved {
                        if matches!(new_value, CellValue::Null) {
                            new_value = CellValue::number(0.0);
                        }

                        #[cfg(feature = "journal")]
                        {
                            crate::journal::record(
                                crate::journal::JournalEvent::AggPrepassResolved {
                                    cell: cell_id,
                                    function: "COUNTIFS/SUMIFS/AVERAGEIFS",
                                    value_summary: crate::journal::journal_fmt_value(&new_value),
                                },
                            );
                        }

                        let old = mirror
                            .get_cell_value(&cell_id)
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        mirror.set_value_mut(&cell_id, new_value.clone());
                        if !values_equal(&old, &new_value)
                            && let Some((_sid, change)) =
                                self.make_cell_change(mirror, &cell_id, &new_value)
                        {
                            changed_cells.push(change);
                        }
                        agg_resolved_set.insert(cell_id);
                    }
                    // Filter resolved cells from remaining levels
                    for lvl in &mut levels[level_idx..] {
                        lvl.retain(|c| !agg_resolved_set.contains(c));
                    }
                }
            }

            let level = &levels[level_idx];

            // Pre-materialize ranges for this level using pre-computed per-cell
            // keys from init. Avoids re-walking ASTs (saves ~0.7s on 263K formulas).
            {
                let plan: crate::eval::cache::range_store::DataPlan = level
                    .iter()
                    .filter_map(|cid| self.cell_range_keys.get(cid))
                    .flat_map(|keys| keys.iter().copied())
                    .collect();
                epoch_range_store.pre_materialize_additive(&plan, mirror);
            }

            // Check timeout before each level (cheap: single clock read per level)
            if past_deadline(deadline) {
                tracing::warn!(
                    remaining_levels = total_levels - level_idx,
                    "recalc timeout exceeded, marking remaining cells as #CALC! error"
                );
                metrics.timed_out = true;
                // Mark all remaining formula cells as #CALC! error
                for remaining_level in &levels[level_idx..] {
                    for &cell_id in remaining_level {
                        let timeout_value = CellValue::Error(CellError::Calc, None);
                        mirror.set_value_mut(&cell_id, timeout_value.clone());
                        if let Some((_sid, change)) =
                            self.make_cell_change(mirror, &cell_id, &timeout_value)
                        {
                            changed_cells.push(change);
                        }
                        if let Some(sheet_id) = self.find_sheet_for_cell(mirror, &cell_id) {
                            errors.push(CellErrorInfo {
                                cell_id: cell_id.to_uuid_string(),
                                sheet_id: sheet_id.to_uuid_string(),
                                error: "Recalculation timeout exceeded".to_string(),
                            });
                        }
                    }
                }
                break;
            }

            // Track how many changed_cells and projection_changes exist before
            // this level, so we can identify new entries for dirty invalidation.
            let changed_cells_before = changed_cells.len();
            let projections_before = projection_changes.len();
            let deltas_before = projection_deltas.len();

            // Decide: parallel or sequential based on level size
            #[cfg(feature = "native")]
            let use_parallel = level.len() >= level_eval::PARALLEL_THRESHOLD;
            #[cfg(not(feature = "native"))]
            let use_parallel = false;

            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::LevelStart {
                    level_index: level_idx as u32,
                    total_levels: total_levels as u32,
                    cell_count: level.len() as u32,
                    parallel: use_parallel,
                });
            }

            if use_parallel {
                #[cfg(feature = "native")]
                {
                    metrics.levels_parallel += 1;
                    metrics.parallel_batch_cells += level.len() as u64;
                    let _span = tracing::info_span!("evaluate_level_parallel", cells = level.len())
                        .entered();
                    self.topo_evaluate_level_parallel(
                        mirror,
                        level,
                        &mut changed_cells,
                        &mut projection_changes,
                        &mut errors,
                        epoch_range_store,
                        &mut projection_deltas,
                        metrics,
                        &sumifs_warm_data,
                    );
                }
            } else {
                metrics.levels_sequential += 1;
                let _span =
                    tracing::info_span!("evaluate_level_sequential", cells = level.len()).entered();
                self.topo_evaluate_level_sequential(
                    mirror,
                    level,
                    &mut changed_cells,
                    &mut projection_changes,
                    &mut errors,
                    epoch_range_store,
                    &mut projection_deltas,
                    metrics,
                );
            }

            // Invalidate cached ranges that overlap cells changed in this level
            // so subsequent levels see fresh data instead of stale snapshots.
            let dirty_positions: Vec<(SheetId, u32, u32)> = changed_cells[changed_cells_before..]
                .iter()
                .filter_map(|change| {
                    let sheet_id = SheetId::from_uuid_str(&change.sheet_id).ok()?;
                    let pos = change.position.as_ref()?;
                    Some((sheet_id, pos.row, pos.col))
                })
                .collect();

            // Also invalidate spill target regions so subsequent levels and
            // projection stabilization read fresh data from the mirror, not
            // stale range store cache. Without this, formulas like SUM(D4:D5)
            // where D4/D5 are TRANSPOSE spill targets will read cached zeros.
            // Use range-based invalidation to avoid materializing every cell position.
            let mut dirty_ranges: Vec<(SheetId, u32, u32, u32, u32)> = Vec::new();
            for delta in &projection_deltas[deltas_before..] {
                if let Some(proj) = &delta.new {
                    dirty_ranges.push((
                        proj.sheet,
                        proj.origin_row,
                        proj.origin_col,
                        proj.origin_row + proj.rows.saturating_sub(1),
                        proj.origin_col + proj.cols.saturating_sub(1),
                    ));
                }
            }

            if !dirty_positions.is_empty() {
                epoch_range_store.invalidate_dirty(&dirty_positions);
            }
            if !dirty_ranges.is_empty() {
                epoch_range_store.invalidate_dirty_ranges(&dirty_ranges);
            }

            // Invalidate LookupIndexCache for columns written by spill
            // materialization in this level (same fix as main recalc loop).
            #[cfg(feature = "native")]
            {
                for proj in &projection_changes[projections_before..] {
                    if let Ok(sheet_id) = SheetId::from_uuid_str(&proj.sheet_id) {
                        let cols: FxHashSet<u32> =
                            proj.projection_cells.iter().map(|cd| cd.col).collect();
                        for col in cols {
                            epoch_range_store
                                .lookup_cache()
                                .remove_column(sheet_id, col);
                        }
                    }
                }
            }

            // Track evaluated cells for the deferred agg prepass.
            // Must come AFTER evaluation so the guard knows these cells have fresh values.
            if !agg_prepass_done {
                already_evaluated.extend(level.iter().copied());
            }
        }

        // Track projection metrics (Task 1.5e)
        for delta in &projection_deltas {
            if delta.new.is_some() {
                metrics.projections_registered += 1;
            }
            if delta.old.is_some() && delta.new.is_none() {
                // Projection was removed — could indicate a conflict
                metrics.projection_conflicts += 1;
            }
        }
        metrics.projections_materialized += projection_changes.len() as u64;

        Ok((changed_cells, projection_changes, errors, projection_deltas))
    }

    /// Collect formula cells in agg-group data columns that would cause the
    /// `data_formula_guard` to bail (in `ast_cache` but not yet evaluated).
    ///
    /// These are typically a handful of cells (e.g., ANCHORARRAY formulas at
    /// row 4) that sit in columns scanned by SUMIFS/COUNTIFS but aren't part
    /// of the topo-sort levels (orphan formulas without dependents). The caller
    /// evaluates them before the prepass so the guard passes.
    fn collect_agg_data_column_blockers(
        &self,
        mirror: &CellMirror,
        agg_group_cell_ids: &FxHashSet<CellId>,
        already_evaluated: &FxHashSet<CellId>,
    ) -> Vec<CellId> {
        // Re-detect groups to access their data column ranges.
        let ast_cache = &self.ast_cache;
        let get_ast = |cell_id: &CellId| -> Option<&compute_parser::ASTNode> {
            ast_cache.get(cell_id).map(|entry| &entry.ast)
        };
        // Use the agg_group_cell_ids as the dirty set for group detection
        let groups = agg_prepass::detect_agg_groups(
            agg_group_cell_ids,
            get_ast,
            mirror,
            agg_prepass::AGG_MIN_GROUP_SIZE,
        );

        // Collect unique (sheet, col, start_row, end_row) ranges from all groups
        let mut seen_ranges: FxHashSet<(SheetId, u32, u32, u32)> = FxHashSet::default();
        for group in &groups {
            for pair in &group.pattern.pairs {
                seen_ranges.insert((
                    pair.data_sheet,
                    pair.data_col,
                    pair.data_start_row,
                    pair.data_end_row,
                ));
            }
            if let Some((vs, vc, vstart, vend)) = &group.pattern.value_range {
                seen_ranges.insert((*vs, *vc, *vstart, *vend));
            }
        }

        // Scan each range for formula cells not yet evaluated
        let mut blockers: Vec<CellId> = Vec::new();
        let mut blocker_set: FxHashSet<CellId> = FxHashSet::default();
        for &(sheet, col, start_row, end_row) in &seen_ranges {
            let Some(sh) = mirror.get_sheet(&sheet) else {
                continue;
            };
            let clamped_end = if end_row == u32::MAX {
                sh.rows
            } else {
                end_row.min(sh.rows)
            };
            for row in start_row..clamped_end {
                if let Some(cell_id) = mirror.resolve_cell_id(&sheet, SheetPos::new(row, col))
                    && ast_cache.contains_key(&cell_id)
                    && !already_evaluated.contains(&cell_id)
                    && !blocker_set.contains(&cell_id)
                {
                    blocker_set.insert(cell_id);
                    blockers.push(cell_id);
                }
            }
        }

        // Pass 2: Transitive upstream closure — BFS from all blockers through
        // `get_precedents` to find every unevaluated formula cell upstream. This
        // ensures that dynamic array spill sources, their own dependencies, and
        // any other upstream formulas are included so the agg prepass can
        // evaluate the full dependency chain in correct order.
        if !blockers.is_empty() {
            const MAX_CLOSURE_SIZE: usize = 10_000;
            let mut queue = std::collections::VecDeque::with_capacity(blockers.len());
            for &cid in &blockers {
                queue.push_back(cid);
            }

            while let Some(cell) = queue.pop_front() {
                if blocker_set.len() >= MAX_CLOSURE_SIZE {
                    break;
                }
                for dep in self.graph.get_precedents(&cell) {
                    match dep {
                        compute_graph::DepTarget::Cell(dep_id) => {
                            if ast_cache.contains_key(dep_id)
                                && !already_evaluated.contains(dep_id)
                                && blocker_set.insert(*dep_id)
                            {
                                blockers.push(*dep_id);
                                queue.push_back(*dep_id);
                            }
                        }
                        compute_graph::DepTarget::Range(range, _) => {
                            let Some(sh) = mirror.get_sheet(&range.sheet()) else {
                                continue;
                            };
                            let clamped_end = if range.end_row() == u32::MAX {
                                sh.rows
                            } else {
                                range.end_row().min(sh.rows)
                            };
                            for col in range.start_col()..=range.end_col() {
                                for row in range.start_row()..clamped_end {
                                    if let Some(dep_id) = mirror
                                        .resolve_cell_id(&range.sheet(), SheetPos::new(row, col))
                                        && ast_cache.contains_key(&dep_id)
                                        && !already_evaluated.contains(&dep_id)
                                        && blocker_set.insert(dep_id)
                                    {
                                        blockers.push(dep_id);
                                        queue.push_back(dep_id);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        blockers
    }

    /// Find which sheet a cell belongs to (O(1) via reverse index).
    pub(super) fn find_sheet_for_cell(
        &self,
        mirror: &CellMirror,
        cell_id: &CellId,
    ) -> Option<SheetId> {
        mirror.sheet_for_cell(cell_id)
    }

    /// Create a CellChange for IPC serialization.
    pub(super) fn make_cell_change(
        &self,
        mirror: &CellMirror,
        cell_id: &CellId,
        value: &CellValue,
    ) -> Option<(SheetId, CellChange)> {
        let sheet_id = self.find_sheet_for_cell(mirror, cell_id)?;
        // Resolve position from mirror; `None` when unavailable.
        let position = mirror
            .resolve_position(cell_id)
            .map(|pos| snapshot_types::CellPosition {
                row: pos.row(),
                col: pos.col(),
            });
        Some((
            sheet_id,
            CellChange {
                cell_id: cell_id.to_uuid_string(),
                sheet_id: sheet_id.to_uuid_string(),
                position,
                value: value.clone(),
                display_text: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ))
    }

    /// Initialize recalc metrics with dependency graph stats.
    fn init_recalc_metrics(&self) -> RecalcMetrics {
        let mut metrics = RecalcMetrics::default();
        let stats = self.graph.dep_edge_stats();
        metrics.total_dep_edges = stats.total_edges;
        metrics.max_deps_per_cell = stats.max_deps_per_cell;
        metrics
    }

    /// Track HashMap capacity grows and insert counts (Task 1.5f).
    fn track_capacity_metrics(&self, metrics: &mut RecalcMetrics, ast_cap_before: usize) {
        let ast_cap_after = self.ast_cache.capacity();
        if ast_cap_after > ast_cap_before {
            let mut cap = ast_cap_before.max(1);
            while cap < ast_cap_after {
                metrics.hashmap_capacity_grows += 1;
                cap *= 2;
            }
        }
        metrics.hashmap_inserts = self.ast_cache.len() as u64;
    }

    /// Surface existing CacheCounters from WorkbookCache into metrics (Task 1.5d).
    #[allow(unused_variables)]
    fn collect_cache_metrics(&self, metrics: &mut RecalcMetrics) {
        #[cfg(feature = "native")]
        {
            let cache_snap = self.workbook_cache.stats_snapshot();
            metrics.cache_hits = cache_snap.sorted.hits
                + cache_snap.frequency_count.hits
                + cache_snap.frequency_sum.hits
                + cache_snap.bitmask.hits
                + cache_snap.lookup.hits;
            metrics.cache_misses = cache_snap.sorted.misses
                + cache_snap.frequency_count.misses
                + cache_snap.frequency_sum.misses
                + cache_snap.bitmask.misses
                + cache_snap.lookup.misses;
            metrics.cache_rebuilds = cache_snap.sorted.rebuilds
                + cache_snap.frequency_count.rebuilds
                + cache_snap.frequency_sum.rebuilds
                + cache_snap.bitmask.rebuilds
                + cache_snap.lookup.rebuilds;
            metrics.cache_evictions = cache_snap.sorted.evictions
                + cache_snap.frequency_count.evictions
                + cache_snap.frequency_sum.evictions
                + cache_snap.bitmask.evictions
                + cache_snap.lookup.evictions;
        }
    }

    /// Build the final RecalcResult from accumulated changes and metrics.
    fn build_recalc_result(
        changed_cells: Vec<CellChange>,
        projection_changes: Vec<ProjectionChange>,
        errors: Vec<CellErrorInfo>,
        metrics: RecalcMetrics,
    ) -> RecalcResult {
        RecalcResult {
            changed_cells,
            projection_changes,
            errors,
            validation_annotations: Vec::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
            metrics,
            old_values: HashMap::new(),
        }
    }
}

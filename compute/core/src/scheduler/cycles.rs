//! Cycle detection and iterative calculation for circular references.
//!
//! Two strategies based on the workbook's `iterative_calc` setting:
//!
//! - **OFF (default)**: Circular cells with no current/cached value are marked
//!   as circular-reference errors. Imported circular cells with cached values
//!   retain those values, and downstream dependents recalculate from them.
//!
//! - **ON**: Iterative convergence. Cycle cells are evaluated repeatedly
//!   until values converge (delta < max_change) or max_iterations is reached.
//!   This handles goal-seek and iterative financial models.
//!
//! In both cases, a "Circular reference detected" diagnostic is emitted for
//! every cycle cell so callers can surface it to the user.

use super::*;
use crate::eval::Evaluator;
use crate::eval_bridge::MirrorContext;

/// Result from iterative cycle evaluation, carrying convergence metadata.
pub(super) struct IterativeResult {
    pub converged: bool,
    pub iterations: u32,
    pub max_delta: f64,
}

impl ComputeCore {
    /// Handle cycles: either evaluate iteratively or surface circular errors.
    pub(super) fn handle_cycles_and_recalc(
        &mut self,
        mirror: &mut CellMirror,
        cycles: Vec<Vec<CellId>>,
        deadline: &super::recalc::Deadline,
    ) -> Result<RecalcResult, ComputeError> {
        self.begin_sumifs_cache_epoch();
        // Clear thread-local caches to prevent stale entries from a prior recalc
        // session leaking into cycle iteration.
        compute_functions::helpers::sorted_cache::clear();
        compute_functions::helpers::frequency_cache::clear();
        compute_functions::helpers::bitmask_cache::clear();
        compute_functions::helpers::column_index::clear();
        compute_functions::helpers::sumifs_result_cache::clear();
        crate::eval::cache::subexpr_cache::clear();
        crate::mirror::clear_caches();

        let mut cycle_cell_set = FxHashSet::default();
        for cycle in &cycles {
            for cell_id in cycle {
                cycle_cell_set.insert(*cell_id);
            }
        }

        let mut changed_cells = Vec::new();
        let mut errors = Vec::new();

        // Build optimal evaluation order within the cycle SCC using a local
        // topological sort (Kahn's algorithm on the subgraph of cycle cells).
        //
        // The naive approach sorted by (sheet_tab_index, row, col), but this
        // caused cells to see seeded 0-values for forward references that happen
        // to have higher row numbers. For example, J41 = J113 would evaluate
        // before J113, seeing 0 instead of J113's actual value.
        //
        // The local topo sort respects as many dependency edges as possible
        // within the SCC. Only actual back-edges (the ones that close the cycle)
        // will see seeded values. This dramatically reduces cascading errors.
        let cycle_cells = self.local_topo_sort_cycle_cells(&*mirror, &cycle_cell_set);

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::RecalcStart {
                mode: "cycles",
                total_formula_cells: self.ast_cache.len() as u32,
            });
            // Sentinel CellId(0) is acceptable here: this journal entry logs aggregate
            // cycle metadata, not per-cell data. The cell field is a representative
            // sample and the collection is never empty at this point (we only enter
            // cycle handling when cycles exist).
            crate::journal::record(crate::journal::JournalEvent::Decision {
                cell: cycle_cells.first().copied().unwrap_or(CellId::from_raw(0)),
                point: "cycles_detected",
                condition: format!(
                    "cycle_cells={}, non_cycle_cells={}, iterative_calc={}",
                    cycle_cells.len(),
                    self.ast_cache.len() - cycle_cells.len(),
                    self.iterative_calc
                ),
                path: if self.iterative_calc {
                    "iterative"
                } else {
                    "circular_error"
                },
            });
        }

        // --- Pass 1: Evaluate non-cycle PREDECESSOR formula cells ---
        //
        // Non-cycle cells that feed into cycles (e.g., a chain E1→D1→C1 where C1
        // is referenced by a cycle cell) must be evaluated BEFORE the cycle iteration.
        // Otherwise cycle cells see stale/seed values for their non-cycle inputs.
        //
        // Strategy: evaluate ALL non-cycle cells first. Non-cycle cells by definition
        // don't depend on cycle cells, so they compute correctly with whatever values
        // are currently in the mirror. After cycle evaluation, we re-evaluate any
        // non-cycle cells that are DOWNSTREAM of cycles (dependents).

        let all_formula_cells: FxHashSet<CellId> = self.ast_cache.keys().copied().collect();
        let non_cycle: FxHashSet<CellId> = all_formula_cells
            .difference(&cycle_cell_set)
            .copied()
            .collect();

        let non_cycle_eval_order = {
            let _span =
                tracing::info_span!("cycles_predecessor_eval", non_cycle_count = non_cycle.len())
                    .entered();
            let order = self
                .graph
                .affected_cells(&non_cycle.iter().copied().collect::<Vec<_>>(), &*mirror)
                .into_value();
            order
                .into_iter()
                .filter(|c| non_cycle.contains(c) && self.ast_cache.contains_key(c))
                .collect::<Vec<CellId>>()
        };

        // Clear caches before predecessor evaluation.
        compute_functions::helpers::sorted_cache::clear();
        compute_functions::helpers::frequency_cache::clear();
        compute_functions::helpers::bitmask_cache::clear();
        compute_functions::helpers::column_index::clear();
        compute_functions::helpers::sumifs_result_cache::clear();
        crate::eval::cache::subexpr_cache::clear();
        crate::mirror::clear_caches();

        let mut epoch_range_store = crate::eval::cache::range_store::RangeStore::new();
        let mut cycle_metrics = RecalcMetrics::default();

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::Decision {
                cell: non_cycle_eval_order
                    .first()
                    .copied()
                    .unwrap_or(CellId::from_raw(0)),
                point: "non_cycle_predecessor_eval",
                condition: format!("non_cycle_formula_cells={}", non_cycle_eval_order.len()),
                path: "topo_evaluate_pass",
            });
        }

        let mut all_projection_changes = Vec::new();
        let mut all_projection_deltas = Vec::new();

        let (pre_changes, pre_projections, pre_errors, pre_proj_deltas, pre_nested_cycles) = self
            .topo_evaluate_pass(
            mirror,
            &non_cycle_eval_order,
            deadline,
            &mut epoch_range_store,
            &mut cycle_metrics,
        )?;
        changed_cells.extend(pre_changes);
        errors.extend(pre_errors);
        all_projection_changes.extend(pre_projections);
        all_projection_deltas.extend(pre_proj_deltas);

        // Handle nested cycles from predecessor pass
        if !pre_nested_cycles.is_empty() {
            let extra: Vec<CellId> = pre_nested_cycles
                .into_iter()
                .filter(|c| !cycle_cell_set.contains(c))
                .collect();
            for &c in &extra {
                cycle_cell_set.insert(c);
            }
        }

        let cycle_dependents: Vec<CellId> = {
            let downstream = self
                .graph
                .affected_cells(
                    &cycle_cell_set.iter().copied().collect::<Vec<_>>(),
                    &*mirror,
                )
                .into_value();
            downstream
                .into_iter()
                .filter(|c| non_cycle.contains(c) && self.ast_cache.contains_key(c))
                .collect()
        };

        // --- Pass 2: Resolve cycle cells ---
        //
        // Iterative calculation ON: seed non-numeric cycle values to 0 and run
        // the fixed-point solver.
        //
        // Iterative calculation OFF in a mutation-driven partial recalc:
        // materialize every cycle member as a circular error. The cached-value
        // preservation contract is intentionally kept on the full-recalc import
        // path below; values produced earlier in the same editing session are
        // not imported Excel caches and must not mask a newly-created cycle.
        let mut iterative_result: Option<IterativeResult> = None;
        if self.iterative_calc {
            let iteration_cells =
                self.iteration_cells_for_cycles(&cycle_cells, &cycle_cell_set, &cycle_dependents);
            Self::seed_cycle_cells_for_iteration(mirror, &cycle_cells);
            iterative_result =
                Some(self.evaluate_cycles_iterative(mirror, &iteration_cells, deadline)?);
            self.replace_final_changes_for_cells(
                mirror,
                &mut changed_cells,
                &iteration_cells,
                &cycle_cell_set,
            );
        } else {
            Self::materialize_cycle_cells_as_circular_errors(mirror, &cycle_cells);
        }

        // Collect final values from cycle cells. Mark genuinely unresolvable
        // cycles (still Null after evaluation) as #CIRC errors. Emit a
        // diagnostic for every cycle cell.
        for &cell_id in &cycle_cells {
            let computed = mirror
                .get_cell_value(&cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            let final_value = if matches!(computed, CellValue::Null) {
                CellValue::Error(CellError::Circ, None)
            } else {
                computed
            };
            if let Some(sid) = self.find_sheet_for_cell(mirror, &cell_id) {
                errors.push(CellErrorInfo {
                    cell_id: cell_id.to_uuid_string(),
                    sheet_id: sid.to_uuid_string(),
                    error: "Circular reference detected".to_string(),
                });
            }
            if let Some((_sid, change)) = self.make_cell_change(mirror, &cell_id, &final_value) {
                changed_cells.push(change);
            }
        }

        // --- Pass 3: Re-evaluate non-cycle DEPENDENTS of cycles ---
        //
        // Non-cycle cells downstream of cycles may have computed stale values
        // during pass 1 (they saw seed/0 for cycle cells). Re-evaluate them
        // now that cycle cells have converged.

        // Clear caches before dependent re-evaluation.
        compute_functions::helpers::sorted_cache::clear();
        compute_functions::helpers::frequency_cache::clear();
        compute_functions::helpers::bitmask_cache::clear();
        compute_functions::helpers::column_index::clear();
        compute_functions::helpers::sumifs_result_cache::clear();
        crate::eval::cache::subexpr_cache::clear();
        crate::mirror::clear_caches();

        if !cycle_dependents.is_empty() {
            let (dep_changes, dep_projections, dep_errors, dep_proj_deltas, dep_nested_cycles) =
                self.topo_evaluate_pass(
                    mirror,
                    &cycle_dependents,
                    deadline,
                    &mut epoch_range_store,
                    &mut cycle_metrics,
                )?;

            // Dependent results supersede pass 1 results for the same cells.
            if !dep_changes.is_empty() {
                let dep_ids: FxHashSet<&str> =
                    dep_changes.iter().map(|c| c.cell_id.as_str()).collect();
                changed_cells.retain(|c| !dep_ids.contains(c.cell_id.as_str()));
                changed_cells.extend(dep_changes);
            }
            errors.extend(dep_errors);
            all_projection_changes.extend(dep_projections);
            all_projection_deltas.extend(dep_proj_deltas);

            if !dep_nested_cycles.is_empty() {
                let extra: Vec<CellId> = dep_nested_cycles
                    .into_iter()
                    .filter(|c| !cycle_cell_set.contains(c))
                    .collect();
                if !extra.is_empty() {
                    for &c in &extra {
                        cycle_cell_set.insert(c);
                    }
                    for &cell_id in &extra {
                        let current = mirror
                            .get_cell_value(&cell_id)
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        if matches!(current, CellValue::Null) {
                            mirror.set_value_mut(&cell_id, CellValue::number(0.0));
                        }
                    }
                    let all_cycle_cells: Vec<CellId> = cycle_cell_set.iter().copied().collect();
                    if self.iterative_calc {
                        let iteration_cells = self.iteration_cells_for_cycles(
                            &all_cycle_cells,
                            &cycle_cell_set,
                            &cycle_dependents,
                        );
                        Self::seed_cycle_cells_for_iteration(mirror, &all_cycle_cells);
                        let extra_result =
                            self.evaluate_cycles_iterative(mirror, &iteration_cells, deadline)?;
                        iterative_result = Some(extra_result);
                        self.replace_final_changes_for_cells(
                            mirror,
                            &mut changed_cells,
                            &iteration_cells,
                            &cycle_cell_set,
                        );
                    } else {
                        Self::materialize_cycle_cells_as_circular_errors(mirror, &all_cycle_cells);
                    }
                }
            }
        }

        // Projection stabilization
        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::Decision {
                cell: CellId::from_raw(0),
                point: "projection_stabilize_check",
                condition: format!("projection_deltas={}", all_projection_deltas.len()),
                path: if all_projection_deltas.is_empty() {
                    "skip"
                } else {
                    "run"
                },
            });
        }

        let mut merged_projection_changes = all_projection_changes;
        if !all_projection_deltas.is_empty() {
            let (stab_changes, stab_projection_changes, stab_errors) = self.projection_stabilize(
                mirror,
                &all_projection_deltas,
                deadline,
                0,
                &mut epoch_range_store,
            )?;
            changed_cells.extend(stab_changes);
            merged_projection_changes.extend(stab_projection_changes);
            errors.extend(stab_errors);
        }

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::RecalcEnd {
                changed_count: changed_cells.len() as u32,
                projection_delta_count: all_projection_deltas.len() as u32,
            });
        }

        let mut metrics = RecalcMetrics {
            has_circular_refs: true,
            circular_cell_count: cycle_cell_set.len() as u32,
            ..RecalcMetrics::default()
        };
        if let Some(ref ir) = iterative_result {
            metrics.iterative_converged = ir.converged;
            metrics.iterative_iterations = ir.iterations;
            // `IterativeResult.max_delta` may be `f64::INFINITY` (sentinel for
            // non-numeric cycle cells). FiniteF64::new maps that to None,
            // which is the correct boundary signal — there is no defined
            // numeric delta for a cycle of strings.
            metrics.iterative_max_delta = value_types::FiniteF64::new(ir.max_delta);
        }

        Ok(RecalcResult {
            changed_cells,
            projection_changes: merged_projection_changes,
            errors,
            validation_annotations: Vec::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
            metrics,
            old_values: std::collections::HashMap::new(),
        })
    }

    /// Handle cycles using pre-computed topo levels from `evaluation_levels_full`.
    ///
    /// Avoids redundant `affected_cells` + `barrier_topo` calls by reusing
    /// the non-cycle levels (pass 1 predecessors) and downstream levels
    /// (pass 3 dependents) already computed by the initial topo sort.
    pub(super) fn handle_cycles_with_precomputed_levels(
        &mut self,
        mirror: &mut CellMirror,
        predecessor_levels: Vec<Vec<CellId>>,
        cycle_cores: Vec<Vec<CellId>>,
        downstream_levels: Vec<Vec<CellId>>,
        deadline: &super::recalc::Deadline,
    ) -> Result<RecalcResult, ComputeError> {
        self.begin_sumifs_cache_epoch();
        super::recalc::clear_thread_local_caches();

        let mut cycle_cell_set = FxHashSet::default();
        for cycle in &cycle_cores {
            for cell_id in cycle {
                cycle_cell_set.insert(*cell_id);
            }
        }

        let mut changed_cells = Vec::new();
        let mut errors = Vec::new();

        let cycle_cells = self.local_topo_sort_cycle_cells(&*mirror, &cycle_cell_set);

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::RecalcStart {
                mode: "cycles",
                total_formula_cells: self.ast_cache.len() as u32,
            });
            crate::journal::record(crate::journal::JournalEvent::Decision {
                cell: cycle_cells.first().copied().unwrap_or(CellId::from_raw(0)),
                point: "cycles_detected",
                condition: format!(
                    "cycle_cells={}, non_cycle_cells={}, iterative_calc={}",
                    cycle_cells.len(),
                    self.ast_cache.len() - cycle_cells.len(),
                    self.iterative_calc
                ),
                path: if self.iterative_calc {
                    "iterative"
                } else {
                    "circular_error"
                },
            });
        }

        // --- Pass 1: Evaluate non-cycle PREDECESSOR formula cells ---
        // Use the pre-computed levels from evaluation_levels_full instead of
        // recomputing via affected_cells (saves 2 barrier_topo calls).
        let predecessor_levels: Vec<Vec<CellId>> = predecessor_levels
            .into_iter()
            .map(|level| {
                level
                    .into_iter()
                    .filter(|c| !cycle_cell_set.contains(c) && self.ast_cache.contains_key(c))
                    .collect::<Vec<_>>()
            })
            .filter(|level: &Vec<CellId>| !level.is_empty())
            .collect();

        super::recalc::clear_thread_local_caches();

        let mut epoch_range_store = crate::eval::cache::range_store::RangeStore::new();
        let mut cycle_metrics = RecalcMetrics::default();

        let mut all_projection_changes = Vec::new();
        let mut all_projection_deltas = Vec::new();

        let predecessor_result = self.topo_evaluate_pass_with_levels(
            mirror,
            predecessor_levels,
            deadline,
            &mut epoch_range_store,
            &mut cycle_metrics,
        )?;
        changed_cells.extend(predecessor_result.0);
        all_projection_changes.extend(predecessor_result.1);
        errors.extend(predecessor_result.2);
        all_projection_deltas.extend(predecessor_result.3);

        let downstream_levels: Vec<Vec<CellId>> = downstream_levels
            .into_iter()
            .map(|level| {
                level
                    .into_iter()
                    .filter(|c| !cycle_cell_set.contains(c) && self.ast_cache.contains_key(c))
                    .collect::<Vec<_>>()
            })
            .filter(|level: &Vec<CellId>| !level.is_empty())
            .collect();
        let downstream_cells: Vec<CellId> = downstream_levels
            .iter()
            .flat_map(|level| level.iter().copied())
            .collect();

        // --- Pass 2: Resolve cycle cells ---
        let mut iterative_result: Option<IterativeResult> = None;
        if self.iterative_calc {
            let iteration_cells =
                self.iteration_cells_for_cycles(&cycle_cells, &cycle_cell_set, &downstream_cells);
            Self::seed_cycle_cells_for_iteration(mirror, &cycle_cells);
            iterative_result =
                Some(self.evaluate_cycles_iterative(mirror, &iteration_cells, deadline)?);
            self.replace_final_changes_for_cells(
                mirror,
                &mut changed_cells,
                &iteration_cells,
                &cycle_cell_set,
            );
        } else {
            Self::materialize_blank_cycle_cells_as_circular_errors(mirror, &cycle_cells);
        }

        for &cell_id in &cycle_cells {
            let computed = mirror
                .get_cell_value(&cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            let final_value = if matches!(computed, CellValue::Null) {
                CellValue::Error(CellError::Circ, None)
            } else {
                computed
            };
            if let Some(sid) = self.find_sheet_for_cell(mirror, &cell_id) {
                errors.push(CellErrorInfo {
                    cell_id: cell_id.to_uuid_string(),
                    sheet_id: sid.to_uuid_string(),
                    error: "Circular reference detected".to_string(),
                });
            }
            if let Some((_sid, change)) = self.make_cell_change(mirror, &cell_id, &final_value) {
                changed_cells.push(change);
            }
        }

        // --- Pass 3: Evaluate downstream dependents of cycles ---
        // Use pre-computed downstream levels instead of recomputing via
        // affected_cells (saves 2 more barrier_topo calls).
        super::recalc::clear_thread_local_caches();

        if !downstream_levels.is_empty() {
            let downstream_result = self.topo_evaluate_pass_with_levels(
                mirror,
                downstream_levels,
                deadline,
                &mut epoch_range_store,
                &mut cycle_metrics,
            )?;

            if !downstream_result.0.is_empty() {
                let dep_ids: FxHashSet<&str> = downstream_result
                    .0
                    .iter()
                    .map(|c| c.cell_id.as_str())
                    .collect();
                changed_cells.retain(|c| !dep_ids.contains(c.cell_id.as_str()));
                changed_cells.extend(downstream_result.0);
            }
            errors.extend(downstream_result.2);
            all_projection_changes.extend(downstream_result.1);
            all_projection_deltas.extend(downstream_result.3);
        }

        // Selective dep fixup pass — use changed-positions filter to avoid
        // re-evaluating selective deps whose ranges didn't change.
        if !super::recalc::past_deadline(deadline) {
            let changed_index = {
                let mut idx: rustc_hash::FxHashMap<(cell_types::SheetId, u32), Vec<u32>> =
                    rustc_hash::FxHashMap::default();
                for change in &changed_cells {
                    if let (Ok(sid), Some(pos)) = (
                        cell_types::SheetId::from_uuid_str(&change.sheet_id),
                        change.position.as_ref(),
                    ) {
                        idx.entry((sid, pos.col)).or_default().push(pos.row);
                    }
                }
                for rows in idx.values_mut() {
                    rows.sort_unstable();
                }
                idx
            };
            let (fixup_changes, fixup_proj, fixup_errors) = self.selective_dep_fixup_pass(
                mirror,
                &mut epoch_range_store,
                &mut cycle_metrics,
                None,
                Some(&changed_index),
            );
            changed_cells.extend(fixup_changes);
            all_projection_changes.extend(fixup_proj);
            errors.extend(fixup_errors);
        }

        // Projection stabilization
        let mut merged_projection_changes = all_projection_changes;
        if !all_projection_deltas.is_empty() {
            let (stab_changes, stab_projection_changes, stab_errors) = self.projection_stabilize(
                mirror,
                &all_projection_deltas,
                deadline,
                0,
                &mut epoch_range_store,
            )?;
            changed_cells.extend(stab_changes);
            merged_projection_changes.extend(stab_projection_changes);
            errors.extend(stab_errors);
        }

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::RecalcEnd {
                changed_count: changed_cells.len() as u32,
                projection_delta_count: all_projection_deltas.len() as u32,
            });
        }

        let mut metrics = RecalcMetrics {
            has_circular_refs: true,
            circular_cell_count: cycle_cell_set.len() as u32,
            ..RecalcMetrics::default()
        };
        if let Some(ref ir) = iterative_result {
            metrics.iterative_converged = ir.converged;
            metrics.iterative_iterations = ir.iterations;
            metrics.iterative_max_delta = value_types::FiniteF64::new(ir.max_delta);
        }

        Ok(RecalcResult {
            changed_cells,
            projection_changes: merged_projection_changes,
            errors,
            validation_annotations: Vec::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
            metrics,
            old_values: std::collections::HashMap::new(),
        })
    }

    fn seed_cycle_cells_for_iteration(mirror: &mut CellMirror, cycle_cells: &[CellId]) {
        for &cell_id in cycle_cells {
            let current = mirror
                .get_cell_value(&cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            let should_reset = matches!(current, CellValue::Null | CellValue::Error(_, _))
                || matches!(&current, CellValue::Text(_) | CellValue::Boolean(_));
            if should_reset {
                mirror.set_value_mut(&cell_id, CellValue::number(0.0));
            }
        }
    }

    fn materialize_blank_cycle_cells_as_circular_errors(
        mirror: &mut CellMirror,
        cycle_cells: &[CellId],
    ) {
        for &cell_id in cycle_cells {
            let current = mirror
                .get_cell_value(&cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            if matches!(current, CellValue::Null) {
                mirror.set_value_mut(&cell_id, CellValue::Error(CellError::Circ, None));
            }
        }
    }

    fn materialize_cycle_cells_as_circular_errors(mirror: &mut CellMirror, cycle_cells: &[CellId]) {
        for &cell_id in cycle_cells {
            mirror.set_value_mut(&cell_id, CellValue::Error(CellError::Circ, None));
        }
    }

    fn seed_error_cells_for_iteration(mirror: &mut CellMirror, cycle_cells: &[CellId]) {
        for &cell_id in cycle_cells {
            let current = mirror
                .get_cell_value(&cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            if matches!(current, CellValue::Error(_, _)) {
                mirror.set_value_mut(&cell_id, CellValue::number(0.0));
            }
        }
    }

    /// Build an optimal evaluation order for cycle cells using a local
    /// topological sort (Kahn's algorithm) on the subgraph restricted to cycle
    /// members.
    ///
    /// For cells within a cycle SCC, most edges are forward edges — only a few
    /// back-edges actually close the cycle. By doing a local topo sort, we
    /// evaluate cells in dependency order wherever possible. Only cells involved
    /// in actual back-edges will see seeded (0) values.
    ///
    /// Cells that remain after Kahn's exhausts zero-in-degree nodes (the true
    /// cycle core) are appended in sheet-tab order as a fallback.
    fn local_topo_sort_cycle_cells(
        &self,
        mirror: &CellMirror,
        cycle_cell_set: &FxHashSet<CellId>,
    ) -> Vec<CellId> {
        use std::collections::VecDeque;

        let n = cycle_cell_set.len();

        // Build a local adjacency + in-degree map restricted to cycle cells.
        // For each cycle cell, look at its precedents (what it depends on).
        // If a precedent is also a cycle cell, that's a local edge.
        let mut in_degree: FxHashMap<CellId, usize> =
            FxHashMap::with_capacity_and_hasher(n, Default::default());
        // local_dependents: within the SCC, who depends on this cell?
        let mut local_dependents: FxHashMap<CellId, Vec<CellId>> =
            FxHashMap::with_capacity_and_hasher(n, Default::default());

        for &cell in cycle_cell_set {
            in_degree.entry(cell).or_insert(0);
        }

        for &cell in cycle_cell_set {
            for dep in self.graph.get_precedents(&cell) {
                // Only follow DepTarget::Cell edges for the local topo sort.
                // DepTarget::Range edges are coarse-grained (e.g., whole-column
                // references like INDEX('Sheet'!E:E,...)) and create O(N*M) false
                // edges between all cells in both sheets, collapsing the local
                // topo sort into a single cycle. By ignoring range deps here, we
                // preserve the fine-grained cell-to-cell ordering that matters
                // most (e.g., J41 = J113 correctly orders J113 before J41).
                if let DepTarget::Cell(dep_cell) = dep
                    && cycle_cell_set.contains(dep_cell)
                {
                    *in_degree.entry(cell).or_insert(0) += 1;
                    local_dependents.entry(*dep_cell).or_default().push(cell);
                }
            }
        }

        // Kahn's algorithm: process zero-in-degree cells first
        let mut queue: VecDeque<CellId> = VecDeque::new();
        // Seed the queue with cells that have no in-SCC dependencies.
        // Sort them by sheet tab order for determinism.
        let mut zero_deg: Vec<CellId> = in_degree
            .iter()
            .filter(|(_, deg)| **deg == 0)
            .map(|(&cell, _)| cell)
            .collect();
        self.sort_cells_by_tab_order(mirror, &mut zero_deg);
        for cell in zero_deg {
            queue.push_back(cell);
        }

        let mut result = Vec::with_capacity(n);

        while let Some(cell) = queue.pop_front() {
            result.push(cell);
            if let Some(deps) = local_dependents.get(&cell) {
                // Collect newly-ready cells and sort for determinism before enqueuing.
                let mut newly_ready = Vec::new();
                for &dep in deps {
                    if let Some(deg) = in_degree.get_mut(&dep) {
                        *deg -= 1;
                        if *deg == 0 {
                            newly_ready.push(dep);
                        }
                    }
                }
                if newly_ready.len() > 1 {
                    self.sort_cells_by_tab_order(mirror, &mut newly_ready);
                }
                for cell in newly_ready {
                    queue.push_back(cell);
                }
            }
        }

        // Any remaining cells (in-degree > 0) are part of the true cycle core.
        // Append them in sheet tab order as fallback.
        if result.len() < n {
            let mut remaining: Vec<CellId> = in_degree
                .iter()
                .filter(|(_, deg)| **deg > 0)
                .map(|(&cell, _)| cell)
                .collect();
            self.sort_cells_by_tab_order(mirror, &mut remaining);
            result.extend(remaining);
        }

        result
    }

    /// Sort cells by (sheet_tab_index, row, col) for deterministic ordering.
    fn sort_cells_by_tab_order(&self, mirror: &CellMirror, cells: &mut [CellId]) {
        let sheet_order_ref = &self.sheet_order;
        cells.sort_by(|a, b| {
            let pos_a = mirror
                .sheet_for_cell(a)
                .and_then(|sid| mirror.get_sheet(&sid).map(|sh| (sid, sh)))
                .and_then(|(sid, sh)| {
                    let tab_idx = sheet_order_ref.get(&sid).copied().unwrap_or(usize::MAX);
                    sh.position_of(a).map(|p| (tab_idx, p.row(), p.col()))
                });
            let pos_b = mirror
                .sheet_for_cell(b)
                .and_then(|sid| mirror.get_sheet(&sid).map(|sh| (sid, sh)))
                .and_then(|(sid, sh)| {
                    let tab_idx = sheet_order_ref.get(&sid).copied().unwrap_or(usize::MAX);
                    sh.position_of(b).map(|p| (tab_idx, p.row(), p.col()))
                });
            match (pos_a, pos_b) {
                (Some(pa), Some(pb)) => pa.cmp(&pb),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.as_u128().cmp(&b.as_u128()),
            }
        });
    }

    /// Iterative evaluation: evaluate cycle cells repeatedly until convergence.
    ///
    /// Used when the workbook has iterative calculation enabled. Cells are
    /// evaluated up to max_iterations times, checking convergence (max_delta
    /// < max_change) after each pass. Includes plateau detection to exit
    /// early when values stop changing.
    fn evaluate_cycles_iterative(
        &mut self,
        mirror: &mut CellMirror,
        cycle_cells: &[CellId],
        _deadline: &super::recalc::Deadline,
    ) -> Result<IterativeResult, ComputeError> {
        let mut prev_max_delta: f64 = f64::MAX;
        let mut stall_count: u32 = 0;
        const STALL_TOLERANCE: f64 = 1e-10;
        const MAX_STALLS: u32 = 3;

        let mut iteration_count: u32 = 0;
        let mut converged = false;

        // Split deadline: the iterative phase gets at most half the total
        // budget so that the topo pass is guaranteed the other half.
        let iterative_deadline = super::recalc::make_deadline(self.recalc_timeout / 2);

        for _iteration in 0..self.max_iterations {
            iteration_count += 1;
            if super::recalc::past_deadline(&iterative_deadline) {
                tracing::warn!("iterative phase budget exceeded, yielding to topo pass");
                break;
            }

            // Clear thread-local caches between iterations — caches from
            // iteration N become stale in iteration N+1 as cell values change.
            compute_functions::helpers::sorted_cache::clear();
            compute_functions::helpers::frequency_cache::clear();
            compute_functions::helpers::bitmask_cache::clear();
            compute_functions::helpers::column_index::clear();
            compute_functions::helpers::sumifs_result_cache::clear();
            crate::eval::cache::subexpr_cache::clear();
            crate::mirror::clear_caches();

            Self::seed_error_cells_for_iteration(mirror, cycle_cells);

            let mut max_delta: f64 = 0.0;

            for &cell_id in cycle_cells {
                let ast = match self.ast_cache.get(&cell_id) {
                    Some(entry) => entry.ast.clone(),
                    None => continue,
                };

                let sheet_id = match self.find_sheet_for_cell(mirror, &cell_id) {
                    Some(sid) => sid,
                    None => continue,
                };

                let old_value = mirror
                    .get_cell_value(&cell_id)
                    .cloned()
                    .unwrap_or(CellValue::Null);

                let mut ctx = MirrorContext::new(mirror, cell_id, sheet_id)
                    .with_sumifs_cache_epoch(self.current_sumifs_cache_epoch());
                ctx.access.formula_text_provider = self.formula_text_provider();
                #[cfg(feature = "native")]
                {
                    ctx.workbook_cache = Some(&self.workbook_cache);
                }
                let mut new_value =
                    match crate::eval::sync_block_on(Evaluator::evaluate(&ast, &ctx, &ctx)) {
                        Ok(val) => val,
                        Err(_) => continue,
                    };

                // Excel coercion: a formula whose final result is Null produces Number(0).
                if matches!(new_value, CellValue::Null) {
                    new_value = CellValue::number(0.0);
                }

                // Calculate delta — only numeric convergence counts.
                // Number↔Number: absolute difference (the only convergent case).
                // Any non-numeric value (Text, Error, Bool, Null): infinity.
                // Excel's iterative calculation only considers numeric fixed
                // points as convergence. Non-numeric stable states (e.g., a
                // cycle that oscillates then settles on text "big") must NOT
                // be reported as converged — they run to the iteration cap.
                let delta = match (&old_value, &new_value) {
                    (CellValue::Number(old_n), CellValue::Number(new_n)) => {
                        (new_n.get() - old_n.get()).abs()
                    }
                    _ => {
                        // Any non-numeric involvement means non-convergent
                        f64::INFINITY
                    }
                };
                if delta > max_delta {
                    max_delta = delta;
                }

                mirror.set_value_mut(&cell_id, new_value);
            }

            // Plateau detection — only trigger when delta is already small
            // (< 1.0). Without this guard, seeding from 0.0 can produce a
            // huge initial delta (e.g., 1e10) that stays constant across
            // iterations, falsely triggering the plateau exit.
            if max_delta < 1.0 && (prev_max_delta - max_delta).abs() < STALL_TOLERANCE {
                stall_count += 1;
            } else {
                stall_count = 0;
            }
            prev_max_delta = max_delta;

            #[cfg(feature = "journal")]
            {
                let path = if max_delta < self.max_change {
                    "converged"
                } else if stall_count >= MAX_STALLS {
                    "plateau_exit"
                } else {
                    "continue"
                };
                // Sentinel CellId(0) is acceptable here: journal-only context logging
                // convergence metadata. The cell is a representative sample; cycle_cells
                // is never empty inside the iterative convergence loop.
                crate::journal::record(crate::journal::JournalEvent::Decision {
                    cell: cycle_cells.first().copied().unwrap_or(CellId::from_raw(0)),
                    point: "iterative_convergence",
                    condition: format!(
                        "iteration={}, max_delta={:.6e}, threshold={:.6e}, stall_count={}",
                        _iteration, max_delta, self.max_change, stall_count
                    ),
                    path,
                });
            }

            if max_delta < self.max_change {
                converged = true;
                break;
            }

            if stall_count >= MAX_STALLS {
                tracing::info!(
                    iteration = _iteration,
                    max_delta,
                    "iterative solver plateau detected, exiting early"
                );
                break;
            }
        }

        Ok(IterativeResult {
            converged,
            iterations: iteration_count,
            max_delta: prev_max_delta,
        })
    }
}

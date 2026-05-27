use super::*;

impl ComputeCore {
    /// Fixup pass for selective range deps (hybrid Kahn's + deferral).
    ///
    /// Selective deps (INDEX, VLOOKUP, XLOOKUP, MATCH, etc.) have no range
    /// barriers in the barrier graph. They may have evaluated before some of
    /// their range's formula cells, reading stale/initial values. After the
    /// main evaluation pass, all cells have computed values. This pass
    /// re-evaluates only those selective dep cells whose range precedents
    /// include cells that CHANGED value during the main pass, then propagates.
    ///
    /// When `scope` is `Some`, only selective deps in the scope set are
    /// checked (incremental recalc — others retain correct prior values).
    /// When `None`, all selective deps are checked (full recalc).
    #[tracing::instrument(name = "selective_dep_fixup", skip_all)]
    pub(in super::super) fn selective_dep_fixup_pass(
        &mut self,
        mirror: &mut CellMirror,
        epoch_range_store: &mut crate::eval::cache::range_store::RangeStore,
        metrics: &mut RecalcMetrics,
        scope: Option<&FxHashSet<CellId>>,
        changed_positions: Option<&FxHashMap<(SheetId, u32), Vec<u32>>>,
    ) -> (Vec<CellChange>, Vec<ProjectionChange>, Vec<CellErrorInfo>) {
        // When we have a changed-positions index from the main eval pass, only
        // fixup selective deps whose ranges overlap with cells that actually
        // changed value. This is much tighter than the formula-cell check:
        // in full recalc from XLSX, most formulas match the cached value, so
        // very few positions are "changed" and most selective deps can be skipped.
        //
        // Fallback: if no changed_positions provided, use the original check
        // that filters by ranges containing formula cells.
        let selective_cells = if let Some(changed_idx) = changed_positions {
            self.graph
                .selective_dep_cells_with_changed_ranges(changed_idx)
        } else {
            self.graph
                .selective_dep_cells_with_formula_ranges(&self.ast_cache, &*mirror)
        };
        if selective_cells.is_empty() {
            return (Vec::new(), Vec::new(), Vec::new());
        }

        // Filter to formula cells in ast_cache, and optionally to scope
        let fixup_cells: Vec<CellId> = selective_cells
            .iter()
            .filter(|c| self.ast_cache.contains_key(c) && scope.is_none_or(|s| s.contains(c)))
            .copied()
            .collect();

        if fixup_cells.is_empty() {
            return (Vec::new(), Vec::new(), Vec::new());
        }

        let _fixup_span = tracing::info_span!(
            "selective_dep_fixup",
            selective_count = fixup_cells.len(),
            changed_filter = changed_positions.is_some(),
            selective_candidates = selective_cells.len(),
        )
        .entered();

        // Pre-materialize ranges for these cells
        {
            let plan: crate::eval::cache::range_store::DataPlan = fixup_cells
                .iter()
                .filter_map(|cid| self.cell_range_keys.get(cid))
                .flat_map(|keys| keys.iter().copied())
                .collect();
            epoch_range_store.pre_materialize_additive(&plan, mirror);
        }

        // Re-evaluate selective deps using parallel evaluation for large sets
        let mut changed_cells = Vec::new();
        let mut projection_changes = Vec::new();
        let mut errors = Vec::new();
        let mut projection_deltas = Vec::new();

        #[cfg(feature = "native")]
        let use_parallel = fixup_cells.len() >= super::super::level_eval::PARALLEL_THRESHOLD;
        #[cfg(not(feature = "native"))]
        let use_parallel = false;

        if use_parallel {
            #[cfg(feature = "native")]
            {
                self.topo_evaluate_level_parallel(
                    mirror,
                    &fixup_cells,
                    &mut changed_cells,
                    &mut projection_changes,
                    &mut errors,
                    epoch_range_store,
                    &mut projection_deltas,
                    metrics,
                    &None,
                );
            }
        } else {
            self.topo_evaluate_level_sequential(
                mirror,
                &fixup_cells,
                &mut changed_cells,
                &mut projection_changes,
                &mut errors,
                epoch_range_store,
                &mut projection_deltas,
                metrics,
            );
        }

        // Only propagate if any selective dep actually changed value.
        // In full recalc from XLSX, most cells produce the same value as the
        // cached value, so the fixup rarely changes anything.
        if !changed_cells.is_empty() {
            let changed_ids: Vec<CellId> = changed_cells
                .iter()
                .filter_map(|c| CellId::from_uuid_str(&c.cell_id).ok())
                .collect();

            let dirty_positions: Vec<(SheetId, u32, u32)> = changed_cells
                .iter()
                .filter_map(|change| {
                    let sheet_id = SheetId::from_uuid_str(&change.sheet_id).ok()?;
                    let pos = change.position.as_ref()?;
                    Some((sheet_id, pos.row, pos.col))
                })
                .collect();
            if !dirty_positions.is_empty() {
                epoch_range_store.invalidate_dirty(&dirty_positions);
            }

            // Use lightweight cell-to-cell BFS to find direct dependents,
            // then topo-sort just those. Avoids the expensive collect_dirty_set +
            // barrier_topo calls that affected_cells performs on the full graph.
            let downstream: Vec<CellId> = {
                let mut visited = FxHashSet::default();
                let mut queue = std::collections::VecDeque::new();
                for &cid in &changed_ids {
                    if visited.insert(cid) {
                        queue.push_back(cid);
                    }
                }
                while let Some(cell) = queue.pop_front() {
                    for dep in self.graph.get_dependents(&cell) {
                        if visited.insert(*dep) {
                            queue.push_back(*dep);
                        }
                    }
                }
                visited
                    .into_iter()
                    .filter(|c| {
                        self.ast_cache.contains_key(c)
                            && !selective_cells.contains(c)
                            && !changed_ids.contains(c)
                            && mirror
                                .sheet_for_cell(c)
                                .is_none_or(|sid| mirror.is_calculation_enabled(&sid))
                    })
                    .collect()
            };

            if !downstream.is_empty() {
                let downstream_levels = self.graph.subset_levels_cell_only(&downstream);

                // Track which cells have actually changed value during the
                // cascade. Only cells that depend on a changed cell need
                // re-evaluation — others will produce the same value as the
                // main pass. This "dirty propagation" typically skips ~40-50%
                // of cascade cells.
                let mut cascade_dirty: FxHashSet<CellId> = changed_ids.iter().copied().collect();

                for level in &downstream_levels {
                    if level.is_empty() {
                        continue;
                    }

                    // Filter level to only cells with a dirty precedent
                    let dirty_level: Vec<CellId> = level
                        .iter()
                        .filter(|cid| {
                            self.graph
                                .get_precedent_cells(cid)
                                .any(|dep| cascade_dirty.contains(dep))
                        })
                        .copied()
                        .collect();

                    if dirty_level.is_empty() {
                        continue;
                    }

                    {
                        let plan: crate::eval::cache::range_store::DataPlan = dirty_level
                            .iter()
                            .filter_map(|cid| self.cell_range_keys.get(cid))
                            .flat_map(|keys| keys.iter().copied())
                            .collect();
                        epoch_range_store.pre_materialize_additive(&plan, mirror);
                    }

                    let changes_before = changed_cells.len();

                    #[cfg(feature = "native")]
                    let use_parallel =
                        dirty_level.len() >= super::super::level_eval::PARALLEL_THRESHOLD;
                    #[cfg(not(feature = "native"))]
                    let use_parallel = false;

                    if use_parallel {
                        #[cfg(feature = "native")]
                        {
                            self.topo_evaluate_level_parallel(
                                mirror,
                                &dirty_level,
                                &mut changed_cells,
                                &mut projection_changes,
                                &mut errors,
                                epoch_range_store,
                                &mut projection_deltas,
                                metrics,
                                &None,
                            );
                        }
                    } else {
                        self.topo_evaluate_level_sequential(
                            mirror,
                            &dirty_level,
                            &mut changed_cells,
                            &mut projection_changes,
                            &mut errors,
                            epoch_range_store,
                            &mut projection_deltas,
                            metrics,
                        );
                    }

                    // Add newly changed cells to the dirty set for next level
                    for change in &changed_cells[changes_before..] {
                        if let Ok(cid) = CellId::from_uuid_str(&change.cell_id) {
                            cascade_dirty.insert(cid);
                        }
                    }

                    let dirty_positions: Vec<(SheetId, u32, u32)> = dirty_level
                        .iter()
                        .filter_map(|cid| {
                            let sid = mirror.sheet_for_cell(cid)?;
                            let pos = mirror.resolve_position(cid)?;
                            Some((sid, pos.row(), pos.col()))
                        })
                        .collect();
                    if !dirty_positions.is_empty() {
                        epoch_range_store.invalidate_dirty(&dirty_positions);
                    }
                }
            }
        }

        (changed_cells, projection_changes, errors)
    }
}

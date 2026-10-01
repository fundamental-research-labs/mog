use std::collections::BTreeSet;

use super::*;
use crate::eval::cache::range_store::RangeStore;

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
    /// When `scope` is `Some`, it is the set of cells this recalc evaluates,
    /// and the pass stays inside it (incremental recalc — the cells outside
    /// retain correct prior values; in manual calculation mode, where the set
    /// is the edited formulas alone, what depends on them waits for a calculate).
    /// When `None`, all selective deps are checked (full recalc).
    ///
    /// What the changed selective deps feed is re-evaluated in two parts: the
    /// cells that can be put in dependency order, in that order
    /// ([`Self::fixup_ordered`]), and the others by the cascade below.
    #[tracing::instrument(name = "selective_dep_fixup", skip_all)]
    pub(in super::super) fn selective_dep_fixup_pass(
        &mut self,
        cell_store: &mut CellStore,
        epoch_range_store: &mut crate::eval::cache::range_store::RangeStore,
        metrics: &mut RecalcMetrics,
        scope: Option<&FxHashSet<CellId>>,
        changed_positions: Option<&FxHashMap<(SheetId, u32), Vec<u32>>>,
    ) -> PreLeveledEvalResult {
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
                .selective_dep_cells_with_formula_ranges(&self.ast_cache, &*cell_store)
        };
        if selective_cells.is_empty() {
            return PreLeveledEvalResult::default();
        }

        // Filter to formula cells in ast_cache, and optionally to scope
        let fixup_cells: Vec<CellId> = selective_cells
            .iter()
            .filter(|c| self.ast_cache.contains_key(c) && scope.is_none_or(|s| s.contains(c)))
            .copied()
            .collect();

        if fixup_cells.is_empty() {
            return PreLeveledEvalResult::default();
        }

        let _fixup_span = tracing::info_span!(
            "selective_dep_fixup",
            selective_count = fixup_cells.len(),
            changed_filter = changed_positions.is_some(),
            selective_candidates = selective_cells.len(),
        )
        .entered();

        // The selective deps are re-evaluated after cells they read have changed
        // within this recalc, so the epoch-scoped caches can hold values computed
        // from the old inputs (the subexpression cache keeps array-valued calls
        // such as `CHOOSE(1,D2:D2)` for the whole epoch). Start from fresh
        // caches, as the cycle handler does before re-evaluating dependents.
        clear_thread_local_caches();

        // Pre-materialize ranges for these cells
        {
            let plan: crate::eval::cache::range_store::DataPlan = fixup_cells
                .iter()
                .filter_map(|cid| self.cell_range_keys.get(cid))
                .flat_map(|keys| keys.iter().copied())
                .collect();
            epoch_range_store.pre_materialize_additive(&plan, cell_store);
        }

        // Re-evaluate selective deps using parallel evaluation for large sets
        let mut changed_cells = Vec::new();
        let mut projection_changes = Vec::new();
        let mut errors = Vec::new();
        let mut projection_deltas = Vec::new();

        let use_parallel = fixup_cells.len() >= super::super::level_eval::PARALLEL_THRESHOLD;

        if use_parallel {
            {
                self.topo_evaluate_level_parallel(
                    cell_store,
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
                cell_store,
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

            // The cells that have a dependency order are re-evaluated in it,
            // and end final. `unordered` are the others, by position: their
            // inputs are not final, and they keep the cascade below.
            // `cascaded` are the cells the cascade would have marked as
            // changed by now had it evaluated the ordered cells itself.
            let (unordered, cascaded) = self.fixup_ordered(
                cell_store,
                epoch_range_store,
                metrics,
                scope,
                &selective_cells,
                &mut changed_cells,
                &mut projection_changes,
                &mut errors,
                &mut projection_deltas,
            );

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
                unordered
                    .into_iter()
                    .filter(|c| {
                        visited.contains(c)
                            && self.ast_cache.contains_key(c)
                            && !selective_cells.contains(c)
                            && !changed_ids.contains(c)
                            && cell_store
                                .sheet_for_cell(c)
                                .is_none_or(|sid| cell_store.is_calculation_enabled(&sid))
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
                let mut cascade_dirty: FxHashSet<CellId> = cascaded;

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
                        epoch_range_store.pre_materialize_additive(&plan, cell_store);
                    }

                    let changes_before = changed_cells.len();

                    let use_parallel =
                        dirty_level.len() >= super::super::level_eval::PARALLEL_THRESHOLD;

                    if use_parallel {
                        {
                            self.topo_evaluate_level_parallel(
                                cell_store,
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
                            cell_store,
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
                            let sid = cell_store.sheet_for_cell(cid)?;
                            let pos = cell_store.resolve_position(cid)?;
                            Some((sid, pos.row(), pos.col()))
                        })
                        .collect();
                    if !dirty_positions.is_empty() {
                        epoch_range_store.invalidate_dirty(&dirty_positions);
                    }
                }
            }
        }

        (changed_cells, projection_changes, errors, projection_deltas)
    }

    /// Re-evaluate, in dependency order, the cells that the changed selective
    /// deps feed and that have such an order. Returns the cells that have
    /// none, by position, and the cells the cascade counts as changed: the
    /// changed selective deps, and the ordered cells that changed and that it
    /// would have evaluated itself (reached from those through cell
    /// references, and not among the `reread` selective deps).
    ///
    /// Every cell that can depend on a changed selective dep is sorted once,
    /// and in that sort a selective range orders its reader after the cells it
    /// holds, the way a range read in full does in the main pass
    /// (`D5 = INDEX(B2:C2,1,1)`, `D2 = D5*1`, `H9 = INDEX(D2:E2,1,1)`: D2,
    /// then H9). A cell with a level is evaluated when a cell it reads has
    /// changed: at most once, after everything it reads, so it ends final.
    ///
    /// A selective dep whose range holds cells that depend on it gets no
    /// level, nor does a cell behind it: no such order exists, and which of
    /// those cells the selective dep does read only its evaluation tells.
    #[allow(clippy::too_many_arguments)]
    fn fixup_ordered(
        &mut self,
        cell_store: &mut CellStore,
        epoch_range_store: &mut RangeStore,
        metrics: &mut RecalcMetrics,
        scope: Option<&FxHashSet<CellId>>,
        reread: &FxHashSet<CellId>,
        changed_cells: &mut Vec<CellChange>,
        projection_changes: &mut Vec<ProjectionChange>,
        errors: &mut Vec<CellErrorInfo>,
        projection_deltas: &mut Vec<ProjectionDelta>,
    ) -> (Vec<CellId>, FxHashSet<CellId>) {
        let mut changed = Changed::of(&*cell_store, changed_cells, projection_changes);
        let reread_changed: Vec<CellId> = changed.cells.iter().copied().collect();
        let mut cascaded: FxHashSet<CellId> = changed_cells
            .iter()
            .filter_map(|c| CellId::from_uuid_str(&c.cell_id).ok())
            .collect();
        let affected: FxHashSet<CellId> = self
            .graph
            .dependents_closure(&reread_changed, &*cell_store)
            .into_iter()
            .filter(|c| {
                self.ast_cache.contains_key(c)
                    && scope.is_none_or(|s| s.contains(c))
                    && cell_store
                        .sheet_for_cell(c)
                        .is_none_or(|sid| cell_store.is_calculation_enabled(&sid))
            })
            .collect();
        let (levels, unordered) = self
            .graph
            .fixup_levels(&affected, &*cell_store)
            .into_value();

        // The caches and the cached ranges hold what the re-read saw.
        clear_thread_local_caches();
        epoch_range_store.invalidate_dirty(&changed.positions());

        for level in &levels {
            let stale: Vec<CellId> = level
                .iter()
                .filter(|c| self.reads_changed(c, &changed))
                .copied()
                .collect();
            if stale.is_empty() {
                continue;
            }
            let changes_from = changed_cells.len();
            let projections_from = projection_changes.len();
            if stale.len() >= super::super::level_eval::PARALLEL_THRESHOLD {
                let plan: crate::eval::cache::range_store::DataPlan = stale
                    .iter()
                    .filter_map(|cid| self.cell_range_keys.get(cid))
                    .flat_map(|keys| keys.iter().copied())
                    .collect();
                epoch_range_store.pre_materialize_additive(&plan, cell_store);
                self.topo_evaluate_level_parallel(
                    cell_store,
                    &stale,
                    changed_cells,
                    projection_changes,
                    errors,
                    epoch_range_store,
                    projection_deltas,
                    metrics,
                    &None,
                );
            } else {
                self.topo_evaluate_level_sequential(
                    cell_store,
                    &stale,
                    changed_cells,
                    projection_changes,
                    errors,
                    epoch_range_store,
                    projection_deltas,
                    metrics,
                );
            }

            // The next levels read ranges through the store: drop the cached
            // ranges that hold a cell this level changed.
            let level_changed = Changed::of(
                &*cell_store,
                &changed_cells[changes_from..],
                &projection_changes[projections_from..],
            );
            epoch_range_store.invalidate_dirty(&level_changed.positions());
            changed.merge(level_changed);
            for change in &changed_cells[changes_from..] {
                if let Ok(cid) = CellId::from_uuid_str(&change.cell_id)
                    && !reread.contains(&cid)
                    && self
                        .graph
                        .get_precedent_cells(&cid)
                        .any(|precedent| cascaded.contains(precedent))
                {
                    cascaded.insert(cid);
                }
            }
        }
        (unordered, cascaded)
    }

    /// Whether `cell` reads a cell in `changed`: a cell it refers to, or one
    /// inside a range it reads.
    fn reads_changed(&self, cell: &CellId, changed: &Changed) -> bool {
        self.graph.get_precedents(cell).iter().any(|dep| match dep {
            DepTarget::Cell(precedent) => changed.cells.contains(precedent),
            DepTarget::Range(range, _) => changed.any_in(range),
        })
    }
}

/// Cells whose value changed, by identity and by position (a spill changes
/// the positions it covers).
#[derive(Default)]
struct Changed {
    cells: FxHashSet<CellId>,
    /// `(sheet, column)` to the rows that changed.
    rows: FxHashMap<(SheetId, u32), BTreeSet<u32>>,
}

impl Changed {
    /// What an evaluation reported as changed.
    fn of(
        cell_store: &CellStore,
        changes: &[CellChange],
        projections: &[ProjectionChange],
    ) -> Self {
        let mut changed = Self::default();
        for change in changes {
            if let Ok(cell_id) = CellId::from_uuid_str(&change.cell_id) {
                changed.insert(cell_store, cell_id);
            }
        }
        for projection in projections {
            if let Ok(cell_id) = CellId::from_uuid_str(&projection.source_cell_id) {
                changed.cells.insert(cell_id);
            }
            if let Ok(sheet) = SheetId::from_uuid_str(&projection.sheet_id) {
                for cell in &projection.projection_cells {
                    changed.insert_position(sheet, cell.row, cell.col);
                }
            }
        }
        changed
    }

    fn insert(&mut self, cell_store: &CellStore, cell_id: CellId) {
        self.cells.insert(cell_id);
        if let (Some(sheet), Some(pos)) = (
            cell_store.sheet_for_cell(&cell_id),
            cell_store.resolve_position(&cell_id),
        ) {
            self.insert_position(sheet, pos.row(), pos.col());
        }
    }

    fn insert_position(&mut self, sheet: SheetId, row: u32, col: u32) {
        self.rows.entry((sheet, col)).or_default().insert(row);
    }

    fn merge(&mut self, other: Self) {
        self.cells.extend(other.cells);
        for (column, rows) in other.rows {
            self.rows.entry(column).or_default().extend(rows);
        }
    }

    /// Whether a position that changed lies in `range`.
    fn any_in(&self, range: &RangePos) -> bool {
        let rows = range.start_row()..=range.end_row();
        let cols = range.start_col()..=range.end_col();
        let hit = |changed: &BTreeSet<u32>| changed.range(rows.clone()).next().is_some();
        // A whole-row range spans thousands of columns: walk the shorter side.
        if (range.end_col() - range.start_col()) as usize <= self.rows.len() {
            cols.into_iter()
                .any(|col| self.rows.get(&(range.sheet(), col)).is_some_and(&hit))
        } else {
            self.rows.iter().any(|(&(sheet, col), changed)| {
                sheet == range.sheet() && cols.contains(&col) && hit(changed)
            })
        }
    }

    fn positions(&self) -> Vec<(SheetId, u32, u32)> {
        self.rows
            .iter()
            .flat_map(|(&(sheet, col), rows)| rows.iter().map(move |&row| (sheet, row, col)))
            .collect()
    }
}

use super::*;

impl ComputeCore {
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
    pub(in super::super) fn topo_evaluate_pass(
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
    pub(in super::super) fn topo_evaluate_pass_with_levels(
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
}

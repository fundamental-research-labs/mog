//! Dynamic array spill handling and projection stabilization.

use super::*;
use crate::projection::Projection;

/// Result from projection stabilization: (cell_changes, projection_changes, errors).
type StabilizeResult = (Vec<CellChange>, Vec<ProjectionChange>, Vec<CellErrorInfo>);

/// Build a "teardown" `ProjectionChange` whose cells are all the projection's
/// non-anchor positions with `CellValue::Null`. Returns `None` when the
/// projection is 1×1 (no non-anchor cells) — in that case the source cell's
/// own value change already covers the only affected position.
///
/// Why this matters: `clear_materialization` wipes `col_data` for the
/// projection region, but the viewport buffer is patched off the
/// `RecalcResult` — without an explicit per-cell entry for the cleared
/// positions, the buffer keeps the previously-spilled values and the UI
/// still shows them after the spill is torn down.
pub(super) fn build_teardown_projection_change(
    source: CellId,
    old_proj: &Projection,
) -> Option<ProjectionChange> {
    let mut cells = Vec::with_capacity(
        (old_proj.rows.saturating_mul(old_proj.cols)).saturating_sub(1) as usize,
    );
    for r in 0..old_proj.rows {
        for c in 0..old_proj.cols {
            if r == 0 && c == 0 {
                continue;
            }
            cells.push(ProjectionCellData {
                cell_id: source.to_uuid_string(),
                row: old_proj.origin_row + r,
                col: old_proj.origin_col + c,
                value: CellValue::Null,
            });
        }
    }
    if cells.is_empty() {
        return None;
    }
    Some(ProjectionChange {
        source_cell_id: source.to_uuid_string(),
        sheet_id: old_proj.sheet.to_uuid_string(),
        is_cse: false,
        projection_cells: cells,
    })
}

/// Append `teardown_pcs` to `result.projection_changes`, but drop teardown
/// cells whose (sheet, row, col) collide with an authoritative non-null patch
/// already in `result` — i.e. either a `CellChange` in `result.changed_cells`
/// or a non-null `ProjectionCellData` already in `result.projection_changes`.
///
/// Why: a single `apply_changes` / `set_cells` call can simultaneously emit
///   - a regular `CellChange` for cell C (the user's write, the post-recalc
///     value, the authoritative wire patch),
///   - a new-spill `ProjectionCellData` for C from a different formula's
///     projection that just expanded into the vacated region, and
///   - a teardown `ProjectionCellData` for C with `CellValue::Null` (because
///     C's position fell inside an old projection that was just invalidated).
///
/// All three are technically true but contradictory at the wire layer: TS
/// would see multiple patches for the same cell and the teardown null would
/// overwrite the authoritative value. The regular `CellChange` and any
/// non-null new-spill projection cell carry the post-recalc truth, so any
/// teardown for the same position must be suppressed at emission time, not
/// deduped downstream in TS.
///
/// Empty teardown changes (after filtering) are dropped entirely to keep the
/// wire compact.
pub(super) fn append_filtered_teardowns(
    result: &mut RecalcResult,
    teardown_pcs: Vec<ProjectionChange>,
) {
    if teardown_pcs.is_empty() {
        return;
    }
    // Build (sheet_id, row, col) keys for positions whose authoritative wire
    // patch is already a non-null value. Any colliding teardown null must be
    // dropped — the teardown is a structural side-effect, the value is the
    // truth.
    let mut occupied: FxHashSet<(String, u32, u32)> = FxHashSet::default();
    for change in &result.changed_cells {
        if let Some(pos) = &change.position {
            occupied.insert((change.sheet_id.clone(), pos.row, pos.col));
        }
    }
    for pc in &result.projection_changes {
        for cell in &pc.projection_cells {
            // Only non-null cells are authoritative. Existing teardowns (Null)
            // don't shadow new ones.
            if !matches!(cell.value, CellValue::Null) {
                occupied.insert((pc.sheet_id.clone(), cell.row, cell.col));
            }
        }
    }

    for mut pc in teardown_pcs {
        pc.projection_cells
            .retain(|cell| !occupied.contains(&(pc.sheet_id.clone(), cell.row, cell.col)));
        if !pc.projection_cells.is_empty() {
            result.projection_changes.push(pc);
        }
    }
}

impl ComputeCore {
    /// Invalidate a projection that covers the given position.
    ///
    /// If `(sheet_id, row, col)` falls within a projection whose source is NOT `cell_id`,
    /// clears the projection's materialized values, leaves the source's stored
    /// value untouched, and returns `(source, old_projection)` so the caller can
    /// dirty the source AND surface the cleared spill targets in the recalc result.
    ///
    /// IMPORTANT: this MUST NOT pre-set the source to `#SPILL!` before recalc.
    /// Recalc compares the topo-evaluated new value against the mirror's stored
    /// old value to decide whether to emit a `CellChange`; pre-setting `#SPILL!`
    /// makes that comparison `Spill == Spill` and silently drops the anchor
    /// transition out of `changed_cells`, leaving the viewport buffer with the
    /// stale spilled top-left value. The source is added to the dirty list by
    /// the caller, so recalc will write the correct (and possibly `#SPILL!`)
    /// value naturally — and the comparison against the *real* old value
    /// (the prior `Array(...)`) makes the change visible to the wire patches.
    pub(super) fn invalidate_projection_at(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        cell_id: CellId,
    ) -> Option<(CellId, Projection)> {
        let (proj_source, _, _) = mirror.projection_registry.resolve(sheet_id, row, col)?;
        if proj_source == cell_id {
            return None;
        }
        let old_proj = mirror.projection_registry.remove(&proj_source)?;
        mirror.clear_materialization(
            &old_proj.sheet,
            old_proj.origin_row,
            old_proj.origin_col,
            old_proj.rows,
            old_proj.cols,
        );
        Some((proj_source, old_proj))
    }

    /// Clear a cell's own projection registration and materialized values.
    /// Returns the cleared `Projection` (if one existed) so the caller can
    /// emit a teardown `ProjectionChange` into the recalc result.
    pub(super) fn clear_projection_for_cell(
        &mut self,
        mirror: &mut CellMirror,
        cell_id: &CellId,
    ) -> Option<Projection> {
        let old_proj = mirror.projection_registry.remove(cell_id)?;
        mirror.clear_materialization(
            &old_proj.sheet,
            old_proj.origin_row,
            old_proj.origin_col,
            old_proj.rows,
            old_proj.cols,
        );
        Some(old_proj)
    }

    /// Projection stabilization phase — corrects formulas that read from ranges
    /// whose values changed due to projection shape/existence changes.
    ///
    /// This is the key mechanism for dynamic array correctness: when a projection
    /// changes shape (e.g., SEQUENCE(5) -> SEQUENCE(3)), formulas that reference
    /// ranges overlapping the old or new projection need re-evaluation.
    ///
    /// Additionally, this phase re-extracts dependencies for affected formulas
    /// (now projection-aware), which adds `Cell(source)` edges for FUTURE recalcs.
    /// This is the "self-eliminating" property: after one stabilization, the
    /// topo ordering is correct and projection stabilization won't trigger again unless
    /// projections actually change shape.
    ///
    /// Bounded recursion: max depth 5 to handle cascading projection changes.
    ///
    /// Runs during both incremental and full recalc. During full recalc, the
    /// projection registry is empty at dep-extraction time, so formulas reading
    /// spill targets lack Cell(source) edges and may evaluate before their
    /// TRANSPOSE sources. Stabilization corrects those values and adds the
    /// Cell(source) edges for future incremental recalcs.
    pub(super) fn projection_stabilize(
        &mut self,
        mirror: &mut CellMirror,
        deltas: &[ProjectionDelta],
        deadline: &super::recalc::Deadline,
        depth: usize,
        epoch_range_store: &mut crate::eval::cache::range_store::RangeStore,
    ) -> Result<StabilizeResult, ComputeError> {
        const MAX_DEPTH: usize = 5;

        if depth >= MAX_DEPTH {
            tracing::error!("Projection stabilization exceeded max depth {}", MAX_DEPTH);
            return Ok((Vec::new(), Vec::new(), Vec::new()));
        }
        if depth >= 3 {
            tracing::warn!("Projection stabilization at depth {} (unusual)", depth);
        }

        if super::recalc::past_deadline(deadline) {
            tracing::warn!("Projection stabilization skipped — deadline exceeded");
            return Ok((Vec::new(), Vec::new(), Vec::new()));
        }

        // 1. Compute changed rectangular regions due to projection changes.
        //    Use range tuples instead of materializing every cell position —
        //    avoids creating massive Vecs for large projections (e.g., 1000x1000 TRANSPOSE).
        //    Over-inclusion of origin cell (0,0) is safe: it just means we might
        //    check one extra formula that we'd have checked anyway.
        let mut changed_ranges: Vec<(SheetId, u32, u32, u32, u32)> = Vec::new();
        for delta in deltas {
            if let Some(ref new) = delta.new {
                changed_ranges.push((
                    new.sheet,
                    new.origin_row,
                    new.origin_col,
                    new.origin_row + new.rows.saturating_sub(1),
                    new.origin_col + new.cols.saturating_sub(1),
                ));
            }
            if let Some(ref old) = delta.old {
                changed_ranges.push((
                    old.sheet,
                    old.origin_row,
                    old.origin_col,
                    old.origin_row + old.rows.saturating_sub(1),
                    old.origin_col + old.cols.saturating_sub(1),
                ));
            }
        }

        if changed_ranges.is_empty() {
            return Ok((Vec::new(), Vec::new(), Vec::new()));
        }

        // 2. Find formulas affected via range containment (range-based query)
        let newly_affected = self.graph.find_by_range_containment_ranges(&changed_ranges);

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::ProjectionStabilizeStart {
                depth: depth as u32,
                delta_count: deltas.len() as u32,
                affected_count: newly_affected.len() as u32,
            });
        }

        if newly_affected.is_empty() {
            return Ok((Vec::new(), Vec::new(), Vec::new()));
        }

        tracing::info!(
            depth = depth,
            affected_count = newly_affected.len(),
            delta_count = deltas.len(),
            "Projection stabilization running"
        );

        // 3. Re-extract deps for affected formulas (now projection-aware).
        //    This adds Cell(source) edges for FUTURE recalcs, making the
        //    topo ordering correct and eliminating future stabilization triggers.
        let mut volatile_cells = Vec::new();
        // Pre-collect AST entries and sheet IDs to avoid borrowing `self` inside the batch scope.
        let dep_inputs: Vec<_> = newly_affected
            .iter()
            .filter_map(|&cell_id| {
                let entry = self.ast_cache.get(&cell_id)?.clone();
                let sheet_id = mirror.sheet_for_cell(&cell_id)?;
                Some((cell_id, entry, sheet_id))
            })
            .collect();
        let ordered_sheets = self.ordered_sheets().to_vec();
        {
            let mut batch = self.graph.batch_mutations();
            for (cell_id, entry, sheet_id) in &dep_inputs {
                let current_row = mirror.resolve_position(cell_id).map(|pos| pos.row());
                let extracted = extract_deps_and_volatility(
                    &entry.ast,
                    sheet_id,
                    mirror,
                    &ordered_sheets,
                    current_row,
                );
                batch.set_precedents(cell_id, extracted.value_deps);
                self.formula_text_deps
                    .replace(*cell_id, extracted.formula_text_deps);
                if extracted.is_volatile {
                    volatile_cells.push(*cell_id);
                }
            }
        } // rebuild_range_index() called on drop
        for cell_id in volatile_cells {
            self.graph.mark_volatile(&cell_id);
        }

        // 4. Topo sort and re-evaluate the correction set
        let correction_cells: Vec<CellId> = newly_affected.into_iter().collect();
        let mut spill_metrics = RecalcMetrics::default();
        let (stab_changes, stab_projection_changes, stab_errors, more_deltas, _spill_cycles) = self
            .topo_evaluate_pass(
                mirror,
                &correction_cells,
                deadline,
                epoch_range_store,
                &mut spill_metrics,
            )?;

        // 5. If more projection deltas occurred, recurse
        if !more_deltas.is_empty() {
            let (recursive_changes, recursive_proj, recursive_errors) = self.projection_stabilize(
                mirror,
                &more_deltas,
                deadline,
                depth + 1,
                epoch_range_store,
            )?;
            let mut all_changes = stab_changes;
            all_changes.extend(recursive_changes);
            let mut all_proj_changes = stab_projection_changes;
            all_proj_changes.extend(recursive_proj);
            let mut all_errors = stab_errors;
            all_errors.extend(recursive_errors);
            return Ok((all_changes, all_proj_changes, all_errors));
        }

        Ok((stab_changes, stab_projection_changes, stab_errors))
    }

    /// Handle dynamic array spill logic for a single evaluated cell.
    ///
    /// This modifies `new_value` in place (e.g. unwrapping 1x1 arrays to scalar,
    /// or replacing with #SPILL! on conflict). Projected values are materialized
    /// into col_data via the ProjectionRegistry (no phantom CellIds created).
    /// Projection deltas (old/new shape changes) are appended to `projection_deltas`.
    pub(super) fn apply_spill_handling_with_deltas(
        &mut self,
        mirror: &mut CellMirror,
        cell_id: CellId,
        sheet_id: SheetId,
        new_value: &mut CellValue,
        projection_changes: &mut Vec<ProjectionChange>,
        projection_deltas: &mut Vec<ProjectionDelta>,
    ) {
        // Snapshot old projection state for delta tracking
        let old_proj = mirror.projection_registry.get(&cell_id).cloned();

        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::SpillHandlingStart {
                cell: cell_id,
                sheet: sheet_id,
                has_old_projection: old_proj.is_some(),
            });
        }

        // --- Run the actual spill handling logic ---
        if let CellValue::Array(ref arr) = new_value.clone() {
            let array_rows = arr.rows() as u32;
            let array_cols = arr.cols() as u32;

            if array_rows > 1 || array_cols > 1 {
                // Legacy CSE single-cell override: if the XLSX declared this formula
                // as a 1×1 array formula (t="array" ref="X1:X1"), it must NOT spill
                // regardless of is_dynamic_array. Apply implicit intersection.
                let is_cse_single = mirror.cse_single_cell.contains(&cell_id);
                let is_cse_multi = mirror.cse_anchors.contains(&cell_id);

                // Implicit intersection: formulas that do not contain
                // array-returning functions should apply implicit intersection
                // (extract the top-left scalar) instead of spilling into
                // neighboring cells. Only formulas flagged as dynamic array
                // (is_dynamic_array in AstEntry) get spill behavior.
                // CSE single-cell formulas also take this path.
                // Multi-cell CSE anchors skip implicit intersection — they
                // must take the dynamic-array spill path so projections are
                // registered and the full array result materializes.
                if is_cse_single
                    || (!is_cse_multi
                        && !self
                            .ast_cache
                            .get(&cell_id)
                            .map(|e| e.is_dynamic_array)
                            .unwrap_or(false))
                {
                    #[cfg(feature = "journal")]
                    {
                        crate::journal::record(crate::journal::JournalEvent::Decision {
                            cell: cell_id,
                            point: "is_dynamic_array",
                            condition: format!(
                                "is_dynamic_array=false, rows={}, cols={}",
                                array_rows, array_cols
                            ),
                            path: "implicit_intersection",
                        });
                    }
                    // Implicit intersection: extract [0][0] (top-left value).
                    // Clear projection registry for implicit intersection
                    if let Some(old_proj) = mirror.projection_registry.remove(&cell_id) {
                        mirror.clear_materialization(
                            &old_proj.sheet,
                            old_proj.origin_row,
                            old_proj.origin_col,
                            old_proj.rows,
                            old_proj.cols,
                        );
                        if let Some(pc) = build_teardown_projection_change(cell_id, &old_proj) {
                            projection_changes.push(pc);
                        }
                    }
                    if let Some(v) = arr.get(0, 0) {
                        *new_value = v.clone();
                    } else {
                        *new_value = CellValue::Null;
                    }
                } else if let Some(origin_pos) = mirror.resolve_position(&cell_id) {
                    let origin_row = origin_pos.row();
                    let origin_col = origin_pos.col();
                    #[cfg(feature = "journal")]
                    {
                        crate::journal::record(crate::journal::JournalEvent::Decision {
                            cell: cell_id,
                            point: "is_dynamic_array",
                            condition: format!(
                                "is_dynamic_array=true, rows={}, cols={}",
                                array_rows, array_cols
                            ),
                            path: "spill_path",
                        });
                    }
                    // Dynamic array formula: attempt to spill
                    match mirror.projection_registry.check_conflict(
                        &*mirror, &sheet_id, origin_row, origin_col, array_rows, array_cols,
                        &cell_id,
                    ) {
                        Ok(()) => {
                            // No conflict — apply projection (no phantom CellIds created)
                            #[cfg(feature = "journal")]
                            {
                                crate::journal::record(crate::journal::JournalEvent::Decision {
                                    cell: cell_id,
                                    point: "spill_conflict",
                                    condition: format!(
                                        "check_conflict({}:{} {}x{})",
                                        origin_row, origin_col, array_rows, array_cols
                                    ),
                                    path: "no_conflict",
                                });
                            }

                            // Clear old projection's materialized values if the shape changed.
                            // Emit a teardown ProjectionChange covering the OLD region first;
                            // the new projection's cells are pushed below and overwrite any
                            // overlap, leaving only the genuinely-vacated positions as Null.
                            let cur_proj = mirror.projection_registry.get(&cell_id).cloned();
                            if let Some(ref old) = cur_proj
                                && (old.rows != array_rows
                                    || old.cols != array_cols
                                    || old.origin_row != origin_row
                                    || old.origin_col != origin_col)
                            {
                                mirror.clear_materialization(
                                    &old.sheet,
                                    old.origin_row,
                                    old.origin_col,
                                    old.rows,
                                    old.cols,
                                );
                                if let Some(pc) = build_teardown_projection_change(cell_id, old) {
                                    projection_changes.push(pc);
                                }
                            }

                            // Register the projection in the registry
                            mirror.projection_registry.register(
                                cell_id, sheet_id, origin_row, origin_col, array_rows, array_cols,
                            );
                            #[cfg(feature = "journal")]
                            {
                                crate::journal::record(
                                    crate::journal::JournalEvent::ProjectionRegister {
                                        source: cell_id,
                                        sheet: sheet_id,
                                        origin: (origin_row, origin_col),
                                        size: (array_rows, array_cols),
                                    },
                                );
                            }

                            // Materialize projected values into col_data
                            #[cfg(feature = "journal")]
                            {
                                let target_count = (array_rows * array_cols).saturating_sub(1);
                                crate::journal::record(
                                    crate::journal::JournalEvent::ProjectionMaterializeStart {
                                        source: cell_id,
                                        target_count,
                                    },
                                );
                            }
                            mirror.materialize_projection(
                                &sheet_id, origin_row, origin_col, new_value,
                            );

                            // Build ProjectionChange for IPC output (projection metadata)
                            let mut proj_data = Vec::new();
                            for r in 0..array_rows {
                                for c in 0..array_cols {
                                    if r == 0 && c == 0 {
                                        continue;
                                    }
                                    let row = origin_row + r;
                                    let col = origin_col + c;
                                    let value = arr
                                        .get(r as usize, c as usize)
                                        .cloned()
                                        .unwrap_or(CellValue::Null);
                                    proj_data.push(ProjectionCellData {
                                        cell_id: cell_id.to_uuid_string(),
                                        row,
                                        col,
                                        value,
                                    });
                                }
                            }
                            if !proj_data.is_empty() {
                                projection_changes.push(ProjectionChange {
                                    source_cell_id: cell_id.to_uuid_string(),
                                    sheet_id: sheet_id.to_uuid_string(),
                                    is_cse: is_cse_multi,
                                    projection_cells: proj_data,
                                });
                            }

                            // Source cell stores the full CellValue::Array.
                            // Normal read paths (get_cell_value, get_cell_value_at)
                            // unwrap to the top-left scalar for backwards compatibility.
                            // ANCHORARRAY reads the raw Array directly.
                            // Projection succeeded — clear any stale blocker entry for
                            // this source cell so future clears don't spuriously re-dirty it.
                            self.spill_blockers.retain(|_, src| *src != cell_id);
                        }
                        Err(conflict_cell) => {
                            #[cfg(feature = "journal")]
                            {
                                crate::journal::record(crate::journal::JournalEvent::Decision {
                                    cell: cell_id,
                                    point: "spill_conflict",
                                    condition: format!(
                                        "conflict at ({}:{} {}x{})",
                                        origin_row, origin_col, array_rows, array_cols
                                    ),
                                    path: "spill_conflict",
                                });
                            }
                            // Conflict — clear existing projection, set #SPILL!
                            if let Some(old_proj) = mirror.projection_registry.remove(&cell_id) {
                                mirror.clear_materialization(
                                    &old_proj.sheet,
                                    old_proj.origin_row,
                                    old_proj.origin_col,
                                    old_proj.rows,
                                    old_proj.cols,
                                );
                                if let Some(pc) =
                                    build_teardown_projection_change(cell_id, &old_proj)
                                {
                                    projection_changes.push(pc);
                                }
                            }
                            *new_value = CellValue::Error(CellError::Spill, None);
                            // Track which cell is blocking this spill source.
                            // When conflict_cell is later cleared, cell_id will be
                            // added to the recalc dirty set so the projection restores.
                            self.spill_blockers.insert(conflict_cell, cell_id);
                        }
                    }
                }
            } else if array_rows == 1 && array_cols == 1 {
                // 1x1 array: unwrap to scalar
                #[cfg(feature = "journal")]
                {
                    crate::journal::record(crate::journal::JournalEvent::Decision {
                        cell: cell_id,
                        point: "1x1_unwrap",
                        condition: format!("rows=1, cols=1"),
                        path: "scalar_unwrap",
                    });
                }
                *new_value = arr.get(0, 0).cloned().unwrap_or(CellValue::Null);
                if let Some(old_proj) = mirror.projection_registry.remove(&cell_id) {
                    mirror.clear_materialization(
                        &old_proj.sheet,
                        old_proj.origin_row,
                        old_proj.origin_col,
                        old_proj.rows,
                        old_proj.cols,
                    );
                    if let Some(pc) = build_teardown_projection_change(cell_id, &old_proj) {
                        projection_changes.push(pc);
                    }
                }
            }
        } else {
            // Non-array result: clear any previous projection from this source
            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::Decision {
                    cell: cell_id,
                    point: "non_array_clear",
                    condition: "result is not Array".to_string(),
                    path: "clear_projection",
                });
            }
            if let Some(old_proj) = mirror.projection_registry.remove(&cell_id) {
                mirror.clear_materialization(
                    &old_proj.sheet,
                    old_proj.origin_row,
                    old_proj.origin_col,
                    old_proj.rows,
                    old_proj.cols,
                );
                if let Some(pc) = build_teardown_projection_change(cell_id, &old_proj) {
                    projection_changes.push(pc);
                }
            }
        }

        // --- Projection delta tracking ---
        let new_proj = mirror.projection_registry.get(&cell_id).cloned();
        let shape_changed = match (&old_proj, &new_proj) {
            (None, None) => false,
            (Some(_), None) | (None, Some(_)) => true,
            (Some(o), Some(n)) => {
                o.rows != n.rows
                    || o.cols != n.cols
                    || o.origin_row != n.origin_row
                    || o.origin_col != n.origin_col
                    || o.sheet != n.sheet
            }
        };
        if shape_changed {
            projection_deltas.push(ProjectionDelta {
                old: old_proj,
                new: new_proj,
            });
        }

        #[cfg(feature = "journal")]
        {
            let outcome = if mirror.projection_registry.get(&cell_id).is_some() {
                "spill_ok"
            } else if matches!(new_value, CellValue::Error(CellError::Spill, _)) {
                "spill_conflict"
            } else {
                "no_spill"
            };
            crate::journal::record(crate::journal::JournalEvent::SpillHandlingEnd {
                cell: cell_id,
                outcome,
            });
        }
    }
}

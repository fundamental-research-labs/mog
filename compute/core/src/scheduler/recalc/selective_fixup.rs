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
    /// When `scope` is `Some`, only selective deps in the scope set are
    /// checked (incremental recalc — others retain correct prior values).
    /// When `None`, all selective deps are checked (full recalc).
    ///
    /// Propagation re-evaluates what depends on the selective deps that
    /// changed, once, in dependency order ([`Self::fixup_propagate`]).
    #[tracing::instrument(name = "selective_dep_fixup", skip_all)]
    pub(in super::super) fn selective_dep_fixup_pass(
        &mut self,
        cell_store: &mut CellStore,
        epoch_range_store: &mut RangeStore,
        metrics: &mut RecalcMetrics,
        scope: Option<&FxHashSet<CellId>>,
        changed_positions: Option<&FxHashMap<(SheetId, u32), Vec<u32>>>,
        deadline: &Deadline,
    ) -> Result<PreLeveledEvalResult, ComputeError> {
        let mut fixup = Fixup {
            epoch_range_store,
            metrics,
            deadline,
            result: PreLeveledEvalResult::default(),
            changed: Changed::default(),
        };

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
            return Ok(fixup.result);
        }

        // Filter to formula cells in ast_cache, and optionally to scope
        let fixup_cells: Vec<CellId> = selective_cells
            .iter()
            .filter(|c| self.ast_cache.contains_key(c) && scope.is_none_or(|s| s.contains(c)))
            .copied()
            .collect();

        if fixup_cells.is_empty() {
            return Ok(fixup.result);
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

        // Re-evaluate selective deps using parallel evaluation for large sets
        fixup.changed = self.fixup_evaluate(cell_store, &fixup_cells, false, &mut fixup);

        // Only propagate if any selective dep actually changed value.
        // In full recalc from XLSX, most cells produce the same value as the
        // cached value, so the fixup rarely changes anything.
        if !fixup.changed.is_empty() {
            self.fixup_propagate(cell_store, &mut fixup)?;
        }
        Ok(fixup.result)
    }

    /// Re-evaluate what depends on the selective deps whose re-read changed them.
    ///
    /// Every cell that can depend on one of them is put in dependency order,
    /// and in that order a selective range orders its reader after the cells
    /// it holds, the way a range read in full does in the main pass
    /// (`D5 = INDEX(B2:C2,1,1)`, `D2 = D5*1`, `H9 = INDEX(D2:E2,1,1)`: D2,
    /// then H9). A cell is evaluated when one of its inputs has changed: a
    /// cell it refers to, or a cell inside a range it reads. So each cell is
    /// evaluated at most once, after everything it reads.
    ///
    /// The exception is a selective dep whose range holds cells that depend on
    /// it: no order exists between them. Those cells come back from the sort
    /// as cycle cores and are resolved by [`Self::fixup_resolve_unordered`].
    fn fixup_propagate(
        &mut self,
        cell_store: &mut CellStore,
        fixup: &mut Fixup,
    ) -> Result<(), ComputeError> {
        let reread: Vec<CellId> = fixup.changed.cells.iter().copied().collect();
        let affected: FxHashSet<CellId> = self
            .graph
            .dependents_closure(&reread, &*cell_store)
            .into_iter()
            .filter(|c| {
                self.ast_cache.contains_key(c)
                    && cell_store
                        .sheet_for_cell(c)
                        .is_none_or(|sid| cell_store.is_calculation_enabled(&sid))
            })
            .collect();
        let (levels, cycle_cores, mut downstream_levels) = self
            .graph
            .fixup_levels(&affected, &*cell_store)
            .into_value();

        clear_thread_local_caches();
        self.fixup_evaluate_levels(cell_store, &levels, fixup);
        if !cycle_cores.is_empty() {
            let downstream: Vec<CellId> = downstream_levels.iter().flatten().copied().collect();
            let unordered =
                self.fixup_resolve_unordered(cell_store, &cycle_cores, &downstream, fixup)?;
            for level in &mut downstream_levels {
                level.retain(|c| !unordered.contains(c));
            }
            clear_thread_local_caches();
            self.fixup_evaluate_levels(cell_store, &downstream_levels, fixup);
        }
        Ok(())
    }

    /// Evaluate, level by level, the cells that read a cell that changed.
    fn fixup_evaluate_levels(
        &mut self,
        cell_store: &mut CellStore,
        levels: &[Vec<CellId>],
        fixup: &mut Fixup,
    ) {
        for level in levels {
            if past_deadline(fixup.deadline) {
                return;
            }
            let stale: Vec<CellId> = level
                .iter()
                .filter(|c| {
                    self.ordered_input_in(c, &fixup.changed)
                        || self.selective_range_holds(c, &fixup.changed)
                })
                .copied()
                .collect();
            let changed = self.fixup_evaluate(cell_store, &stale, false, fixup);
            fixup.changed.merge(changed);
        }
    }

    /// Resolve the cells that a selective range ties into a cycle: the cores,
    /// and the cells that carry one core into another. Returns those cells.
    ///
    /// With iterative calculation on they are a cycle like any other and go
    /// to the iterative solver.
    ///
    /// With it off, a selective dep whose range holds cells that depend on it
    /// is not circular unless it reads one of them. The cells are evaluated
    /// in the order of the main pass, those that read a changed cell only,
    /// and that is repeated while a selective dep finds a changed cell in its
    /// range (cells on a cycle of direct references stay with the cycle
    /// handler). A repeat after the first starts from selective deps whose
    /// range changed in the repeat before, so the values it changes come from
    /// a selective dep that changed in it, which changed because of one that
    /// changed in the repeat before, and so on: as many selective deps as
    /// repeats, all distinct unless they read each other's results. When
    /// fewer have changed, the selective deps form a circular reference. It
    /// is reported like every other one and the repeats stop.
    ///
    /// A volatile cell draws a new value whenever it is evaluated, so from the
    /// second repeat on a changed cell in its range is no reason to re-read
    /// it: the change may come from its own last value.
    fn fixup_resolve_unordered(
        &mut self,
        cell_store: &mut CellStore,
        cycle_cores: &[Vec<CellId>],
        downstream: &[CellId],
        fixup: &mut Fixup,
    ) -> Result<FxHashSet<CellId>, ComputeError> {
        let core_set: FxHashSet<CellId> = cycle_cores.iter().flatten().copied().collect();
        let core_cells = self.local_topo_sort_cycle_cells(&*cell_store, &core_set);
        let cells = self.iteration_cells_for_cycles(&core_cells, &core_set, downstream);
        let unordered: FxHashSet<CellId> = cells.iter().copied().collect();
        if !cells.iter().any(|c| {
            self.ordered_input_in(c, &fixup.changed)
                || self.selective_range_holds(c, &fixup.changed)
        }) {
            return Ok(unordered);
        }

        if self.iterative_calc {
            let raw = |cell_store: &CellStore, c: &CellId| {
                cell_store
                    .get_cell_value_raw(c)
                    .cloned()
                    .unwrap_or(CellValue::Null)
            };
            let before: Vec<CellValue> = cells.iter().map(|c| raw(&*cell_store, c)).collect();
            Self::seed_cycle_cells_for_iteration(cell_store, &core_cells);
            self.evaluate_cycles_iterative(cell_store, &cells, fixup.deadline)?;
            let mut changed = Changed::default();
            for (cell_id, old_value) in cells.iter().zip(before) {
                if same_value(&old_value, &raw(&*cell_store, cell_id)) {
                    continue;
                }
                changed.insert(&*cell_store, *cell_id);
                let value = cell_store.get_cell_value(cell_id).cloned();
                if let Some((_sid, mut change)) =
                    self.make_cell_change(cell_store, cell_id, &value.unwrap_or(CellValue::Null))
                {
                    change.old_value = Some(old_value);
                    fixup.result.0.push(change);
                }
            }
            fixup
                .epoch_range_store
                .invalidate_dirty(&changed.positions());
            fixup.changed.merge(changed);
            return Ok(unordered);
        }

        let (levels, _on_direct_cycles) =
            self.graph.subset_levels(&cells, &*cell_store).into_value();
        let mut changed_selective: FxHashSet<CellId> = FxHashSet::default();
        let mut previous: Option<Changed> = None;
        for repeat in 1usize.. {
            if past_deadline(fixup.deadline) {
                break;
            }
            clear_thread_local_caches();
            let mut now = Changed::default();
            for level in &levels {
                let before = previous.as_ref().unwrap_or(&fixup.changed);
                let mut stale: Vec<CellId> = level
                    .iter()
                    .filter(|c| {
                        self.ordered_input_in(c, &now)
                            || (repeat == 1 && self.ordered_input_in(c, before))
                            || ((repeat == 1 || !self.graph.is_volatile(c))
                                && (self.selective_range_holds(c, &now)
                                    || self.selective_range_holds(c, before)))
                    })
                    .copied()
                    .collect();
                // One at a time: a selective dep in this level can read another.
                // Every other repeat goes backwards, so that a chain of them
                // settles in one repeat whichever way it runs along the sheet.
                if repeat % 2 == 0 {
                    stale.reverse();
                }
                now.merge(self.fixup_evaluate(cell_store, &stale, true, fixup));
            }
            if now.is_empty() {
                break;
            }
            let selective_now: Vec<CellId> = now
                .cells
                .iter()
                .filter(|c| self.is_selective_dep(c))
                .copied()
                .collect();
            if let Some(older) = previous.replace(now) {
                fixup.changed.merge(older);
            }
            if repeat == 1 {
                continue;
            }
            changed_selective.extend(selective_now.iter().copied());
            if changed_selective.len() < repeat - 1 {
                for cell_id in &selective_now {
                    if let Some(sid) = self.find_sheet_for_cell(cell_store, cell_id) {
                        fixup.result.2.push(CellErrorInfo {
                            cell_id: cell_id.to_uuid_string(),
                            sheet_id: sid.to_uuid_string(),
                            error: "Circular reference detected".to_string(),
                        });
                    }
                }
                break;
            }
        }
        if let Some(last) = previous {
            fixup.changed.merge(last);
        }
        Ok(unordered)
    }

    /// Evaluate `cells` as one level, one at a time when `in_order`, and
    /// return the cells whose value or spill is no longer what it was.
    fn fixup_evaluate(
        &mut self,
        cell_store: &mut CellStore,
        cells: &[CellId],
        in_order: bool,
        fixup: &mut Fixup,
    ) -> Changed {
        let mut changed = Changed::default();
        if cells.is_empty() {
            return changed;
        }

        // A spill is reported every time its formula is evaluated: keep the
        // arrays to tell the ones that changed.
        let spills_before: FxHashMap<CellId, CellValue> = cells
            .iter()
            .filter(|c| cell_store.projection_registry.get(c).is_some())
            .filter_map(|c| Some((*c, cell_store.get_cell_value_raw(c)?.clone())))
            .collect();

        let (changed_cells, projection_changes, errors, projection_deltas) = &mut fixup.result;
        let changes_from = changed_cells.len();
        let projections_from = projection_changes.len();
        if !in_order && cells.len() >= super::super::level_eval::PARALLEL_THRESHOLD {
            // Pre-materialize ranges for these cells
            let plan: crate::eval::cache::range_store::DataPlan = cells
                .iter()
                .filter_map(|cid| self.cell_range_keys.get(cid))
                .flat_map(|keys| keys.iter().copied())
                .collect();
            fixup
                .epoch_range_store
                .pre_materialize_additive(&plan, cell_store);
            self.topo_evaluate_level_parallel(
                cell_store,
                cells,
                changed_cells,
                projection_changes,
                errors,
                fixup.epoch_range_store,
                projection_deltas,
                fixup.metrics,
                &None,
            );
        } else {
            self.topo_evaluate_level_sequential(
                cell_store,
                cells,
                changed_cells,
                projection_changes,
                errors,
                fixup.epoch_range_store,
                projection_deltas,
                fixup.metrics,
            );
        }

        for change in &changed_cells[changes_from..] {
            let same = change
                .old_value
                .as_ref()
                .is_some_and(|old| same_value(old, &change.value));
            if let (false, Ok(cell_id)) = (same, CellId::from_uuid_str(&change.cell_id)) {
                changed.insert(&*cell_store, cell_id);
            }
        }
        for projection in &projection_changes[projections_from..] {
            let Ok(cell_id) = CellId::from_uuid_str(&projection.source_cell_id) else {
                continue;
            };
            let same = spills_before.get(&cell_id).is_some_and(|old| {
                cell_store
                    .get_cell_value_raw(&cell_id)
                    .is_some_and(|new| same_value(old, new))
            });
            if let (false, Ok(sheet)) = (same, SheetId::from_uuid_str(&projection.sheet_id)) {
                changed.cells.insert(cell_id);
                for cell in &projection.projection_cells {
                    changed.insert_position(sheet, cell.row, cell.col);
                }
            }
        }

        // Cells evaluated after these read ranges through the store: drop the
        // cached ranges that hold a cell that changed.
        fixup
            .epoch_range_store
            .invalidate_dirty(&changed.positions());
        changed
    }

    /// Whether `cell` refers to a cell in `changed`, or reads in full a range
    /// that holds one: the inputs the main pass orders it after.
    fn ordered_input_in(&self, cell: &CellId, changed: &Changed) -> bool {
        self.graph.get_precedents(cell).iter().any(|dep| match dep {
            DepTarget::Cell(precedent) => changed.cells.contains(precedent),
            DepTarget::Range(range, RangeAccess::Aggregate) => changed.any_in(range),
            DepTarget::Range(_, RangeAccess::Selective) => false,
        })
    }

    /// Whether a range `cell` reads selectively holds a cell in `changed`.
    fn selective_range_holds(&self, cell: &CellId, changed: &Changed) -> bool {
        self.graph.get_precedents(cell).iter().any(|dep| match dep {
            DepTarget::Range(range, RangeAccess::Selective) => changed.any_in(range),
            _ => false,
        })
    }

    fn is_selective_dep(&self, cell: &CellId) -> bool {
        self.graph
            .get_precedents(cell)
            .iter()
            .any(|dep| matches!(dep, DepTarget::Range(_, RangeAccess::Selective)))
    }
}

/// What one fixup pass works with, and what it has done so far.
struct Fixup<'a> {
    epoch_range_store: &'a mut RangeStore,
    metrics: &'a mut RecalcMetrics,
    deadline: &'a Deadline,
    /// Changes, projection changes, errors and projection deltas, for the caller.
    result: PreLeveledEvalResult,
    /// The cells whose value is no longer what the main pass left.
    changed: Changed,
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
    fn is_empty(&self) -> bool {
        self.cells.is_empty()
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

/// Whether a re-evaluated cell holds the value it held. `values_equal` tells
/// an error that carries a message from itself; here it is the same value.
fn same_value(old: &CellValue, new: &CellValue) -> bool {
    match (old, new) {
        (CellValue::Error(a, a_message), CellValue::Error(b, b_message)) => {
            a == b && a_message == b_message
        }
        (CellValue::Array(a), CellValue::Array(b)) => {
            a.rows() == b.rows()
                && a.cols() == b.cols()
                && a.rows_iter().zip(b.rows_iter()).all(|(row_a, row_b)| {
                    row_a
                        .iter()
                        .zip(row_b.iter())
                        .all(|(va, vb)| same_value(va, vb))
                })
        }
        _ => values_equal(old, new),
    }
}

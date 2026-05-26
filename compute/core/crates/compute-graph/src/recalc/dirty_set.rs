//! Dirty-set BFS expansion and affected-cell computation.

use std::collections::VecDeque;

use cell_types::CellId;
use rustc_hash::FxHashSet;
use tracing::warn;

use crate::DependencyGraph;
use crate::positions::{
    AnalysisCompleteness, Analyzed, CellPosition, PositionResolver, TrackedResolver,
};

use super::merge_completeness;

impl DependencyGraph {
    // ═════════════════════════════════════════════════════════════════════════
    // Dirty-set expansion (cycle-tolerant)
    // ═════════════════════════════════════════════════════════════════════════

    /// Compute all cells affected by changes, in topological order.
    ///
    /// **Cycle-tolerant:** cycles don't cause errors; cycle cells appear in
    /// arbitrary order after their non-cyclic dependents.
    ///
    /// Seeds with `changed` + volatile cells, walks cell-to-cell and range
    /// containment edges, then topologically sorts the result.
    #[tracing::instrument(name = "affected_cells", skip_all, fields(changed = changed.len()))]
    pub fn affected_cells(
        &self,
        changed: &[CellId],
        positions: &impl PositionResolver,
    ) -> Analyzed<Vec<CellId>> {
        let tracker = TrackedResolver::new(positions);
        let (dirty, dirty_completeness) = self.collect_dirty_set(changed, &tracker);
        tracker.reset();
        let result = self.barrier_topo(&dirty, &tracker);
        let completeness = merge_completeness(dirty_completeness, tracker.completeness());

        let mut cells: Vec<CellId> = result.levels.into_iter().flatten().collect();
        cells.extend(result.downstream_levels.into_iter().flatten());
        cells.extend(result.cycle_cores.into_iter().flatten());
        Analyzed {
            value: cells,
            completeness,
        }
    }

    /// Compute all cells affected by changes, without topological sorting.
    ///
    /// Returns the unordered set of affected cells. Use this when you only need
    /// to know WHICH cells are affected but don't need evaluation ordering.
    /// Avoids the expensive `barrier_topo` call (O(V+E) graph construction + Kahn's sort).
    #[tracing::instrument(name = "affected_cells_unordered", skip_all, fields(changed = changed.len()))]
    pub fn affected_cells_unordered(
        &self,
        changed: &[CellId],
        positions: &impl PositionResolver,
    ) -> Analyzed<FxHashSet<CellId>> {
        let tracker = TrackedResolver::new(positions);
        let (dirty, dirty_completeness) = self.collect_dirty_set(changed, &tracker);
        Analyzed {
            value: dirty,
            completeness: dirty_completeness,
        }
    }

    /// Compute affected cells grouped by topological level, with cycle cells separate.
    ///
    /// **Cycle-tolerant:** cycle cells are returned in the second element of the
    /// tuple, sorted by position. Never errors on cyclic graphs.
    ///
    /// Each level contains cells whose dependencies are all at earlier levels.
    /// Cells within a level have no mutual dependencies.
    pub fn affected_cells_levels(
        &self,
        changed: &[CellId],
        positions: &impl PositionResolver,
    ) -> Analyzed<(Vec<Vec<CellId>>, Vec<CellId>)> {
        let tracker = TrackedResolver::new(positions);
        let (dirty, dirty_completeness) = self.collect_dirty_set(changed, &tracker);
        tracker.reset();
        let result = self.barrier_topo(&dirty, &tracker);
        let completeness = merge_completeness(dirty_completeness, tracker.completeness());

        let mut levels = result.levels;
        levels.extend(result.downstream_levels);

        let mut cycle_cells: Vec<CellId> = result.cycle_cores.into_iter().flatten().collect();
        cycle_cells.sort_by(|a, b| {
            let pa = self.resolve_sort_key(a, positions);
            let pb = self.resolve_sort_key(b, positions);
            pa.cmp(&pb)
        });

        Analyzed {
            value: (levels, cycle_cells),
            completeness,
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Internal: dirty-set BFS
    // ═════════════════════════════════════════════════════════════════════════

    /// BFS expansion from changed cells + volatiles through cell and range edges.
    ///
    /// Seeds with `changed` + volatile cells, then walks cell-to-cell edges
    /// and range containment edges in a unified loop. When a cell's position
    /// is unknown, conservatively adds all range dependents (once).
    #[tracing::instrument(name = "collect_dirty_set", skip_all, fields(changed = changed.len()))]
    pub(super) fn collect_dirty_set(
        &self,
        changed: &[CellId],
        positions: &impl PositionResolver,
    ) -> (FxHashSet<CellId>, AnalysisCompleteness) {
        let mut dirty = FxHashSet::default();
        let mut completeness = AnalysisCompleteness::Exact;

        for cell in changed {
            dirty.insert(*cell);
        }
        for cell in &self.volatile_cells {
            dirty.insert(*cell);
        }

        // Core BFS logic mirrors `reachable_forward` in range_helpers.rs.
        // Kept separate for dirty-set-specific concerns: volatile cell seeding,
        // AnalysisCompleteness tracking, and the full-range-sweep fallback when
        // a cell's position can't be resolved.
        let mut did_full_range_sweep = false;
        let mut queue: VecDeque<CellId> = dirty.iter().copied().collect();
        while let Some(cell) = queue.pop_front() {
            if let Some(dep_set) = self.dependents.get(&cell) {
                for dep in dep_set {
                    if dirty.insert(*dep) {
                        queue.push_back(*dep);
                    }
                }
            }
            if let Some(CellPosition { sheet, row, col }) = positions.resolve(&cell) {
                // Early-exit: skip interval tree query if this sheet has no range deps.
                // Most sheets have no range deps, so this avoids unnecessary tree queries.
                if self.sheets_with_range_deps.contains(&sheet)
                    && let Some(tree) = self.range_index.get(&sheet)
                {
                    for rect in tree.query(row, col) {
                        if let Some(deps) = self.range_deps.get(rect) {
                            for dep in deps {
                                if dirty.insert(*dep) {
                                    queue.push_back(*dep);
                                }
                            }
                        }
                    }
                }
            } else if !did_full_range_sweep {
                warn!(
                    cell = ?cell,
                    range_entries = self.range_deps.len(),
                    "collect_dirty_set: cell has no position — falling back to full range sweep",
                );
                completeness = AnalysisCompleteness::Incomplete;
                did_full_range_sweep = true;
                for deps in self.range_deps.values() {
                    for dep in deps {
                        if dirty.insert(*dep) {
                            queue.push_back(*dep);
                        }
                    }
                }
            }
        }

        (dirty, completeness)
    }
}

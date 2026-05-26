//! Range resolution helpers — leaf functions for resolving range targets and reachability.

use std::collections::VecDeque;

use cell_types::{CellId, RangePos};
use rustc_hash::FxHashSet;

use crate::positions::{CellPosition, PositionResolver};
use crate::{DepTarget, DependencyGraph, RangeAccess};

use super::{SheetPositionIndex, cells_in_range};

impl DependencyGraph {
    /// Resolve all target cells within a range for a given formula cell and access mode.
    ///
    /// Applies access-mode filtering in one place:
    /// - **Aggregate self-ref** (cell inside its own SUM range): included
    /// - **Selective self-ref**: skipped
    /// - **Selective back-edge**: skipped (false cycle from INDEX-like patterns)
    /// - **Otherwise**: included
    pub(super) fn resolve_range_targets(
        &self,
        formula_cell: CellId,
        range: &RangePos,
        access: RangeAccess,
        sheet_cells: &SheetPositionIndex,
        positions: &impl PositionResolver,
    ) -> Vec<CellId> {
        // Precompute reachability once for selective ranges — O(V+E) total
        // instead of O(cells_in_range × (V+E)) with per-cell BFS.
        let reaching = (access == RangeAccess::Selective)
            .then(|| self.cells_reaching(formula_cell, positions));
        // Precompute aggregate ranges covering each position (fixed for formula_cell).
        let aggregate_ranges: Vec<&RangePos> = if access == RangeAccess::Selective {
            self.precedents
                .get(&formula_cell)
                .map(|precs| {
                    precs
                        .iter()
                        .filter_map(|p| match p {
                            DepTarget::Range(r, RangeAccess::Aggregate) => Some(r),
                            _ => None,
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let mut targets = Vec::new();
        for (row, col, cell) in cells_in_range(sheet_cells, range) {
            if cell == formula_cell {
                if access == RangeAccess::Aggregate {
                    targets.push(cell); // aggregate self-ref is real
                }
                // Selective self-ref: skip
                continue;
            }
            if access == RangeAccess::Selective {
                // If formula_cell also has an Aggregate dep covering this position,
                // the edge is real — not a false cycle.
                let has_aggregate = aggregate_ranges
                    .iter()
                    .any(|r| r.sheet() == range.sheet() && r.contains(row, col));
                if !has_aggregate && reaching.as_ref().unwrap().contains(&cell) {
                    continue;
                }
            }
            targets.push(cell);
        }
        targets
    }

    // NOTE: `is_selective_back_edge` and `can_transitively_reach` (the per-cell
    // forward BFS) have been replaced by `cells_reaching` (single reverse BFS
    // per target). All call sites now precompute the reaching set once and use
    // O(1) set membership checks. See `cells_reaching` below.

    /// Precompute the set of all cells that can transitively reach `target` by
    /// following dependent edges (cell deps + range containment).
    ///
    /// Semantically equivalent to: `{ c | can_transitively_reach(c, target) }`,
    /// computed via `reachable_forward` — a single O(V+E) BFS that follows both
    /// cell-to-cell and range-mediated dependent edges at every hop.
    #[tracing::instrument(name = "cells_reaching", skip_all)]
    pub(super) fn cells_reaching(
        &self,
        target: CellId,
        positions: &impl PositionResolver,
    ) -> FxHashSet<CellId> {
        self.reachable_forward(std::iter::once(target), positions)
    }

    /// Forward BFS through dependents + range edges.
    ///
    /// For each popped cell, follows:
    /// 1. Cell-to-cell dependent edges (`self.dependents`)
    /// 2. Range-mediated dependent edges (interval tree query at cell's position)
    ///
    /// Core BFS logic mirrors `collect_dirty_set` in `dirty_set.rs`, minus the
    /// volatile seeding and full-range-sweep fallback (those are dirty-set-specific).
    pub(super) fn reachable_forward(
        &self,
        seeds: impl IntoIterator<Item = CellId>,
        positions: &impl PositionResolver,
    ) -> FxHashSet<CellId> {
        let mut visited = FxHashSet::default();
        let mut visited_ranges: FxHashSet<RangePos> = FxHashSet::default();
        let mut queue: VecDeque<CellId> = VecDeque::new();
        for seed in seeds {
            if visited.insert(seed) {
                queue.push_back(seed);
            }
        }
        while let Some(cell) = queue.pop_front() {
            // Cell-to-cell dependents
            if let Some(dep_set) = self.dependents.get(&cell) {
                for dep in dep_set {
                    if visited.insert(*dep) {
                        queue.push_back(*dep);
                    }
                }
            }
            // Range-mediated dependents (same logic as collect_dirty_set)
            if let Some(CellPosition { sheet, row, col }) = positions.resolve(&cell) {
                if self.sheets_with_range_deps.contains(&sheet) {
                    if let Some(tree) = self.range_index.get(&sheet) {
                        for rect in tree.query(row, col) {
                            // After the first encounter, all deps of this range
                            // are in `visited` — re-iterating would find them all
                            // visited and enqueue nothing. Skip the O(deps) scan.
                            if visited_ranges.insert(*rect) {
                                if let Some(deps) = self.range_deps.get(rect) {
                                    for dep in deps {
                                        if visited.insert(*dep) {
                                            queue.push_back(*dep);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        visited
    }

    /// Resolve a cell's position into a sort key for deterministic level ordering.
    pub(super) fn resolve_sort_key(
        &self,
        cell: &CellId,
        positions: &impl PositionResolver,
    ) -> (u128, u32, u32) {
        let _ = &self; // keep as method for API consistency
        positions.resolve(cell).map_or_else(
            || (u128::MAX, u32::MAX, u32::MAX),
            |CellPosition { sheet, row, col }| (sheet.as_u128(), row, col),
        )
    }
}

//! Cycle detection — diagnostic cycle enumeration and hypothetical cycle checks.

use cell_types::CellId;
use rustc_hash::FxHashSet;

use crate::positions::{
    AnalysisCompleteness, Analyzed, HypotheticalDependencyEdit, PositionResolver, TrackedResolver,
};
use crate::{DepTarget, DependencyGraph, RangeAccess};

use super::{build_sheet_position_index, cells_in_range};

impl DependencyGraph {
    // ═════════════════════════════════════════════════════════════════════════
    // Step 5: Cycle APIs
    // ═════════════════════════════════════════════════════════════════════════

    /// Find all cycles in the graph using range-aware DFS.
    ///
    /// Returns an `Analyzed` wrapper containing a list of cycles, where each
    /// cycle is a `Vec<CellId>` of cells forming the cycle. Returns an empty
    /// `Vec` if the graph is acyclic. The `completeness` field indicates
    /// whether all cell positions were resolved; `Incomplete` means range-mediated
    /// cycles may have been missed.
    #[must_use]
    pub fn detect_cycles(&self, positions: &impl PositionResolver) -> Analyzed<Vec<Vec<CellId>>> {
        let tracker = TrackedResolver::new(positions);
        let mut cycles = Vec::new();
        let mut visited = FxHashSet::default();
        let mut on_stack = FxHashSet::default();
        let mut path = Vec::new();

        let sheet_cells = build_sheet_position_index(self.precedents.keys().copied(), &tracker);

        let get_cell_deps = |cell: &CellId| -> Vec<CellId> {
            self.precedents.get(cell).map_or_else(Vec::new, |precs| {
                let mut deps = Vec::new();
                for d in precs {
                    match d {
                        DepTarget::Cell(c) => deps.push(*c),
                        DepTarget::Range(rect, access) => {
                            deps.extend(self.resolve_range_targets(
                                *cell,
                                rect,
                                *access,
                                &sheet_cells,
                                positions,
                            ));
                        }
                    }
                }
                deps
            })
        };

        let mut all_cells: Vec<CellId> = self.precedents.keys().copied().collect();
        all_cells.sort_by_key(CellId::as_u128);
        for cell in &all_cells {
            if !visited.contains(cell) {
                crate::topo::dfs_cycle_walk(
                    cell,
                    &mut visited,
                    &mut on_stack,
                    &mut path,
                    &mut cycles,
                    &get_cell_deps,
                );
            }
        }

        Analyzed {
            value: cycles,
            completeness: tracker.completeness(),
        }
    }

    /// Hypothetical cycle check: would the proposed dependency edit create a cycle?
    ///
    /// **Boolean, infallible.** Evaluates cycle creation against the current
    /// graph state plus the proposed dependency replacement. The edit's cell
    /// may not yet exist in the graph.
    ///
    /// The position resolver should include the edit cell's position (use
    /// [`WithOverrides`](crate::positions::WithOverrides) to inject it if
    /// the cell isn't in the base resolver).
    ///
    /// # Panics
    ///
    /// Panics if a `Selective` range dep is encountered but the precomputed
    /// reaching set is `None` (this is unreachable by construction — the set
    /// is always computed when selective deps are present).
    #[allow(clippy::too_many_lines)]
    pub fn would_create_cycle(
        &self,
        edit: &HypotheticalDependencyEdit,
        positions: &impl PositionResolver,
    ) -> Analyzed<bool> {
        // Self-dependency check (any precedent IS the cell itself)
        for dep in &edit.new_precedents {
            if let DepTarget::Cell(dep_cell) = dep
                && *dep_cell == edit.cell
            {
                return Analyzed {
                    value: true,
                    completeness: AnalysisCompleteness::Exact,
                };
            }
        }

        // Build position index from all graph cells PLUS the proposed cell.
        let tracker = TrackedResolver::new(positions);
        let all_graph_cells = self.all_graph_cells();
        let sheet_cells = build_sheet_position_index(
            all_graph_cells
                .into_iter()
                .chain(std::iter::once(edit.cell)),
            &tracker,
        );

        // Collect DFS start points from new precedents.
        // Exclude edit.cell itself from range expansion — a cell inside its own
        // range dependency is not necessarily a cycle (e.g., INDEX(A:A, MATCH(...))
        // in cell A5 references the whole column but only reads one cell). True
        // self-referencing cycles are caught at recalc time by the topo sort.
        //
        // For Selective range deps, also exclude cells with back-edges to edit.cell
        // to avoid false cycle detection from INDEX-like patterns.
        //
        // Precompute reachability for edit.cell once — O(V+E) total instead of
        // O(cells_in_ranges × (V+E)) with per-cell forward BFS.
        let has_selective = edit
            .new_precedents
            .iter()
            .any(|p| matches!(p, DepTarget::Range(_, RangeAccess::Selective)));
        let reaching = has_selective.then(|| self.cells_reaching(edit.cell, positions));

        let mut start_cells = Vec::new();
        for dep in &edit.new_precedents {
            match dep {
                DepTarget::Cell(dep_cell) => start_cells.push(*dep_cell),
                DepTarget::Range(rect, access) => {
                    for (row, col, cell) in cells_in_range(&sheet_cells, rect) {
                        // Aggregate self-reference: cell inside its own SUM/AVERAGE range is always a cycle
                        if cell == edit.cell {
                            if *access == RangeAccess::Aggregate {
                                return Analyzed {
                                    value: true,
                                    completeness: AnalysisCompleteness::Exact,
                                };
                            }
                            // Selective: skip self (INDEX doesn't necessarily read self)
                            continue;
                        }
                        // For Selective ranges, skip cells that can transitively
                        // reach edit.cell — these are false cycle edges.
                        if *access == RangeAccess::Selective {
                            // Check if edit also has an Aggregate dep covering this position
                            let has_aggregate_in_edit = edit.new_precedents.iter().any(|p| {
                                matches!(
                                    p,
                                    DepTarget::Range(r, RangeAccess::Aggregate)
                                    if r.sheet() == rect.sheet() && r.contains(row, col)
                                )
                            });
                            if !has_aggregate_in_edit && reaching.as_ref().unwrap().contains(&cell)
                            {
                                continue;
                            }
                        }
                        start_cells.push(cell);
                    }
                }
            }
        }

        // DFS from start cells following precedent chains + range edges.
        // If edit.cell is found, the proposed edit creates a cycle.
        let mut visited = FxHashSet::default();
        let mut stack = start_cells;

        while let Some(current) = stack.pop() {
            if current == edit.cell {
                return Analyzed {
                    value: true,
                    completeness: AnalysisCompleteness::Exact,
                };
            }
            if !visited.insert(current) {
                continue;
            }
            if let Some(precs) = self.precedents.get(&current) {
                for dep in precs {
                    match dep {
                        DepTarget::Cell(dep_cell) => {
                            if !visited.contains(dep_cell) {
                                stack.push(*dep_cell);
                            }
                        }
                        DepTarget::Range(rect, access) => {
                            for cell in self.resolve_range_targets(
                                current,
                                rect,
                                *access,
                                &sheet_cells,
                                positions,
                            ) {
                                if !visited.contains(&cell) {
                                    stack.push(cell);
                                }
                            }
                        }
                    }
                }
            }

            // Track completeness: if a visited cell has no position, range edges
            // may be missed (but we never fabricate false cycles).
            // The tracker records misses automatically via resolve(), but the DFS
            // loop doesn't call resolve() for every visited cell. Explicitly check.
            tracker.resolve(&current);
        }

        Analyzed {
            value: false,
            completeness: tracker.completeness(),
        }
    }
}

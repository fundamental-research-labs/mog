//! Topological ordering — full-graph and subset evaluation ordering.

use cell_types::CellId;
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

use crate::positions::{AnalysisCompleteness, Analyzed, PositionResolver, TrackedResolver};
use crate::{DependencyGraph, GraphError};

type LevelGroups = Vec<Vec<CellId>>;

fn to_compact_index(value: usize) -> u32 {
    u32::try_from(value).expect("cell-only topo node count exceeds u32::MAX")
}

impl DependencyGraph {
    // ═════════════════════════════════════════════════════════════════════════
    // Step 4: Topological ordering
    // ═════════════════════════════════════════════════════════════════════════

    /// Full-graph evaluation order grouped by topological level.
    ///
    /// **Cycle-failing:** returns `Err(GraphError::CycleDetected)` if cycles exist.
    /// Used by full-recalc which routes cycles to `handle_cycles_and_recalc`.
    ///
    /// # Errors
    ///
    /// Returns `GraphError::CycleDetected` if the dependency graph contains cycles.
    #[tracing::instrument(name = "evaluation_levels", skip_all)]
    pub fn evaluation_levels(
        &self,
        positions: &impl PositionResolver,
    ) -> Result<Analyzed<Vec<Vec<CellId>>>, GraphError> {
        let tracker = TrackedResolver::new(positions);
        // Use formula_cells + volatile_cells as the seed set. Data cells are
        // included only when they appear as dependents of formula cells, ensuring
        // correct topological ordering while avoiding the full all_graph_cells()
        // scan of the entire dependency graph.
        let all_cells = self.formula_and_dep_cells();
        let result = self.barrier_topo(&all_cells, &tracker);

        if result.cycle_cores.is_empty() {
            let mut levels = result.levels;
            levels.extend(result.downstream_levels); // shouldn't exist, but defensive
            Ok(Analyzed {
                value: levels,
                completeness: tracker.completeness(),
            })
        } else {
            Err(GraphError::CycleDetected {
                cycle_cores: result.cycle_cores.into_iter().flatten().collect(),
                downstream: result.downstream_levels.into_iter().flatten().collect(),
            })
        }
    }

    /// Full-graph evaluation order with cycle and downstream information preserved.
    ///
    /// Unlike `evaluation_levels`, this always succeeds — cycles are returned
    /// alongside the non-cycle levels and downstream levels instead of causing
    /// an error. Callers can use the pre-computed results directly without
    /// recomputing affected cells or topo orders.
    #[tracing::instrument(name = "evaluation_levels", skip_all)]
    pub fn evaluation_levels_full(
        &self,
        positions: &impl PositionResolver,
    ) -> Analyzed<(LevelGroups, LevelGroups, LevelGroups)> {
        let tracker = TrackedResolver::new(positions);
        let all_cells = self.formula_and_dep_cells();
        let result = self.barrier_topo(&all_cells, &tracker);

        Analyzed {
            value: (result.levels, result.cycle_cores, result.downstream_levels),
            completeness: tracker.completeness(),
        }
    }

    /// Topological levels for a caller-specified cell subset.
    ///
    /// **Cycle-tolerant:** cycle cells are returned separately, never errors.
    /// Within each level, cells are sorted by row-major position order for
    /// deterministic evaluation matching Excel's behavior.
    ///
    /// Delegates to `barrier_topo` which uses the optimized barrier-graph
    /// construction with seed compression and colored BFS for false-cycle
    /// detection, instead of per-formula `cells_reaching` BFS calls.
    #[tracing::instrument(name = "subset_levels_graph", skip_all, fields(cell_count = cells.len()))]
    pub fn subset_levels(
        &self,
        cells: &[CellId],
        positions: &impl PositionResolver,
    ) -> Analyzed<(Vec<Vec<CellId>>, Vec<CellId>)> {
        if cells.is_empty() {
            return Analyzed {
                value: (Vec::new(), Vec::new()),
                completeness: AnalysisCompleteness::Exact,
            };
        }

        let tracker = TrackedResolver::new(positions);
        let cell_set: FxHashSet<CellId> = {
            let mut s = FxHashSet::with_capacity_and_hasher(cells.len(), FxBuildHasher);
            s.extend(cells.iter().copied());
            s
        };

        let result = self.barrier_topo(&cell_set, &tracker);

        // Sort each level by row-major position for deterministic evaluation order.
        let cmp_by_pos = |a: &CellId, b: &CellId| -> std::cmp::Ordering {
            let pos_a = self.resolve_sort_key(a, &tracker);
            let pos_b = self.resolve_sort_key(b, &tracker);
            pos_a.cmp(&pos_b)
        };

        let mut levels = result.levels;
        for level in &mut levels {
            level.sort_unstable_by(&cmp_by_pos);
        }

        // Append downstream levels (cells behind cycle cores).
        for mut level in result.downstream_levels {
            level.sort_unstable_by(&cmp_by_pos);
            levels.push(level);
        }

        // Flatten cycle cores into a single sorted vec.
        let mut cycle_cells: Vec<CellId> = result.cycle_cores.into_iter().flatten().collect();
        cycle_cells.sort_unstable_by(&cmp_by_pos);

        Analyzed {
            value: (levels, cycle_cells),
            completeness: tracker.completeness(),
        }
    }

    /// Lightweight topological sort using only cell-to-cell edges (no range barriers).
    ///
    /// Used for the selective dep fixup cascade where range ordering is already
    /// satisfied by the main evaluation pass. Avoids the expensive barrier graph
    /// construction (which requires position resolution and range containment
    /// lookups for all cells).
    ///
    /// Cycle cells (if any) are appended as a final level in arbitrary order.
    #[must_use]
    pub fn subset_levels_cell_only(&self, cells: &[CellId]) -> Vec<Vec<CellId>> {
        if cells.is_empty() {
            return Vec::new();
        }

        let n = cells.len();

        // Build CellId → u32 index mapping for compact graph
        let cell_to_idx: FxHashMap<CellId, u32> = cells
            .iter()
            .enumerate()
            .map(|(i, &c)| (c, to_compact_index(i)))
            .collect();

        // Compact adjacency list and in-degrees
        let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut in_degree: Vec<u32> = vec![0; n];

        for (i, &cell) in cells.iter().enumerate() {
            if let Some(precs) = self.precedents.get(&cell) {
                for dep in precs {
                    if let super::super::DepTarget::Cell(dep_cell) = dep {
                        if let Some(&dep_idx) = cell_to_idx.get(dep_cell) {
                            adj[dep_idx as usize].push(to_compact_index(i));
                            in_degree[i] += 1;
                        }
                    }
                }
            }
        }

        // Kahn's algorithm on compact indices
        let mut levels: Vec<Vec<CellId>> = Vec::new();
        let n_u32 = to_compact_index(n);
        let mut current: Vec<u32> = (0..n_u32).filter(|&i| in_degree[i as usize] == 0).collect();

        let mut processed = 0usize;
        while !current.is_empty() {
            let mut next = Vec::new();
            for &node in &current {
                processed += 1;
                for &dst in &adj[node as usize] {
                    in_degree[dst as usize] -= 1;
                    if in_degree[dst as usize] == 0 {
                        next.push(dst);
                    }
                }
            }
            levels.push(current.iter().map(|&i| cells[i as usize]).collect());
            current = next;
        }

        // Append leftover (cycle) cells as a final level
        if processed < n {
            let leftover: Vec<CellId> = (0..n_u32)
                .filter(|&i| in_degree[i as usize] > 0)
                .map(|i| cells[i as usize])
                .collect();
            if !leftover.is_empty() {
                levels.push(leftover);
            }
        }

        levels
    }
}

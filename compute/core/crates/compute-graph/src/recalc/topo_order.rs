//! Topological ordering — full-graph and subset evaluation ordering.

use cell_types::CellId;
use rustc_hash::{FxBuildHasher, FxHashSet};

use crate::positions::{AnalysisCompleteness, Analyzed, PositionResolver, TrackedResolver};
use crate::{DependencyGraph, GraphError};

use super::barrier_graph::RangeOrder;

type LevelGroups = Vec<Vec<CellId>>;

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
        let result = self.barrier_topo(RangeOrder::Aggregate, &all_cells, &tracker);

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
        let result = self.barrier_topo(RangeOrder::Aggregate, &all_cells, &tracker);

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

        let result = self.barrier_topo(RangeOrder::Aggregate, &cell_set, &tracker);

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

    /// Evaluation order for re-evaluating `cells` after the selective fixup
    /// re-read a selective dep and its value changed.
    ///
    /// The order of a recalc pass, and a range read selectively (INDEX,
    /// VLOOKUP, ...) orders its reader after the cells it holds as well, so
    /// each cell comes after every cell it can read.
    ///
    /// Returns `(levels, cycle_cores, downstream_levels)`. A cycle core that
    /// only a selective range closes is a selective dep whose range holds
    /// cells that depend on it: no order exists between them.
    #[tracing::instrument(name = "fixup_levels", skip_all, fields(cell_count = cells.len()))]
    pub fn fixup_levels(
        &self,
        cells: &FxHashSet<CellId>,
        positions: &impl PositionResolver,
    ) -> Analyzed<(LevelGroups, LevelGroups, LevelGroups)> {
        let tracker = TrackedResolver::new(positions);
        let result = self.barrier_topo(RangeOrder::All, cells, &tracker);
        Analyzed {
            value: (result.levels, result.cycle_cores, result.downstream_levels),
            completeness: tracker.completeness(),
        }
    }
}

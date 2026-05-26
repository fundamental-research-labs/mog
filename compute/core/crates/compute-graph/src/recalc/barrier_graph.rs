//! Barrier-graph construction and topological sort for range-aware evaluation ordering.
//!
//! Hybrid Kahn's + runtime deferral: selective range deps (INDEX, VLOOKUP, etc.)
//! get NO barriers here. The recalc driver runs a fixup pass after the main
//! evaluation to re-evaluate selective deps that may have read stale values.
//! This eliminates the O(S × C × BFS) colored BFS that was the performance and
//! memory bottleneck for large workbooks.

use cell_types::CellId;
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

use crate::positions::PositionResolver;
use crate::topo::{kahn_sort, tarjan_scc};
use crate::{DepTarget, DependencyGraph, RangeAccess};

use super::{TopoResult, build_sheet_position_index, cells_in_range};

// ─────────────────────────────────────────────────────────────────────────────
// Internal types — barrier graph for range-aware topo sort
// ─────────────────────────────────────────────────────────────────────────────

/// Compact barrier graph using u32 node indices instead of CellId/BarrierNodeId.
/// Real cells are indices 0..N-1, virtual barrier nodes are N..N+V-1.
struct CompactBarrierGraph {
    /// adj[node] = list of successors
    adj: Vec<Vec<u32>>,
    /// `in_degree[node]` = number of predecessors
    in_degree: Vec<u32>,
    /// Total number of nodes (real + virtual)
    node_count: u32,
    /// Number of real (cell) nodes — indices 0..real_count-1
    real_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum CompactNodeId {
    Idx(u32),
}

fn to_compact_index(value: usize) -> u32 {
    u32::try_from(value).expect("compact graph node count exceeds u32::MAX")
}

impl DependencyGraph {
    /// Shared barrier-graph topo sort. Returns `TopoResult` with cycle classification.
    ///
    /// Uses a compact u32-indexed graph representation for better cache locality
    /// and lower memory usage compared to `HashMap<CellId, Vec<CellId>>`.
    #[allow(clippy::too_many_lines)] // Single-pass topo/cycle handling keeps compact-graph invariants local.
    #[tracing::instrument(name = "barrier_topo", skip_all, fields(subset_size = subset.len()))]
    pub(super) fn barrier_topo(
        &self,
        subset: &FxHashSet<CellId>,
        positions: &impl PositionResolver,
    ) -> TopoResult {
        if subset.is_empty() {
            return TopoResult {
                levels: Vec::new(),
                cycle_cores: Vec::new(),
                downstream_levels: Vec::new(),
            };
        }

        // Build CellId ↔ u32 index mapping.
        // Use sorted Vec<(u128, u32)> + binary search instead of FxHashMap for
        // better cache locality and lower memory at 2.6M+ cell counts.
        let cells: Vec<CellId> = subset.iter().copied().collect();
        let real_count = to_compact_index(cells.len());

        let cell_to_idx: FxHashMap<CellId, u32> = {
            let mut map = FxHashMap::with_capacity_and_hasher(cells.len(), FxBuildHasher);
            for (i, &c) in cells.iter().enumerate() {
                map.insert(c, to_compact_index(i));
            }
            map
        };

        let bg = self.build_barrier_graph_compact(subset, positions, &cell_to_idx, real_count);

        let total_nodes = bg.node_count as usize;

        // Kahn's algorithm on compact graph
        let CompactBarrierGraph {
            adj,
            mut in_degree,
            node_count,
            real_count,
        } = bg;
        let mut levels: Vec<Vec<CellId>> = Vec::new();
        let mut current: Vec<u32> = (0..node_count)
            .filter(|&i| in_degree[i as usize] == 0)
            .collect();

        let mut processed = 0usize;
        while !current.is_empty() {
            let mut next = Vec::new();
            for &node in &current {
                processed += 1;
                for &dep in &adj[node as usize] {
                    in_degree[dep as usize] -= 1;
                    if in_degree[dep as usize] == 0 {
                        next.push(dep);
                    }
                }
            }
            let real_cells: Vec<CellId> = current
                .iter()
                .filter(|&&n| n < real_count)
                .map(|&n| cells[n as usize])
                .collect();
            if !real_cells.is_empty() {
                levels.push(real_cells);
            }
            current = next;
        }

        // Fast path: everything was scheduled
        if processed == total_nodes {
            return TopoResult {
                levels,
                cycle_cores: vec![],
                downstream_levels: vec![],
            };
        }

        // Cycle handling: convert back to compact node IDs for Tarjan SCC
        // (rare path — most workbooks don't have cycles in barrier graph)
        let leftover: FxHashSet<CompactNodeId> = (0..node_count)
            .filter(|&i| in_degree[i as usize] > 0)
            .map(CompactNodeId::Idx)
            .collect();

        let adj_map: FxHashMap<CompactNodeId, Vec<CompactNodeId>> = (0..node_count)
            .map(|i| {
                (
                    CompactNodeId::Idx(i),
                    adj[i as usize]
                        .iter()
                        .map(|&j| CompactNodeId::Idx(j))
                        .collect(),
                )
            })
            .collect();

        let sccs = tarjan_scc(&adj_map, &leftover);

        let mut core_nodes: FxHashSet<CompactNodeId> = FxHashSet::default();
        let mut cycle_cores: Vec<Vec<CellId>> = Vec::new();
        for scc in &sccs {
            let is_cycle = scc.len() > 1
                || (scc.len() == 1
                    && adj_map
                        .get(&scc[0])
                        .is_some_and(|deps| deps.iter().any(|d| *d == scc[0])));
            if is_cycle {
                core_nodes.extend(scc.iter());
                let scc_cells: Vec<CellId> = scc
                    .iter()
                    .filter_map(|n| match n {
                        CompactNodeId::Idx(i) if *i < real_count => Some(cells[*i as usize]),
                        CompactNodeId::Idx(_) => None,
                    })
                    .collect();
                if !scc_cells.is_empty() {
                    cycle_cores.push(scc_cells);
                }
            }
        }

        let downstream_levels_raw = kahn_sort(&adj_map, &leftover, &core_nodes);
        let downstream_levels: Vec<Vec<CellId>> = downstream_levels_raw
            .into_iter()
            .map(|level| {
                level
                    .into_iter()
                    .filter_map(|n| match n {
                        CompactNodeId::Idx(i) if i < real_count => Some(cells[i as usize]),
                        CompactNodeId::Idx(_) => None,
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|level| !level.is_empty())
            .collect();

        TopoResult {
            levels,
            cycle_cores,
            downstream_levels,
        }
    }

    /// Build compact barrier graph with u32 node indices.
    #[allow(clippy::too_many_lines)] // Range-barrier construction is deliberately one linear pass over dependencies.
    #[tracing::instrument(name = "build_barrier_graph", skip_all, fields(subset_size = subset.len()))]
    fn build_barrier_graph_compact(
        &self,
        subset: &FxHashSet<CellId>,
        positions: &impl PositionResolver,
        cell_to_idx: &FxHashMap<CellId, u32>,
        real_count: u32,
    ) -> CompactBarrierGraph {
        let n = subset.len();
        let mut next_virtual: u32 = real_count;

        // Pre-allocate node arrays
        let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n + 64];
        let mut in_degree: Vec<u32> = vec![0; n + 64];

        macro_rules! ensure_capacity {
            ($idx:expr) => {
                let idx = $idx as usize;
                if idx >= adj.len() {
                    let new_len = idx + 64;
                    adj.resize_with(new_len, Vec::new);
                    in_degree.resize(new_len, 0);
                }
            };
        }

        macro_rules! add_edge {
            ($from:expr, $to:expr) => {
                let from = $from as usize;
                let to = $to as usize;
                adj[from].push($to);
                in_degree[to] += 1;
            };
        }

        // Cell-to-cell edges
        for &cell in subset {
            if let Some(precs) = self.precedents.get(&cell) {
                let cell_idx = cell_to_idx[&cell];
                for dep in precs {
                    if let DepTarget::Cell(dep_cell) = dep {
                        if let Some(&dep_idx) = cell_to_idx.get(dep_cell) {
                            add_edge!(dep_idx, cell_idx);
                        }
                    }
                }
            }
        }

        let sheet_cells = build_sheet_position_index(subset.iter().copied(), positions);

        // Build idx→CellId reverse map for the range edge loop
        let idx_to_cell: Vec<CellId> = {
            let mut v = vec![CellId::from_raw(0); real_count as usize];
            for (&cell, &idx) in cell_to_idx {
                v[idx as usize] = cell;
            }
            v
        };

        // Range edges via virtual barrier nodes — aggregate deps only
        for (range_rect, dependent_formulas) in &self.range_deps {
            let deps_in_subset: Vec<u32> = dependent_formulas
                .iter()
                .filter_map(|f| cell_to_idx.get(f).copied())
                .collect();

            if deps_in_subset.is_empty() {
                continue;
            }

            let mut aggregate_deps: Vec<u32> = Vec::new();
            for &dep_idx in &deps_in_subset {
                let dep_cell = idx_to_cell[dep_idx as usize];
                let is_aggregate = self.precedents.get(&dep_cell).is_some_and(|precs| {
                    precs.iter().any(|p| {
                        matches!(
                            p,
                            DepTarget::Range(r, RangeAccess::Aggregate) if r == range_rect
                        )
                    })
                });
                if is_aggregate {
                    aggregate_deps.push(dep_idx);
                }
            }

            if aggregate_deps.is_empty() {
                continue;
            }

            let all_contained: Vec<u32> = cells_in_range(&sheet_cells, range_rect)
                .filter_map(|(_, _, cell)| cell_to_idx.get(&cell).copied())
                .collect();

            if !all_contained.is_empty() {
                let contained_set: FxHashSet<u32> = all_contained.iter().copied().collect();

                let (self_ref_aggs, normal_aggs): (Vec<_>, Vec<_>) = aggregate_deps
                    .iter()
                    .copied()
                    .partition(|d| contained_set.contains(d));

                for &dep in &self_ref_aggs {
                    for &cell in &all_contained {
                        add_edge!(cell, dep);
                    }
                }

                if !normal_aggs.is_empty() {
                    let barrier = next_virtual;
                    next_virtual += 1;
                    ensure_capacity!(barrier);
                    for &cell in &all_contained {
                        add_edge!(cell, barrier);
                    }
                    for &dep in &normal_aggs {
                        add_edge!(barrier, dep);
                    }
                }
            }
        }

        adj.truncate(next_virtual as usize);
        in_degree.truncate(next_virtual as usize);

        CompactBarrierGraph {
            adj,
            in_degree,
            node_count: next_virtual,
            real_count,
        }
    }
}

//! Depth computation and shared DFS helpers for cycle detection.
//!
//! Cell-only analysis methods (`detect_cycles`, `would_create_cycle`, `get_evaluation_order`)
//! have been removed. Use the position-aware methods on [`DependencyGraph`] in the
//! `analysis` module instead.

use std::hash::Hash;

use cell_types::CellId;
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

use super::{DepTarget, DependencyGraph};

impl DependencyGraph {
    /// Collect formula cells, volatile cells, and their direct cell-dep targets.
    ///
    /// Lighter than `all_graph_cells()` because it skips iterating all
    /// `dependents` values and `range_deps` values — those are subsets of
    /// `formula_cells`. Data cells appear only as direct `DepTarget::Cell`
    /// targets in precedent lists, which are already iterated.
    pub(crate) fn formula_and_dep_cells(&self) -> FxHashSet<CellId> {
        let estimated = self.formula_cells.len() + self.volatile_cells.len();
        let mut cells = FxHashSet::with_capacity_and_hasher(estimated * 2, FxBuildHasher);
        // Formula + volatile cells
        cells.extend(self.formula_cells.iter());
        cells.extend(self.volatile_cells.iter());
        // Direct cell-dep targets (includes data cells that formulas reference)
        for deps in self.precedents.values() {
            for dep in deps {
                if let DepTarget::Cell(target) = dep {
                    cells.insert(*target);
                }
            }
        }
        cells
    }

    /// Collect all cells in the graph (from `precedents`, `dependents`, `range_deps`,
    /// and `volatile_cells`).
    pub(crate) fn all_graph_cells(&self) -> FxHashSet<CellId> {
        let estimated = self.precedents.len()
            + self.dependents.len()
            + self.volatile_cells.len()
            + self.formula_cells.len();
        let mut all_cells = FxHashSet::with_capacity_and_hasher(estimated, FxBuildHasher);
        for cell in self.precedents.keys() {
            all_cells.insert(*cell);
        }
        for (cell, dep_set) in &self.dependents {
            all_cells.insert(*cell);
            for dep in dep_set {
                all_cells.insert(*dep);
            }
        }
        for deps in self.range_deps.values() {
            for cell in deps {
                all_cells.insert(*cell);
            }
        }
        for cell in &self.volatile_cells {
            all_cells.insert(*cell);
        }
        for cell in &self.formula_cells {
            all_cells.insert(*cell);
        }
        all_cells
    }

    // ─────────────────────────────────────────────────────────────────────
    // Depth / statistics
    // ─────────────────────────────────────────────────────────────────────

    /// Longest dependency chain (max depth).
    ///
    /// Only follows `DepTarget::Cell` edges. If cycles exist, cycle-back edges
    /// are treated as depth 0 (cycles do not contribute to depth). This means
    /// the returned value is the max depth of the acyclic portion of the graph.
    /// Use `detect_cycles()` first if you need to verify the graph is acyclic.
    ///
    /// **Cost:** O(V × D) where D = max depth, with memoization reducing
    /// repeated subtree traversals to O(1).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget};
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a = CellId::from_raw(1);
    /// let b = CellId::from_raw(2);
    /// let c = CellId::from_raw(3);
    ///
    /// graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    /// graph.set_precedents(&c, vec![DepTarget::Cell(b)]);
    /// assert_eq!(graph.max_depth(), 2); // c -> b -> a
    /// ```
    #[must_use]
    pub fn max_depth(&self) -> usize {
        let mut max = 0;
        let mut memo: FxHashMap<CellId, usize> = FxHashMap::default();
        let mut visiting = FxHashSet::default();

        for cell in self.precedents.keys() {
            visiting.clear();
            let depth = self.cell_depth(cell, &mut memo, &mut visiting);
            if depth > max {
                max = depth;
            }
        }

        max
    }

    // ─────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────

    /// Compute the depth of a cell's dependency chain (iterative with memoization).
    ///
    /// Uses an explicit stack to avoid stack overflow on deep dependency chains.
    /// Cycle-back edges are treated as depth 0.
    fn cell_depth(
        &self,
        root: &CellId,
        memo: &mut FxHashMap<CellId, usize>,
        visiting: &mut FxHashSet<CellId>,
    ) -> usize {
        if let Some(&depth) = memo.get(root) {
            return depth;
        }

        struct Frame {
            cell: CellId,
            deps: Vec<CellId>,
            idx: usize,
            max_child: usize,
        }

        let get_cell_deps = |cell: &CellId| -> Vec<CellId> {
            self.precedents.get(cell).map_or_else(Vec::new, |precs| {
                precs
                    .iter()
                    .filter_map(|d| {
                        if let DepTarget::Cell(c) = d {
                            Some(*c)
                        } else {
                            None
                        }
                    })
                    .collect()
            })
        };

        // Push root
        if !visiting.insert(*root) {
            return 0; // cycle
        }
        let deps = get_cell_deps(root);
        let mut stack: Vec<Frame> = vec![Frame {
            cell: *root,
            deps,
            idx: 0,
            max_child: 0,
        }];

        while let Some(frame) = stack.last_mut() {
            if frame.idx < frame.deps.len() {
                let dep = frame.deps[frame.idx];
                frame.idx += 1;

                // Check memo
                if let Some(&depth) = memo.get(&dep) {
                    let candidate = depth + 1;
                    if candidate > frame.max_child {
                        frame.max_child = candidate;
                    }
                    continue;
                }

                // Cycle guard
                if !visiting.insert(dep) {
                    continue; // cycle — treat as depth 0
                }

                // Push new frame
                let deps = get_cell_deps(&dep);
                stack.push(Frame {
                    cell: dep,
                    deps,
                    idx: 0,
                    max_child: 0,
                });
            } else {
                // Done with this cell
                let done = stack.pop().expect(
                    "invariant violation: depth stack empty after last_mut() returned Some",
                );
                visiting.remove(&done.cell);
                memo.insert(done.cell, done.max_child);

                // Propagate to parent
                if let Some(parent) = stack.last_mut() {
                    let candidate = done.max_child + 1;
                    if candidate > parent.max_child {
                        parent.max_child = candidate;
                    }
                }
            }
        }

        memo.get(root).copied().unwrap_or(0)
    }
}

/// Shared iterative DFS engine for cycle detection.
///
/// `get_cell_deps` returns the cell-level dependencies for a given cell.
/// `DependencyGraph::detect_cycles` delegates here with a range-aware resolver.
pub(crate) fn dfs_cycle_walk(
    start: &CellId,
    visited: &mut FxHashSet<CellId>,
    on_stack: &mut FxHashSet<CellId>,
    path: &mut Vec<CellId>,
    cycles: &mut Vec<Vec<CellId>>,
    get_cell_deps: &impl Fn(&CellId) -> Vec<CellId>,
) {
    // O(1) lookup from cell -> index in `path`, replacing O(N) linear scan.
    let mut path_index: FxHashMap<CellId, usize> = FxHashMap::default();

    let deps = get_cell_deps(start);
    let mut stack: Vec<(CellId, Vec<CellId>, usize)> = vec![(*start, deps, 0)];
    visited.insert(*start);
    on_stack.insert(*start);
    path_index.insert(*start, path.len());
    path.push(*start);

    while let Some(frame) = stack.last_mut() {
        if frame.2 < frame.1.len() {
            let dep_cell = frame.1[frame.2];
            frame.2 += 1;

            if visited.insert(dep_cell) {
                on_stack.insert(dep_cell);
                path_index.insert(dep_cell, path.len());
                path.push(dep_cell);
                let deps = get_cell_deps(&dep_cell);
                stack.push((dep_cell, deps, 0));
            } else if on_stack.contains(&dep_cell)
                && let Some(&pos) = path_index.get(&dep_cell)
            {
                cycles.push(path[pos..].to_vec());
            }
        } else {
            let (done_cell, _, _) = stack
                .pop()
                .expect("invariant violation: DFS stack empty after last_mut() returned Some");
            path.pop();
            on_stack.remove(&done_cell);
            path_index.remove(&done_cell);
        }
    }
}

/// Compute strongly connected components on a subgraph using iterative Tarjan's algorithm.
///
/// Only considers edges where both endpoints are in `nodes` (subgraph restriction).
/// Returns all SCCs. Caller filters by |SCC| >= 2 or self-loop to find cycle cores.
pub(crate) fn tarjan_scc<N: Copy + Eq + Hash>(
    adj: &FxHashMap<N, Vec<N>>,
    nodes: &FxHashSet<N>,
) -> Vec<Vec<N>> {
    let mut index_counter: u32 = 0;
    let mut node_index: FxHashMap<N, u32> = FxHashMap::default();
    let mut node_lowlink: FxHashMap<N, u32> = FxHashMap::default();
    let mut on_stack: FxHashSet<N> = FxHashSet::default();
    let mut stack: Vec<N> = Vec::new();
    let mut result: Vec<Vec<N>> = Vec::new();

    // Explicit DFS stack frames: (node, neighbor_iterator_index, initialized)
    struct Frame<N> {
        node: N,
        neighbors: Vec<N>,
        idx: usize,
    }

    for &start in nodes {
        if node_index.contains_key(&start) {
            continue;
        }

        let mut dfs_stack: Vec<Frame<N>> = Vec::new();

        // Initialize start node
        node_index.insert(start, index_counter);
        node_lowlink.insert(start, index_counter);
        index_counter += 1;
        on_stack.insert(start);
        stack.push(start);

        let neighbors: Vec<N> = adj.get(&start).map_or_else(Vec::new, |deps| {
            deps.iter().filter(|d| nodes.contains(d)).copied().collect()
        });
        dfs_stack.push(Frame {
            node: start,
            neighbors,
            idx: 0,
        });

        while let Some(frame) = dfs_stack.last_mut() {
            if frame.idx < frame.neighbors.len() {
                let w = frame.neighbors[frame.idx];
                frame.idx += 1;

                if let std::collections::hash_map::Entry::Vacant(e) = node_index.entry(w) {
                    // Not yet visited — push new frame
                    e.insert(index_counter);
                    node_lowlink.insert(w, index_counter);
                    index_counter += 1;
                    on_stack.insert(w);
                    stack.push(w);

                    let w_neighbors: Vec<N> = adj.get(&w).map_or_else(Vec::new, |deps| {
                        deps.iter().filter(|d| nodes.contains(d)).copied().collect()
                    });
                    dfs_stack.push(Frame {
                        node: w,
                        neighbors: w_neighbors,
                        idx: 0,
                    });
                } else if on_stack.contains(&w) {
                    // Back edge — update lowlink
                    let v = frame.node;
                    let v_low = node_lowlink[&v];
                    let w_idx = node_index[&w];
                    if w_idx < v_low {
                        node_lowlink.insert(v, w_idx);
                    }
                }
            } else {
                // Done processing this node
                let done = dfs_stack.pop().unwrap();
                let v = done.node;

                // Propagate lowlink to parent
                if let Some(parent) = dfs_stack.last() {
                    let p = parent.node;
                    let v_low = node_lowlink[&v];
                    let p_low = node_lowlink[&p];
                    if v_low < p_low {
                        node_lowlink.insert(p, v_low);
                    }
                }

                // If v is a root node, pop SCC from stack
                if node_lowlink[&v] == node_index[&v] {
                    let mut scc = Vec::new();
                    loop {
                        let w = stack.pop().expect("tarjan stack underflow");
                        on_stack.remove(&w);
                        scc.push(w);
                        if w == v {
                            break;
                        }
                    }
                    result.push(scc);
                }
            }
        }
    }

    result
}

/// Topo-sort a set of nodes after removing resolved nodes from the subgraph.
///
/// Computes fresh in-degrees for the subgraph of `nodes` (minus `resolved`),
/// then runs Kahn's algorithm. Returns topological levels.
pub(crate) fn kahn_sort<N: Copy + Eq + Hash>(
    adj: &FxHashMap<N, Vec<N>>,
    nodes: &FxHashSet<N>,
    resolved: &FxHashSet<N>,
) -> Vec<Vec<N>> {
    // Working set = nodes - resolved
    let working: FxHashSet<N> = nodes
        .iter()
        .filter(|n| !resolved.contains(n))
        .copied()
        .collect();
    if working.is_empty() {
        return Vec::new();
    }

    // Compute in-degrees from subgraph edges restricted to working set
    let mut in_deg: FxHashMap<N, usize> = working.iter().map(|&n| (n, 0)).collect();
    for &src in &working {
        if let Some(deps) = adj.get(&src) {
            for &dst in deps {
                if working.contains(&dst) {
                    *in_deg.entry(dst).or_insert(0) += 1;
                }
            }
        }
    }

    // Kahn's
    let mut levels: Vec<Vec<N>> = Vec::new();
    let mut current: Vec<N> = in_deg
        .iter()
        .filter(|&(_, &d)| d == 0)
        .map(|(&n, _)| n)
        .collect();

    while !current.is_empty() {
        let mut next = Vec::new();
        for &node in &current {
            if let Some(deps) = adj.get(&node) {
                for &dst in deps {
                    if let Some(deg) = in_deg.get_mut(&dst) {
                        *deg -= 1;
                        if *deg == 0 {
                            next.push(dst);
                        }
                    }
                }
            }
        }
        levels.push(std::mem::take(&mut current));
        current = next;
    }

    levels
}

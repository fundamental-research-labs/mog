use super::*;
use std::collections::VecDeque;

use rustc_hash::{FxHashMap, FxHashSet};

/// Brute-force BFS to find all affected cells from a set of changed cells.
///
/// Walks cell-to-cell and range containment edges by iterating ALL known
/// cells and checking containment (no spatial index). Seeds with `changed`
/// plus volatile cells.
pub(super) fn naive_affected_cells(
    graph: &DependencyGraph,
    positions: &impl Fn(&CellId) -> Option<CellPosition>,
    changed: &[CellId],
) -> FxHashSet<CellId> {
    let mut dirty: FxHashSet<CellId> = FxHashSet::default();
    for c in changed {
        dirty.insert(*c);
    }
    // Add volatiles
    for c in &graph.volatile_cells {
        dirty.insert(*c);
    }

    let mut queue: VecDeque<CellId> = dirty.iter().copied().collect();
    while let Some(cell) = queue.pop_front() {
        // Cell-to-cell dependents
        for dep in graph.get_dependents(&cell) {
            if dirty.insert(*dep) {
                queue.push_back(*dep);
            }
        }
        // Range containment: check if this cell's position is inside any range dep
        if let Some(pos) = positions(&cell) {
            for (range_rect, formula_cells) in &graph.range_deps {
                if range_rect.sheet() == pos.sheet && range_rect.contains(pos.row, pos.col) {
                    for fc in formula_cells {
                        if dirty.insert(*fc) {
                            queue.push_back(*fc);
                        }
                    }
                }
            }
        }
    }

    dirty
}

/// Brute-force topological sort using Kahn's algorithm on expanded edges.
///
/// Returns `Ok(sorted)` if acyclic, `Err(cycle_cells)` if cycles exist.
pub(super) fn naive_topo_sort(
    graph: &DependencyGraph,
    positions: &impl Fn(&CellId) -> Option<CellPosition>,
    subset: &FxHashSet<CellId>,
) -> Result<Vec<CellId>, Vec<CellId>> {
    if subset.is_empty() {
        return Ok(Vec::new());
    }

    // Build in-degree map and adjacency
    let mut in_degree: FxHashMap<CellId, usize> = FxHashMap::default();
    let mut adj: FxHashMap<CellId, Vec<CellId>> = FxHashMap::default();

    for &cell in subset {
        in_degree.entry(cell).or_insert(0);
    }

    for &cell in subset {
        // Cell-to-cell dependents within subset
        for dep in graph.get_dependents(&cell) {
            if subset.contains(dep) {
                adj.entry(cell).or_default().push(*dep);
                *in_degree.entry(*dep).or_insert(0) += 1;
            }
        }
        // Range containment edges
        if let Some(pos) = positions(&cell) {
            for (range_rect, formula_cells) in &graph.range_deps {
                if range_rect.sheet() == pos.sheet && range_rect.contains(pos.row, pos.col) {
                    for fc in formula_cells {
                        if subset.contains(fc) && *fc != cell {
                            // Avoid double-counting if also a cell-to-cell dep
                            if !graph.has_dependent(&cell, fc) {
                                adj.entry(cell).or_default().push(*fc);
                                *in_degree.entry(*fc).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // Kahn's
    let mut queue: VecDeque<CellId> = in_degree
        .iter()
        .filter(|(_, deg)| **deg == 0)
        .map(|(id, _)| *id)
        .collect();
    let mut sorted = Vec::new();

    while let Some(cell) = queue.pop_front() {
        sorted.push(cell);
        if let Some(deps) = adj.get(&cell) {
            for dep in deps {
                if let Some(degree) = in_degree.get_mut(dep) {
                    *degree -= 1;
                    if *degree == 0 {
                        queue.push_back(*dep);
                    }
                }
            }
        }
    }

    let cycle_cells: Vec<CellId> = in_degree
        .iter()
        .filter(|(_, deg)| **deg > 0)
        .map(|(id, _)| *id)
        .collect();

    if cycle_cells.is_empty() {
        Ok(sorted)
    } else {
        Err(cycle_cells)
    }
}

/// Brute-force cycle check: would adding `new_deps` to `cell` create a cycle?
///
/// DFS from each dependency target checking if `cell` is reachable.
#[allow(dead_code)] // Available for future oracle comparison tests
pub(super) fn naive_would_create_cycle(
    graph: &DependencyGraph,
    positions: &impl Fn(&CellId) -> Option<CellPosition>,
    cell: CellId,
    new_deps: &[DepTarget],
) -> bool {
    // Self-reference check
    for dep in new_deps {
        if let DepTarget::Cell(dep_cell) = dep {
            if *dep_cell == cell {
                return true;
            }
        }
    }

    // Check if cell is inside any of its own range deps
    if let Some(pos) = positions(&cell) {
        for dep in new_deps {
            if let DepTarget::Range(rect, _) = dep {
                if rect.sheet() == pos.sheet && rect.contains(pos.row, pos.col) {
                    return true;
                }
            }
        }
    }

    // Collect all positioned cells for range resolution
    let all_cells = graph.all_graph_cells();
    let all_positioned: Vec<(CellId, CellPosition)> = all_cells
        .iter()
        .chain(std::iter::once(&cell))
        .filter_map(|c| positions(c).map(|pos| (*c, pos)))
        .collect();

    // Expand new_deps to start cells
    let mut start_cells = Vec::new();
    for dep in new_deps {
        match dep {
            DepTarget::Cell(dep_cell) => start_cells.push(*dep_cell),
            DepTarget::Range(rect, _) => {
                for &(c, pos) in &all_positioned {
                    if rect.sheet() == pos.sheet && rect.contains(pos.row, pos.col) {
                        start_cells.push(c);
                    }
                }
            }
        }
    }

    // DFS from start_cells following precedent chains
    let mut visited = FxHashSet::default();
    let mut stack = start_cells;

    while let Some(current) = stack.pop() {
        if current == cell {
            return true;
        }
        if !visited.insert(current) {
            continue;
        }
        // Follow precedent chains
        for dep in graph.get_precedents(&current) {
            match dep {
                DepTarget::Cell(dep_cell) => {
                    if !visited.contains(dep_cell) {
                        stack.push(*dep_cell);
                    }
                }
                DepTarget::Range(rect, _) => {
                    for &(c, pos) in &all_positioned {
                        if rect.sheet() == pos.sheet
                            && rect.contains(pos.row, pos.col)
                            && !visited.contains(&c)
                        {
                            stack.push(c);
                        }
                    }
                }
            }
        }
    }

    false
}

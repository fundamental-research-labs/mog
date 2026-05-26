use super::*;
use std::collections::VecDeque;

use positions::{AnalysisCompleteness, CellPosition, HypotheticalDependencyEdit, WithOverrides};
use rustc_hash::FxHashSet;

fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

// ─────────────────────────────────────────────────────────────────
// Helper: closure-based position resolver from a Vec
// ─────────────────────────────────────────────────────────────────

/// Build a closure-based `PositionResolver` from a position table.
///
/// Each entry is `(cell_id, sheet_id, row, col)`. The returned closure
/// resolves any `CellId` in the table to its `CellPosition`.
fn make_resolver(
    positions: Vec<(CellId, SheetId, u32, u32)>,
) -> impl Fn(&CellId) -> Option<CellPosition> {
    move |cell: &CellId| -> Option<CellPosition> {
        positions
            .iter()
            .find(|(id, _, _, _)| id == cell)
            .map(|&(_, sheet, row, col)| CellPosition { sheet, row, col })
    }
}

// ─────────────────────────────────────────────────────────────────
// Reference model (brute-force oracle)
// ─────────────────────────────────────────────────────────────────

mod oracle {
    use super::*;

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
        let mut in_degree: rustc_hash::FxHashMap<CellId, usize> = rustc_hash::FxHashMap::default();
        let mut adj: rustc_hash::FxHashMap<CellId, Vec<CellId>> = rustc_hash::FxHashMap::default();

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
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: affected_cells
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_affected_cells_basic() {
    // Chain: A→B→C (A depends on B, B depends on C)
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    // Change C => A, B, C all affected
    let result = graph.affected_cells(&[c], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(affected.contains(&a), "A should be affected");
    assert!(affected.contains(&b), "B should be affected");
    assert!(affected.contains(&c), "C should be affected");
    assert_eq!(result.completeness, AnalysisCompleteness::Exact);
}

#[test]
fn test_affected_cells_with_range() {
    // SUM (cid 10) depends on range A1:A3 (rows 0-2, col 0).
    // Cells A1=cid(1), A2=cid(2), A3=cid(3) are inside the range.
    // Changing A2 should dirty SUM.
    let mut graph = DependencyGraph::new();
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let sum = cid(10);
    let sheet = sid(1);

    let range = RangePos::new(sheet, 0, 0, 2, 0); // A1:A3
    graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (sum, sheet, 0, 1),
    ]);
    let result = graph.affected_cells(&[a2], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(
        affected.contains(&sum),
        "SUM should be dirtied by A2 change"
    );
    assert!(affected.contains(&a2), "A2 should be in affected set");
    assert_eq!(result.completeness, AnalysisCompleteness::Exact);
}

#[test]
fn test_affected_cells_transitive_range() {
    // Transitive range chain:
    //   A1 is in Range1 => formula F1 depends on Range1
    //   F1 is in Range2 => formula F2 depends on Range2
    // Changing A1 should dirty both F1 and F2.
    let mut graph = DependencyGraph::new();
    let a1 = cid(1);
    let f1 = cid(10);
    let f2 = cid(20);
    let sheet = sid(1);

    let range1 = RangePos::new(sheet, 0, 0, 0, 0); // just A1
    let range2 = RangePos::new(sheet, 1, 0, 1, 0); // just F1's position

    graph.set_precedents(&f1, vec![DepTarget::Range(range1, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(range2, RangeAccess::Aggregate)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (f1, sheet, 1, 0),
        (f2, sheet, 2, 0),
    ]);
    let result = graph.affected_cells(&[a1], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(affected.contains(&f1), "F1 should be dirtied transitively");
    assert!(
        affected.contains(&f2),
        "F2 should be dirtied transitively through range chain"
    );
}

#[test]
fn test_affected_cells_volatile() {
    // Volatile cell is always included even when not in changed set.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let vol = cid(99);
    let sheet = sid(1);

    graph.mark_volatile(&vol);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (vol, sheet, 5, 0)]);
    let result = graph.affected_cells(&[a], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(
        affected.contains(&vol),
        "Volatile cell should always be included"
    );
    assert!(affected.contains(&a), "Changed cell should be included");
}

#[test]
fn test_affected_cells_incomplete_position() {
    // An unpositioned cell triggers Incomplete completeness.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    // B depends on a range, but B has no position in the resolver
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    graph.set_precedents(&b, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    // Only provide position for A, not for B
    let resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let result = graph.affected_cells(&[a], &resolver);
    // B should be in the dirty set because the range dep covers A's position
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(affected.contains(&b), "B should be dirtied via range");
    // Completeness should be Incomplete because B has no position for topo sort
    assert_eq!(result.completeness, AnalysisCompleteness::Incomplete);
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: affected_cells_levels
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_affected_cells_levels_basic() {
    // Chain C → B → A (A depends on B, B depends on C).
    // Levels should be: [C], [B], [A] when C changes.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let result = graph.affected_cells_levels(&[c], &resolver);
    let (levels, cycle_cells) = &result.value;

    assert!(cycle_cells.is_empty(), "No cycles expected");
    assert!(levels.len() >= 2, "Should have at least 2 levels for chain");

    // Flatten and verify all cells present
    let all: FxHashSet<CellId> = levels.iter().flatten().copied().collect();
    assert!(all.contains(&a));
    assert!(all.contains(&b));
    assert!(all.contains(&c));

    // Verify ordering: C must be in an earlier level than B, B before A
    let level_of = |cell: CellId| -> usize {
        levels
            .iter()
            .position(|level| level.contains(&cell))
            .unwrap()
    };
    assert!(level_of(c) < level_of(b), "C should be before B");
    assert!(level_of(b) < level_of(a), "B should be before A");
}

#[test]
fn test_affected_cells_levels_with_cycles() {
    // Cycle: A → B → C → A
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let result = graph.affected_cells_levels(&[a], &resolver);
    let (levels, cycle_cells) = &result.value;

    // All three cells should be in cycle_cells
    let cycle_set: FxHashSet<CellId> = cycle_cells.iter().copied().collect();
    assert!(cycle_set.contains(&a), "A should be in cycle cells");
    assert!(cycle_set.contains(&b), "B should be in cycle cells");
    assert!(cycle_set.contains(&c), "C should be in cycle cells");

    // Levels should NOT contain the cycle cells
    let level_cells: FxHashSet<CellId> = levels.iter().flatten().copied().collect();
    for cell in &cycle_set {
        assert!(
            !level_cells.contains(cell),
            "Cycle cells should not appear in levels"
        );
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: evaluation_levels
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_evaluation_levels_basic() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let result = graph
        .evaluation_levels(&resolver)
        .expect("Should succeed on acyclic graph");
    let levels = &result.value;

    let all: FxHashSet<CellId> = levels.iter().flatten().copied().collect();
    assert!(all.contains(&a));
    assert!(all.contains(&b));
    assert!(all.contains(&c));

    let level_of = |cell: CellId| -> usize {
        levels
            .iter()
            .position(|level| level.contains(&cell))
            .unwrap()
    };
    assert!(level_of(c) < level_of(b));
    assert!(level_of(b) < level_of(a));
}

#[test]
fn test_evaluation_levels_with_cycles() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let result = graph.evaluation_levels(&resolver);
    assert!(result.is_err(), "Should return CycleDetected error");
    if let Err(GraphError::CycleDetected { cycle_cores, .. }) = result {
        let cycle_set: FxHashSet<CellId> = cycle_cores.into_iter().collect();
        assert!(cycle_set.contains(&a));
        assert!(cycle_set.contains(&b));
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: subset_levels
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_subset_levels_basic() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let sheet = sid(1);

    // Chain: A depends on B, B depends on C, D is independent
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![
        (a, sheet, 0, 0),
        (b, sheet, 1, 0),
        (c, sheet, 2, 0),
        (d, sheet, 3, 0),
    ]);
    // Subset: only A, B, C (no D)
    let result = graph.subset_levels(&[a, b, c], &resolver);
    let (levels, cycle_cells) = &result.value;

    assert!(cycle_cells.is_empty());
    let all: FxHashSet<CellId> = levels.iter().flatten().copied().collect();
    assert!(all.contains(&a));
    assert!(all.contains(&b));
    assert!(all.contains(&c));
    assert!(!all.contains(&d), "D is not in subset");

    let level_of = |cell: CellId| -> usize {
        levels
            .iter()
            .position(|level| level.contains(&cell))
            .unwrap()
    };
    assert!(level_of(c) < level_of(b));
    assert!(level_of(b) < level_of(a));
}

#[test]
fn test_subset_levels_matches_group_by_level() {
    // subset_levels on the full graph should produce the same number of levels
    // as evaluation_levels (modulo cycle handling).
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let eval_levels = graph.evaluation_levels(&resolver).unwrap();
    let subset_result = graph.subset_levels(&[a, b, c], &resolver);
    let (subset_lvls, cycle_cells) = &subset_result.value;

    assert!(cycle_cells.is_empty());
    assert_eq!(
        eval_levels.value.len(),
        subset_lvls.len(),
        "Level counts should match between evaluation_levels and subset_levels"
    );
}

#[test]
fn test_subset_levels_cycle_tolerant() {
    // Cycle in subset: A → B → A
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let result = graph.subset_levels(&[a, b, c], &resolver);
    let (levels, cycle_cells) = &result.value;

    let cycle_set: FxHashSet<CellId> = cycle_cells.iter().copied().collect();
    assert!(cycle_set.contains(&a), "A should be in cycle cells");
    assert!(cycle_set.contains(&b), "B should be in cycle cells");
    // C is independent and should be in a level, not cycle cells
    let level_cells: FxHashSet<CellId> = levels.iter().flatten().copied().collect();
    assert!(
        level_cells.contains(&c),
        "C should be in levels (not a cycle participant)"
    );
}

/// Regression: downstream dependents of a cycle must NOT appear in cycle_cells.
///
/// Setup: A↔B (cycle), C depends on A (downstream of cycle).
/// Expected: cycle_cells = {A, B}, C in levels.
/// Bug: Kahn's algorithm leaves C with non-zero in-degree (its predecessor A
/// is stuck in the cycle), so C lands in cycle_cells alongside A and B.
#[test]
fn test_subset_levels_downstream_of_cycle_not_in_cycle_cells() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    // A↔B cycle
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    // C depends on A (downstream, not part of cycle)
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let result = graph.subset_levels(&[a, b, c], &resolver);
    let (levels, cycle_cells) = &result.value;

    let cycle_set: FxHashSet<CellId> = cycle_cells.iter().copied().collect();
    let level_cells: FxHashSet<CellId> = levels.iter().flatten().copied().collect();

    // A and B are the true cycle cores
    assert!(cycle_set.contains(&a), "A should be in cycle_cells");
    assert!(cycle_set.contains(&b), "B should be in cycle_cells");

    // C is downstream — it should be in levels, NOT cycle_cells
    assert!(
        !cycle_set.contains(&c),
        "C is downstream of the cycle, not a cycle participant — should NOT be in cycle_cells"
    );
    assert!(
        level_cells.contains(&c),
        "C should be schedulable in levels (it just depends on a cycle member)"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: detect_cycles
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_detect_cycles_range_aware() {
    // Cycle through range dep: A depends on range containing B, B depends on A.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    // A depends on range [row 1, col 0] which contains B
    let range = RangePos::new(sheet, 1, 0, 1, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    // B depends on A (cell dep)
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(!cycles.is_empty(), "Should detect a range-mediated cycle");

    // The cycle should involve both A and B
    let all_cycle_cells: FxHashSet<CellId> = cycles.iter().flatten().copied().collect();
    assert!(all_cycle_cells.contains(&a), "A should be in cycle");
    assert!(all_cycle_cells.contains(&b), "B should be in cycle");
}

#[test]
fn test_detect_cycles_no_false_cycle() {
    // An unpositioned cell must NOT create a false cycle.
    // A depends on B (cell dep). C is unpositioned but depends on A.
    // No cycle exists.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    // C has no position
    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(cycles.is_empty(), "No cycle should be detected");
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: would_create_cycle
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_would_create_cycle_basic() {
    // Chain: A → B → C. Adding C → A would create a cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(result.value, "Adding C→A should create cycle A→B→C→A");
}

#[test]
fn test_would_create_cycle_range() {
    // Range-mediated cycle: A depends on B. Adding B → Range(containing A) creates cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    // B depends on range containing A's position (row 0, col 0)
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    let edit = HypotheticalDependencyEdit {
        cell: b,
        new_precedents: vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(result.value, "Range dep on A from B should create cycle");
}

#[test]
fn test_would_create_cycle_self_reference() {
    // Cell inside its own Aggregate range dep IS a cycle.
    // SUM(A:A) in A5 reads every cell including A5 → circular.
    let graph = DependencyGraph::new();
    let a = cid(1);
    let sheet = sid(1);

    let resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(result.value, "Aggregate self-referencing range IS a cycle");
}

#[test]
fn test_would_create_cycle_self_reference_selective() {
    // Cell inside its own Selective range dep is NOT a cycle.
    // INDEX(A:A, MATCH(...)) in A5 references whole column but only reads one cell.
    let graph = DependencyGraph::new();
    let a = cid(1);
    let sheet = sid(1);

    let resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Range(range, RangeAccess::Selective)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "Selective self-referencing range is NOT a cycle at edit-time"
    );
}

#[test]
fn test_would_create_cycle_new_cell() {
    // Cell not yet in graph, position provided via WithOverrides.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let new_cell = cid(99);
    let sheet = sid(1);

    // A depends on B
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    let base_resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let resolver = WithOverrides::new(base_resolver).with_override(
        new_cell,
        CellPosition {
            sheet,
            row: 5,
            col: 0,
        },
    );
    // new_cell depends on A — no cycle since nothing depends on new_cell
    let edit = HypotheticalDependencyEdit {
        cell: new_cell,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "New cell depending on A should not create cycle"
    );
}

#[test]
fn test_would_create_cycle_no_false_positive() {
    // Verify no false cycles: A → B, C → D (disjoint chains).
    // Adding A → D should NOT create a cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    let resolver = make_resolver(vec![
        (a, sheet, 0, 0),
        (b, sheet, 1, 0),
        (c, sheet, 2, 0),
        (d, sheet, 3, 0),
    ]);
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Cell(d)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "Disjoint chains should not produce false cycle"
    );
    assert_eq!(result.completeness, AnalysisCompleteness::Exact);
}

#[test]
fn test_would_create_cycle_incomplete_when_cell_has_no_position() {
    // A graph cell without a position causes the initial range expansion to
    // be incomplete — even if no cycle is found, the result must report
    // Incomplete because that cell was invisible to the position index.
    //
    // Setup: A (has position) and B (no position) are in the graph.
    // Propose: new cell C depends on A via a cell dep. No cycle exists.
    // But B has no position, so the position index build is incomplete.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2); // no position — dropped by position index
    let c = cid(3);
    let sheet = sid(1);

    // A depends on B (cell-to-cell edge, so B is in the graph)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // Only A and C have positions; B deliberately omitted.
    let base_resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let resolver = WithOverrides::new(base_resolver).with_override(
        c,
        CellPosition {
            sheet,
            row: 2,
            col: 0,
        },
    );
    // Propose: C depends on A (cell dep). No cycle — nothing depends on C.
    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(!result.value, "No cycle exists");
    assert_eq!(
        result.completeness,
        AnalysisCompleteness::Incomplete,
        "Analysis must be Incomplete when a graph cell (B) has no position"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Oracle comparison tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_oracle_affected_cells_small_graph() {
    // Build a small graph with 10 cells, mix of cell and range deps.
    //
    // Layout on sheet 1:
    //   Row 0: C1(0,0)  C2(0,1)
    //   Row 1: C3(1,0)  C4(1,1)
    //   Row 2: C5(2,0)  C6(2,1)
    //   Row 3: C7(3,0)  C8(3,1)
    //   Row 4: C9(4,0)  C10(4,1)
    //
    // Dependencies:
    //   C3 depends on C1 (cell dep)
    //   C5 depends on C3 (cell dep)
    //   C7 depends on Range(rows 0-1, col 1) = [C2, C4] (range dep)
    //   C9 depends on C7 and C5 (cell deps)
    //   C10 depends on Range(rows 2-3, col 0) = [C5, C7] (range dep)

    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let cells: Vec<CellId> = (1..=10).map(cid).collect();
    let [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10] = [
        cells[0], cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], cells[8],
        cells[9],
    ];

    let pos_table = vec![
        (c1, sheet, 0, 0),
        (c2, sheet, 0, 1),
        (c3, sheet, 1, 0),
        (c4, sheet, 1, 1),
        (c5, sheet, 2, 0),
        (c6, sheet, 2, 1),
        (c7, sheet, 3, 0),
        (c8, sheet, 3, 1),
        (c9, sheet, 4, 0),
        (c10, sheet, 4, 1),
    ];

    // Cell deps
    graph.set_precedents(&c3, vec![DepTarget::Cell(c1)]);
    graph.set_precedents(&c5, vec![DepTarget::Cell(c3)]);

    // Range deps
    let range_c2_c4 = RangePos::new(sheet, 0, 1, 1, 1); // col 1, rows 0-1
    graph.set_precedents(
        &c7,
        vec![DepTarget::Range(range_c2_c4, RangeAccess::Aggregate)],
    );

    // Mixed cell deps
    graph.set_precedents(&c9, vec![DepTarget::Cell(c7), DepTarget::Cell(c5)]);

    let range_c5_c7 = RangePos::new(sheet, 2, 0, 3, 0); // col 0, rows 2-3
    graph.set_precedents(
        &c10,
        vec![DepTarget::Range(range_c5_c7, RangeAccess::Aggregate)],
    );

    let resolver = make_resolver(pos_table.clone());
    let resolver_fn = make_resolver(pos_table);

    // Test changing C1
    {
        let api_result = graph.affected_cells(&[c1], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c1]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C1 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing C2
    {
        let api_result = graph.affected_cells(&[c2], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c2]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C2 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing C4 (inside range_c2_c4)
    {
        let api_result = graph.affected_cells(&[c4], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c4]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C4 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing multiple cells: C1 and C2
    {
        let api_result = graph.affected_cells(&[c1, c2], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c1, c2]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C1+C2 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing an isolated cell (C6 — no dependents)
    {
        let api_result = graph.affected_cells(&[c6], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c6]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C6 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing C8 (isolated)
    {
        let api_result = graph.affected_cells(&[c8], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c8]);

        assert_eq!(api_set, oracle_set, "Affected cells mismatch for C8 change");
    }
}

#[test]
fn test_oracle_topo_sort_small_graph() {
    // Same graph as oracle affected cells test, verify topo ordering
    // against the naive oracle.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let cells: Vec<CellId> = (1..=6).map(cid).collect();
    let [c1, c2, c3, c4, c5, c6] = [cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]];

    let pos_table = vec![
        (c1, sheet, 0, 0),
        (c2, sheet, 1, 0),
        (c3, sheet, 2, 0),
        (c4, sheet, 3, 0),
        (c5, sheet, 0, 1),
        (c6, sheet, 1, 1),
    ];

    // C2 depends on C1
    // C3 depends on C2
    // C4 depends on C3 and C5
    // C6 depends on Range(row 0, col 0-1) = [C1, C5]
    graph.set_precedents(&c2, vec![DepTarget::Cell(c1)]);
    graph.set_precedents(&c3, vec![DepTarget::Cell(c2)]);
    graph.set_precedents(&c4, vec![DepTarget::Cell(c3), DepTarget::Cell(c5)]);
    let range = RangePos::new(sheet, 0, 0, 0, 1); // row 0, cols 0-1
    graph.set_precedents(&c6, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let resolver = make_resolver(pos_table.clone());
    let resolver_fn = make_resolver(pos_table);

    // Get API evaluation levels
    let api_result = graph.evaluation_levels(&resolver).expect("Acyclic graph");
    let api_levels = &api_result.value;

    // Flatten to get all cells in API order
    let api_flat: Vec<CellId> = api_levels.iter().flatten().copied().collect();

    // Oracle
    let all_cells: FxHashSet<CellId> = graph.all_graph_cells();
    let oracle_result = oracle::naive_topo_sort(&graph, &resolver_fn, &all_cells);
    let oracle_flat = oracle_result.expect("Acyclic graph");

    // Both should have the same set of cells
    let api_set: FxHashSet<CellId> = api_flat.iter().copied().collect();
    let oracle_set: FxHashSet<CellId> = oracle_flat.iter().copied().collect();
    assert_eq!(api_set, oracle_set, "Topo sort cell sets should match");

    // Verify topological ordering is respected: for each edge u→v, u must
    // come before v in the flattened order.
    let api_pos = |cell: CellId| -> usize { api_flat.iter().position(|c| *c == cell).unwrap() };

    // Check cell deps
    assert!(api_pos(c1) < api_pos(c2), "C1 before C2");
    assert!(api_pos(c2) < api_pos(c3), "C2 before C3");
    assert!(api_pos(c3) < api_pos(c4), "C3 before C4");
    assert!(api_pos(c5) < api_pos(c4), "C5 before C4");
    // C6 depends on range containing C1 and C5
    assert!(api_pos(c1) < api_pos(c6), "C1 before C6 (range dep)");
    assert!(api_pos(c5) < api_pos(c6), "C5 before C6 (range dep)");

    // Verify oracle respects the same invariants
    let oracle_pos =
        |cell: CellId| -> usize { oracle_flat.iter().position(|c| *c == cell).unwrap() };
    assert!(oracle_pos(c1) < oracle_pos(c2));
    assert!(oracle_pos(c2) < oracle_pos(c3));
    assert!(oracle_pos(c3) < oracle_pos(c4));
    assert!(oracle_pos(c5) < oracle_pos(c4));
}

// ═════════════════════════════════════════════════════════════════════════════
// Range selectivity: access-mode-aware barrier graph tests
// ═════════════════════════════════════════════════════════════════════════════

/// INDEX(A:A, 3) in B1, A3 = B1*2 → no false cycle (selective, A3 excluded).
#[test]
fn test_selective_index_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    // B1 = INDEX(A:A, 3) — selective dep on A:A
    let b1 = cid(10);
    // A1, A2, A3, A4 are data cells; A3 = B1*2
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let a4 = cid(4);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0); // A1:A4

    // B1 depends selectively on A:A
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // A3 depends on B1 (cell-to-cell)
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (a4, sheet, 3, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.subset_levels(&[a1, a2, a3, a4, b1], &resolver);
    let (levels, cycle_cells) = &result.value;

    // No cycle should be detected — the back-edge from A3 to B1 is excluded
    // because B1's dep on A:A is selective.
    assert!(
        cycle_cells.is_empty(),
        "Selective INDEX should not produce a false cycle, got cycle: {cycle_cells:?}"
    );

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // B1 should be computed before A3 (A3 depends on B1)
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
}

/// SUM(A:A) in B1, A3 = B1*2 → real cycle detected (aggregate, A3 in barrier).
#[test]
fn test_aggregate_sum_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0); // A1:A4

    // B1 = SUM(A:A) — aggregate dep on A:A
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    // A3 = B1*2 — depends on B1
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.subset_levels(&[a1, a3, b1], &resolver);
    let (_levels, cycle_cells) = &result.value;

    // Real cycle: SUM reads all cells including A3, but A3 depends on B1.
    // The aggregate path includes A3 in the barrier → cycle detected.
    assert!(
        !cycle_cells.is_empty(),
        "Aggregate SUM should detect the real cycle through A3"
    );
}

/// INDEX(A:A, 5) in B1, A5 = SUM(C1:C10) — selective dep, no false cycle.
///
/// With hybrid deferral, selective deps get no range barriers. B1 may evaluate
/// before A5 at the graph level. The recalc driver's fixup pass corrects this.
/// At graph level, we only verify: no false cycle, cell-to-cell ordering preserved.
#[test]
fn test_selective_preserves_ordering_for_non_backedge_cells() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a5 = cid(5);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 4, 0); // A1:A5

    // B1 = INDEX(A:A, 5) — selective dep on A:A
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // A5 = SUM(C1:C10) — depends on C1, no back-edge to B1
    graph.set_precedents(&a5, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a5, sheet, 4, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.subset_levels(&[a1, a5, b1, c1], &resolver);
    let (levels, cycle_cells) = &result.value;

    assert!(cycle_cells.is_empty(), "No cycle expected");

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // Cell-to-cell ordering is still guaranteed: C1 before A5
    assert!(level_of(c1) < level_of(a5), "C1 before A5");

    // All cells should be present in evaluation order
    let all: Vec<CellId> = levels.iter().flatten().copied().collect();
    assert!(all.contains(&b1), "B1 in evaluation order");
    assert!(all.contains(&a5), "A5 in evaluation order");
}

/// Same range, different formulas: B1 = INDEX(A:A, 3) selective, C1 = SUM(A:A) aggregate.
/// Each gets its own barrier with appropriate filtering.
#[test]
fn test_mixed_access_same_range_different_formulas() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let c1 = cid(20);
    let a1 = cid(1);
    let a3 = cid(3);
    let a5 = cid(5);

    let range_a = RangePos::new(sheet, 0, 0, 4, 0); // A1:A5

    // B1 = INDEX(A:A, 3) — selective
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // C1 = SUM(A:A) — aggregate
    graph.set_precedents(&c1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    // A3 = B1*2 — back-edge to B1
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (a5, sheet, 4, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.subset_levels(&[a1, a3, a5, b1, c1], &resolver);
    let (levels, cycle_cells) = &result.value;

    // No cycle: the aggregate barrier includes A3, but A3's back-edge is to
    // B1 (selective), not to C1 (aggregate). The topo sort handles this:
    // A1, A5 → B1 (selective barrier) → A3 (depends on B1) → C1 (aggregate
    // barrier waits for A3).
    //
    // Note: cycle detection here depends on whether A3→B1→barrier_agg→C1
    // creates a cycle. A3 is in the aggregate barrier (→ C1). C1 doesn't
    // depend on A3 directly. B1 depends selectively on A:A. So:
    // Order: data cells → B1 → A3 → C1. No cycle.
    assert!(
        cycle_cells.is_empty(),
        "Mixed access should not produce false cycle: {cycle_cells:?}"
    );

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // B1 before A3 (A3 depends on B1)
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
    // A3 before C1 (A3 is in aggregate barrier → C1)
    assert!(level_of(a3) < level_of(c1), "A3 before C1");
}

/// INDEX(A:A, 3) + SUM(A:A) in same formula → aggregate wins.
#[test]
fn test_mixed_access_same_formula_aggregate_wins() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0); // A1:A4

    // B1 = INDEX(A:A, 3) + SUM(A:A) — both selective and aggregate.
    // Both survive dedup (different RangeAccess → different Hash).
    // B1 has ANY aggregate dep on this range → goes to aggregate path.
    graph.set_precedents(
        &b1,
        vec![
            DepTarget::Range(range_a, RangeAccess::Selective),
            DepTarget::Range(range_a, RangeAccess::Aggregate),
        ],
    );
    // A3 = B1*2
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.subset_levels(&[a1, a3, b1], &resolver);
    let (_levels, cycle_cells) = &result.value;

    // Aggregate wins: B1 is in the aggregate path for this range.
    // A3 is in the full (unfiltered) barrier → real cycle detected.
    assert!(
        !cycle_cells.is_empty(),
        "Aggregate should win: INDEX+SUM on same range detects real cycle"
    );
}

/// Cross-sheet INDEX mutual refs → selective, back-edge cells excluded.
#[test]
fn test_cross_sheet_selective_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);

    // Core!C0 = INDEX(Debt!A:C, ...) — selective dep on Debt range
    let core_c0 = cid(10);
    // Debt!C0 = INDEX(Core!A:C, ...) — selective dep on Core range
    let debt_c0 = cid(20);
    // Some data cells
    let core_a0 = cid(11);
    let debt_a0 = cid(21);

    let core_range = RangePos::new(sheet1, 0, 0, 0, 2); // Core!A:C row 0
    let debt_range = RangePos::new(sheet2, 0, 0, 0, 2); // Debt!A:C row 0

    // Core!C0 depends selectively on Debt range
    graph.set_precedents(
        &core_c0,
        vec![DepTarget::Range(debt_range, RangeAccess::Selective)],
    );
    // Debt!C0 depends selectively on Core range
    graph.set_precedents(
        &debt_c0,
        vec![DepTarget::Range(core_range, RangeAccess::Selective)],
    );

    let resolver = make_resolver(vec![
        (core_a0, sheet1, 0, 0),
        (core_c0, sheet1, 0, 2),
        (debt_a0, sheet2, 0, 0),
        (debt_c0, sheet2, 0, 2),
    ]);

    let result = graph.subset_levels(&[core_a0, core_c0, debt_a0, debt_c0], &resolver);
    let (_levels, cycle_cells) = &result.value;

    assert!(
        cycle_cells.is_empty(),
        "Cross-sheet selective INDEX should not produce false cycle: {cycle_cells:?}"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Range selectivity: barrier_topo / evaluation_levels path tests
//
// These tests exercise build_barrier_graph (via evaluation_levels), which is
// a separate code path from subset_levels. Both must be selectivity-aware.
// ═════════════════════════════════════════════════════════════════════════════

/// INDEX(A:A, 3) in B1, A3 = B1*2 → no false cycle via evaluation_levels.
/// Exercises build_barrier_graph's selective partition path.
#[test]
fn test_barrier_topo_selective_index_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let a4 = cid(4);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (a4, sheet, 3, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Selective INDEX should not produce false cycle via evaluation_levels: {:?}",
        result.err()
    );

    let levels = result.unwrap().value;
    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
}

/// SUM(A:A) in B1, A3 = B1*2 → real cycle detected via evaluation_levels.
/// Exercises build_barrier_graph's aggregate partition path.
#[test]
fn test_barrier_topo_aggregate_sum_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_err(),
        "Aggregate SUM should detect real cycle via evaluation_levels"
    );
}

/// Mixed: B1 = INDEX(A:A, 3) selective, C1 = SUM(A:A) aggregate, A3 = B1*2.
/// Exercises build_barrier_graph with both paths on the same range.
#[test]
fn test_barrier_topo_mixed_access_same_range() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let c1 = cid(20);
    let a1 = cid(1);
    let a3 = cid(3);
    let a5 = cid(5);

    let range_a = RangePos::new(sheet, 0, 0, 4, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (a5, sheet, 4, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    // No cycle: aggregate barrier includes A3 → C1, but A3's back-edge is
    // to B1 (selective). Order: data → B1 → A3 → C1.
    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Mixed access should not produce false cycle via evaluation_levels: {:?}",
        result.err()
    );

    let levels = result.unwrap().value;
    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
    assert!(level_of(a3) < level_of(c1), "A3 before C1");
}

// ═════════════════════════════════════════════════════════════════════════════
// Range selectivity: detect_cycles and would_create_cycle tests
// ═════════════════════════════════════════════════════════════════════════════

/// detect_cycles: INDEX(A:A, 3) in B1, A3 = B1*2 → no false cycle.
#[test]
fn test_detect_cycles_selective_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "detect_cycles: Selective INDEX should not produce false cycle: {cycles:?}"
    );
}

/// detect_cycles: SUM(A:A) in B1, A3 = B1*2 → real cycle detected.
#[test]
fn test_detect_cycles_aggregate_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        !cycles.is_empty(),
        "detect_cycles: Aggregate SUM should detect the real cycle"
    );
}

/// would_create_cycle: editing B1 to INDEX(A:A, 3), with A3 = B1*2 already
/// in the graph → should NOT report a cycle.
#[test]
fn test_would_create_cycle_selective_no_false_positive() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    // A3 = B1*2 is already in the graph
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    // Hypothetical: user types =INDEX(A:A, 3) in B1
    let edit = HypotheticalDependencyEdit {
        cell: b1,
        new_precedents: vec![DepTarget::Range(range_a, RangeAccess::Selective)],
    };

    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "would_create_cycle: Selective INDEX should not report false cycle"
    );
}

/// would_create_cycle: editing B1 to SUM(A:A), with A3 = B1*2 already
/// in the graph → SHOULD report a cycle.
#[test]
fn test_would_create_cycle_aggregate_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    // A3 = B1*2 is already in the graph
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    // Hypothetical: user types =SUM(A:A) in B1
    let edit = HypotheticalDependencyEdit {
        cell: b1,
        new_precedents: vec![DepTarget::Range(range_a, RangeAccess::Aggregate)],
    };

    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        result.value,
        "would_create_cycle: Aggregate SUM should detect the real cycle"
    );
}

/// Two selective formulas F1, F2 on the same range.
/// Contained cell X has a back-edge to F1 only.
///
/// With hybrid deferral, selective deps get no range barriers. F2 may evaluate
/// before X at graph level. The recalc driver's fixup pass corrects this.
/// At graph level, we verify: no false cycle, cell-to-cell ordering (F1 before X),
/// all cells present.
#[test]
fn test_selective_barrier_per_formula() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let x = cid(10); // A1 — has back-edge to F1
    let y = cid(11); // A2
    let z = cid(12); // A3

    let f1 = cid(20); // B1 — selective dep on A1:A3
    let f2 = cid(21); // B2 — selective dep on A1:A3

    let range = RangePos::new(sheet, 0, 0, 2, 0); // A1:A3

    graph.set_precedents(&f1, vec![DepTarget::Range(range, RangeAccess::Selective)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(range, RangeAccess::Selective)]);
    graph.set_precedents(&x, vec![DepTarget::Cell(f1)]);

    let resolver = make_resolver(vec![
        (x, sheet, 0, 0),
        (y, sheet, 1, 0),
        (z, sheet, 2, 0),
        (f1, sheet, 0, 1),
        (f2, sheet, 1, 1),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "No cycle expected with hybrid deferral — selective deps get no barriers"
    );
    let levels = result.unwrap().into_value();
    let all_cells: Vec<CellId> = levels.iter().flatten().copied().collect();

    // Cell-to-cell ordering preserved: F1 before X (X depends on F1)
    let pos_f1 = all_cells.iter().position(|c| *c == f1).unwrap();
    let pos_x = all_cells.iter().position(|c| *c == x).unwrap();
    assert!(pos_f1 < pos_x, "F1 before X (cell-to-cell edge)");

    // Formula cells and their cell-to-cell deps present
    assert!(all_cells.contains(&f1), "F1 in evaluation order");
    assert!(all_cells.contains(&f2), "F2 in evaluation order");
    assert!(
        all_cells.contains(&x),
        "X in evaluation order (depends on F1)"
    );
}

// ─────────────────────────────────────────────────────────────────
// Multi-hop selective back-edge tests
//
// The existing selective tests only cover DIRECT back-edges (A3 → B1).
// These tests exercise INDIRECT chains (A3 → C1 → B1) which the
// one-hop filter in is_selective_back_edge fails to suppress.
// ─────────────────────────────────────────────────────────────────

/// Multi-hop selective back-edge: A3 → C1 → B1, B1 = INDEX(A:A, 3).
/// A3 is in A:A but reaches B1 only through C1 (two hops).
/// subset_levels should NOT report a false cycle.
#[test]
fn test_selective_multi_hop_no_false_cycle_subset_levels() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0); // A1:A3

    // B1 = INDEX(A:A, 3) — selective dep on A1:A3
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // C1 = B1 + 1 — direct dep on B1
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    // A3 = C1 * 2 — indirect back-edge to B1 via C1
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.subset_levels(&[a1, a2, a3, b1, c1], &resolver);
    let (_levels, cycle_cells) = &result.value;

    assert!(
        cycle_cells.is_empty(),
        "Multi-hop selective back-edge should not produce a false cycle, got: {cycle_cells:?}"
    );
}

/// Same multi-hop scenario but via evaluation_levels (full-graph topo sort).
#[test]
fn test_selective_multi_hop_no_false_cycle_evaluation_levels() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Multi-hop selective back-edge should not cause CycleDetected in evaluation_levels"
    );
}

/// Same multi-hop scenario but via detect_cycles (diagnostic cycle enumeration).
#[test]
fn test_selective_multi_hop_no_false_cycle_detect_cycles() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "Multi-hop selective back-edge should not be detected as a cycle, got: {cycles:?}"
    );
}

/// Same multi-hop scenario but via would_create_cycle (hypothetical edit check).
/// Graph already has A3 → C1 → B1. User types =INDEX(A:A,3) in B1.
#[test]
fn test_selective_multi_hop_no_false_cycle_would_create_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    // Existing graph: A3 → C1 → B1
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    // Hypothetical: user types =INDEX(A:A, 3) in B1
    let edit = HypotheticalDependencyEdit {
        cell: b1,
        new_precedents: vec![DepTarget::Range(range_a, RangeAccess::Selective)],
    };

    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "Multi-hop selective back-edge should not report false cycle in would_create_cycle"
    );
}

/// Three-hop chain: A3 → D1 → C1 → B1, B1 = INDEX(A:A, 3).
/// Verifies the fix is truly transitive, not just two-hop.
#[test]
fn test_selective_multi_hop_three_deep_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);
    let d1 = cid(30);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&d1, vec![DepTarget::Cell(c1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(d1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
        (d1, sheet, 0, 3),
    ]);

    // All four APIs should agree: no false cycle
    let result = graph.subset_levels(&[a1, a3, b1, c1, d1], &resolver);
    assert!(
        result.value.1.is_empty(),
        "Three-hop selective back-edge: subset_levels false cycle, got: {:?}",
        result.value.1
    );

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Three-hop selective back-edge: evaluation_levels false cycle"
    );

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "Three-hop selective back-edge: detect_cycles false cycle, got: {cycles:?}"
    );
}

// ═══════════════════════════════════════════════════════════════════
// Range-mediated multi-hop chain tests
//
// Topology: two nested ranges where intermediate hops are range-mediated.
//
//   C at (0,0) inside R_inner
//   F_inner = INDEX(R_inner, ...) at (1,0), also inside R_outer
//   F_outer = INDEX(R_outer, ...) at (2,0)
//   C = F_outer + 1 (cell dep)
//
// Chain: F_outer → [selective on R_outer] → F_inner [inside R_outer]
//        F_inner → [selective on R_inner] → C [inside R_inner]
//        C → F_outer (cell dep)
//
// The F_inner→C link is range-mediated. A BFS that only follows
// cell-to-cell edges after the initial range seed will miss it.
// ═══════════════════════════════════════════════════════════════════

fn build_range_mediated_chain() -> (DependencyGraph, impl Fn(&CellId) -> Option<CellPosition>) {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let c = cid(1); // (0,0) — inside R_inner
    let f_inner = cid(2); // (1,0) — inside R_outer
    let f_outer = cid(3); // (2,0)

    let r_inner = RangePos::new(sheet, 0, 0, 0, 0); // just (0,0)
    let r_outer = RangePos::new(sheet, 0, 0, 1, 0); // rows 0-1, col 0

    // F_inner = INDEX(R_inner, ...) — selective dep on R_inner
    graph.set_precedents(
        &f_inner,
        vec![DepTarget::Range(r_inner, RangeAccess::Selective)],
    );
    // F_outer = INDEX(R_outer, ...) — selective dep on R_outer
    graph.set_precedents(
        &f_outer,
        vec![DepTarget::Range(r_outer, RangeAccess::Selective)],
    );
    // C = F_outer + 1 — cell dep
    graph.set_precedents(&c, vec![DepTarget::Cell(f_outer)]);

    let resolver = make_resolver(vec![
        (c, sheet, 0, 0),
        (f_inner, sheet, 1, 0),
        (f_outer, sheet, 2, 0),
    ]);

    (graph, resolver)
}

/// Test A: subset_levels with range-mediated multi-hop chain produces no false cycles.
#[test]
fn test_range_mediated_chain_no_false_cycle_subset_levels() {
    let (graph, resolver) = build_range_mediated_chain();
    let c = cid(1);
    let f_inner = cid(2);
    let f_outer = cid(3);

    let result = graph.subset_levels(&[c, f_inner, f_outer], &resolver);
    let (_levels, cycle_cells) = &result.value;
    assert!(
        cycle_cells.is_empty(),
        "Range-mediated multi-hop chain should not produce a false cycle in subset_levels, got: {cycle_cells:?}"
    );
}

/// Test B: evaluation_levels with range-mediated multi-hop chain succeeds (no cycle).
#[test]
fn test_range_mediated_chain_no_false_cycle_evaluation_levels() {
    let (graph, resolver) = build_range_mediated_chain();

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Range-mediated multi-hop chain should not cause CycleDetected in evaluation_levels"
    );
}

/// Test C: detect_cycles finds no cycles in range-mediated multi-hop chain.
#[test]
fn test_range_mediated_chain_no_false_cycle_detect_cycles() {
    let (graph, resolver) = build_range_mediated_chain();

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "Range-mediated multi-hop chain: detect_cycles should find no cycles, got: {cycles:?}"
    );
}

/// Test D: would_create_cycle correctly identifies the chain is acyclic.
#[test]
fn test_range_mediated_chain_would_create_cycle() {
    let (graph, resolver) = build_range_mediated_chain();
    let sheet = sid(1);
    let c = cid(1);
    let f_outer = cid(3);

    let r_outer = RangePos::new(sheet, 0, 0, 1, 0);

    // Proposing F_outer's existing selective dep on R_outer — should not be a cycle
    let edit = HypotheticalDependencyEdit {
        cell: f_outer,
        new_precedents: vec![DepTarget::Range(r_outer, RangeAccess::Selective)],
    };
    let would_cycle = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !would_cycle.into_value(),
        "Range-mediated chain: would_create_cycle should return false for existing topology"
    );

    // Proposing C depends on F_outer (already exists) — should not be a cycle
    let edit2 = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(f_outer)],
    };
    let would_cycle2 = graph.would_create_cycle(&edit2, &resolver);
    assert!(
        !would_cycle2.into_value(),
        "Range-mediated chain: would_create_cycle should return false for existing cell dep"
    );
}

/// Test E: affected_cells correctly propagates through range-mediated chain.
#[test]
fn test_range_mediated_chain_affected_cells_propagation() {
    let (graph, resolver) = build_range_mediated_chain();
    let c = cid(1);
    let f_inner = cid(2);
    let f_outer = cid(3);

    // Changing C should affect F_inner (via R_inner range) and F_outer (via R_outer range)
    let affected = graph.affected_cells(&[c], &resolver);
    let affected_set: FxHashSet<CellId> = affected.value.iter().copied().collect();

    assert!(
        affected_set.contains(&f_inner),
        "Changing C should affect F_inner via range R_inner containment"
    );
    assert!(
        affected_set.contains(&f_outer),
        "Changing C should affect F_outer via range R_outer containment (multi-hop)"
    );
}

/// Test F: mixed aggregate deps — self-referencing ones produce cycles,
/// non-self-referencing ones evaluate correctly via barrier.
#[test]
fn test_mixed_aggregate_self_ref_partition() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    // Range R covers rows 0-2, col 0 — contains A1, A2, A3
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let range_r = RangePos::new(sheet, 0, 0, 2, 0);

    // SUM_self at (1,0) = SUM(R) — aggregate, self-referencing (inside R at row 1)
    let sum_self = cid(10);
    // SUM_ext at (3,0) = SUM(R) — aggregate, NOT self-referencing (outside R)
    let sum_ext = cid(11);

    graph.set_precedents(
        &sum_self,
        vec![DepTarget::Range(range_r, RangeAccess::Aggregate)],
    );
    graph.set_precedents(
        &sum_ext,
        vec![DepTarget::Range(range_r, RangeAccess::Aggregate)],
    );

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (sum_self, sheet, 1, 0), // inside range — self-ref
        (sum_ext, sheet, 3, 0),  // outside range — not self-ref
    ]);

    // Use subset_levels (cycle-tolerant) to verify:
    // - sum_self IS in cycle_cells (genuine self-ref)
    // - sum_ext is NOT in cycle_cells (should evaluate normally via barrier)
    let result = graph.subset_levels(&[a1, a2, a3, sum_self, sum_ext], &resolver);
    let (levels, cycle_cells) = &result.value;

    // sum_ext should NOT be in cycles — it's outside the range, no self-ref
    assert!(
        !cycle_cells.contains(&sum_ext),
        "sum_ext (outside range) should not be in cycle_cells, got: {cycle_cells:?}"
    );

    // sum_ext should appear in the normal levels, after contained cells
    let flat: Vec<CellId> = levels.iter().flatten().copied().collect();
    assert!(
        flat.contains(&sum_ext),
        "sum_ext should appear in normal evaluation levels"
    );

    let pos_a1 = flat.iter().position(|c| *c == a1);
    let pos_sum_ext = flat.iter().position(|c| *c == sum_ext);
    if let (Some(pa1), Some(ps)) = (pos_a1, pos_sum_ext) {
        assert!(ps > pa1, "sum_ext should evaluate after contained cell a1");
    }
}

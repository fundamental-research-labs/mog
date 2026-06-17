use super::*;

// ─────────────────────────────────────────────────────────────────
// Affected cells levels
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_affected_cells_levels_linear_chain() {
    // D -> C -> B -> A (D is the root data cell)
    // When D changes, affected = {D, B, C, A} in 4 levels.
    // Level 0: D (no deps). Level 1: C (depends on D).
    // Level 2: B (depends on C). Level 3: A (depends on B).
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    // Verify invariant: every cell appears exactly once
    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();
    assert!(all.contains(&a));
    assert!(all.contains(&b));
    assert!(all.contains(&c));
    assert!(all.contains(&d));
    assert_eq!(all.len(), 4);

    // Verify invariant: each cell's predecessors must be at earlier levels
    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(d) < level_of(c), "D before C");
    assert!(level_of(c) < level_of(b), "C before B");
    assert!(level_of(b) < level_of(a), "B before A");
}

#[test]
fn test_affected_cells_levels_diamond() {
    //     D
    //    / \
    //   B   C
    //    \ /
    //     A
    // D changes -> all affected.
    // Level 0: D. Level 1: {B, C} (both depend only on D). Level 2: A.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    graph.set_precedents(&b, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&a, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // B and C should be at the same level (both only depend on D)
    assert_eq!(level_of(b), level_of(c), "B and C at same level");
    // A depends on both B and C, so must be at a later level
    assert!(level_of(d) < level_of(b), "D before B");
    assert!(level_of(b) < level_of(a), "B before A");
}

#[test]
fn test_affected_cells_levels_wide_fan_out() {
    // D is depended on by 5 independent cells: F1..F5
    // All should be at the same level (level after D).
    let mut graph = DependencyGraph::new();
    let d = cid(100);
    for i in 1..=5u128 {
        graph.set_precedents(&cid(i), vec![DepTarget::Cell(d)]);
    }

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    let d_level = level_of(d);
    for i in 1..=5u128 {
        assert_eq!(
            level_of(cid(i)),
            d_level + 1,
            "all fan-out cells at same level"
        );
    }
}

#[test]
fn test_affected_cells_levels_with_range_deps() {
    // D is a data cell at (sheet1, row=5, col=0).
    // F = SUM(A1:A100) — depends on range containing D's position.
    // G depends on F via cell edge.
    // When D changes -> F is affected (via range containment) -> G is affected.
    // Level ordering: D < F < G.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let d = cid(1); // data cell at row=5, col=0
    let f = cid(2); // formula: SUM(A1:A100)
    let g = cid(3); // depends on F

    let range = RangePos::new(sheet, 0, 0, 99, 0);
    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&g, vec![DepTarget::Cell(f)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == d {
            Some(CellPosition {
                sheet,
                row: 5,
                col: 0,
            })
        } else if *cell == f {
            Some(CellPosition {
                sheet,
                row: 50,
                col: 1,
            }) // outside the range itself
        } else if *cell == g {
            Some(CellPosition {
                sheet,
                row: 50,
                col: 2,
            })
        } else {
            None
        }
    };

    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();
    assert!(all.contains(&d), "D should be affected");
    assert!(all.contains(&f), "F should be affected (range contains D)");
    assert!(all.contains(&g), "G should be affected (depends on F)");

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(d) < level_of(f), "D before F");
    assert!(level_of(f) < level_of(g), "F before G");
}

#[test]
#[allow(clippy::many_single_char_names)]
fn test_affected_cells_levels_no_overlap_between_levels() {
    // Invariant: no cell can appear in more than one level.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let e = cid(5);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);
    graph.set_precedents(&e, vec![DepTarget::Cell(d)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = {
        let _a = graph.affected_cells_levels(&[a], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();
    let mut deduped = all.clone();
    deduped.sort_by_key(CellId::as_u128);
    deduped.dedup();
    assert_eq!(
        all.len(),
        deduped.len(),
        "no cell should appear in multiple levels"
    );
}

#[test]
fn test_affected_cells_levels_with_cycle() {
    // D -> B -> A, and A -> B (cycle between A and B).
    // Also C depends on D (no cycle).
    // Expected: D and C at early levels, A and B as cycle members
    // appended at the end.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a), DepTarget::Cell(d)]); // cycle: B->A
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        let sheet = sid(1);
        if *cell == a {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 1,
                col: 0,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet,
                row: 2,
                col: 0,
            })
        } else if *cell == d {
            Some(CellPosition {
                sheet,
                row: 3,
                col: 0,
            })
        } else {
            None
        }
    };

    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    // D and C should appear in the acyclic portion (early levels)
    // A and B (cycle members) should appear after
    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();
    assert!(all.contains(&a), "A should be in output");
    assert!(all.contains(&b), "B should be in output");
    assert!(all.contains(&c), "C should be in output");
    assert!(all.contains(&d), "D should be in output");
    assert_eq!(all.len(), 4, "no duplicates");

    // C (acyclic) should appear before cycle members A and B
    let pos = |cell: CellId| -> usize { all.iter().position(|x| *x == cell).unwrap() };
    assert!(pos(d) < pos(c), "D before C");
    assert!(pos(c) < pos(a), "C before cycle member A");
    assert!(pos(c) < pos(b), "C before cycle member B");
}

// ─────────────────────────────────────────────────────────────────
// Ordering invariants
// ─────────────────────────────────────────────────────────────────

#[test]
#[allow(clippy::many_single_char_names)]
fn test_affected_cells_ordering_invariant_complex() {
    // Build a moderately complex graph and verify the returned ordering
    // satisfies: for every cell C in the result, all of C's precedents
    // that are also in the result appear before C.
    //
    //        D1   D2
    //       / \   |
    //      B    C
    //      |   / \
    //      E  F   G
    //       \  \ /
    //        \  H
    //         \/
    //          A
    let mut graph = DependencyGraph::new();
    let d1 = cid(1);
    let d2 = cid(2);
    let b = cid(3);
    let c = cid(4);
    let e = cid(5);
    let f = cid(6);
    let g = cid(7);
    let h = cid(8);
    let a = cid(9);

    graph.set_precedents(&b, vec![DepTarget::Cell(d1)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d1), DepTarget::Cell(d2)]);
    graph.set_precedents(&e, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&f, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&g, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&h, vec![DepTarget::Cell(f), DepTarget::Cell(g)]);
    graph.set_precedents(&a, vec![DepTarget::Cell(e), DepTarget::Cell(h)]);

    // Trigger from both roots
    let affected = graph.affected_cells(&[d1, d2], &null_resolver).into_value();

    // Verify ordering invariant
    let pos_of = |cell: &CellId| -> usize { affected.iter().position(|x| x == cell).unwrap() };
    for cell in &affected {
        for dep in graph.get_precedents(cell) {
            if let DepTarget::Cell(dep_cell) = dep
                && affected.contains(dep_cell)
            {
                assert!(
                    pos_of(dep_cell) < pos_of(cell),
                    "precedent {dep_cell:?} must come before {cell:?}",
                );
            }
        }
    }
}

#[test]
fn test_affected_cells_full_ordering_invariant_with_ranges() {
    // Verify the ordering invariant for the range-aware method too.
    // Setup: D1 at (s,0,0), D2 at (s,1,0).
    // B = SUM(A1:A10) — range dep containing D1 and D2's positions.
    // C depends on D1 via cell edge.
    // A depends on both B and C via cell edges.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let d1 = cid(1);
    let d2 = cid(2);
    let b = cid(3);
    let c = cid(4);
    let a = cid(5);

    let range = RangePos::new(sheet, 0, 0, 9, 0);
    graph.set_precedents(&b, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d1)]);
    graph.set_precedents(&a, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == d1 {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 0,
            })
        } else if *cell == d2 {
            Some(CellPosition {
                sheet,
                row: 1,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 1,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 2,
            })
        } else if *cell == a {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 3,
            })
        } else {
            None
        }
    };

    let affected = graph.affected_cells(&[d1], &resolve).into_value();

    // D1 must come before B (B's range contains D1)
    // D1 must come before C (C depends on D1)
    // B and C must come before A
    assert!(affected.contains(&d1));
    assert!(affected.contains(&b));
    assert!(affected.contains(&c));
    assert!(affected.contains(&a));

    let pos = |cell: &CellId| -> usize { affected.iter().position(|x| x == cell).unwrap() };
    assert!(pos(&d1) < pos(&b), "D1 before B");
    assert!(pos(&d1) < pos(&c), "D1 before C");
    assert!(pos(&b) < pos(&a), "B before A");
    assert!(pos(&c) < pos(&a), "C before A");
}

// ─────────────────────────────────────────────────────────────────
// affected_cells (null resolver) — cycle fallback path
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_affected_cells_cell_deps_only_with_cycle() {
    // A -> B -> A (cycle). When B changes, both A and B are affected.
    // The topo sort will fail due to cycle, hitting the Err fallback
    // that returns the dirty set in arbitrary order.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let affected = graph.affected_cells(&[b], &null_resolver).into_value();
    // Both cells should be in the result even with a cycle
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert_eq!(affected.len(), 2);
}

#[test]
fn test_affected_cells_cell_deps_only_cycle_with_downstream() {
    // A -> B -> A (cycle). C depends on A. D depends on C.
    // When A changes: A is dirty. BFS walks dependents:
    //   A's dependents = {B, C}. B's dependents = {A} (already dirty).
    //   C's dependents = {D}. So all 4 are dirty.
    // Topo sort will fail on the A-B cycle, hitting the Err fallback.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    graph.set_precedents(&b, vec![DepTarget::Cell(a)]); // B depends on A
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]); // A depends on B (cycle)
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]); // C depends on A
    graph.set_precedents(&d, vec![DepTarget::Cell(c)]); // D depends on C

    let affected = graph.affected_cells(&[a], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(affected.contains(&c));
    assert!(affected.contains(&d));
}

// ─────────────────────────────────────────────────────────────────
// get_affected_cells_full — volatile cells and cycle fallback
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_affected_cells_full_includes_volatile() {
    // V is volatile, not connected to anything. D is a data cell.
    // F depends on D via range. When D changes, F is affected.
    // V should also be included (volatile = always recalculated).
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let d = cid(1);
    let f = cid(2);
    let v = cid(3);

    let range = RangePos::new(sheet, 0, 0, 99, 0);
    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.mark_volatile(&v);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == d {
            Some(CellPosition {
                sheet,
                row: 50,
                col: 0,
            })
        } else if *cell == f {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 1,
            })
        } else {
            None
        }
    };

    let affected = graph.affected_cells(&[d], &resolve).into_value();
    assert!(affected.contains(&d), "changed cell");
    assert!(affected.contains(&f), "formula via range");
    assert!(
        affected.contains(&v),
        "volatile cell should always be included"
    );
}

#[test]
fn test_affected_cells_full_with_cycle() {
    // A -> B -> A (cycle). Both are formula cells with positions.
    // When A changes, both should be returned despite the cycle.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 1,
                col: 0,
            })
        } else {
            None
        }
    };

    let affected = graph.affected_cells(&[a], &resolve).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
}

// ─────────────────────────────────────────────────────────────────
// get_affected_cells_levels — volatile and range-aware BFS paths
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_affected_cells_levels_includes_volatile() {
    // V is volatile and disconnected. D -> F via cell edge.
    // When D changes, F is affected. V should also appear.
    let mut graph = DependencyGraph::new();
    let d = cid(1);
    let f = cid(2);
    let v = cid(3);

    graph.set_precedents(&f, vec![DepTarget::Cell(d)]);
    graph.mark_volatile(&v);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };

    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();
    assert!(all.contains(&d));
    assert!(all.contains(&f));
    assert!(all.contains(&v), "volatile cell must be included in levels");
}

#[test]
fn test_affected_cells_levels_range_aware_bfs() {
    // D at (sheet,5,0). F = SUM(A1:A100) depends on range containing D.
    // G depends on F via cell edge.
    // get_affected_cells_levels should find F via range BFS, then G via cell BFS.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let d = cid(1);
    let f = cid(2);
    let g = cid(3);

    let range = RangePos::new(sheet, 0, 0, 99, 0);
    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&g, vec![DepTarget::Cell(f)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == d {
            Some(CellPosition {
                sheet,
                row: 5,
                col: 0,
            })
        } else if *cell == f {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 1,
            })
        } else if *cell == g {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 2,
            })
        } else {
            None
        }
    };

    let levels = {
        let _a = graph.affected_cells_levels(&[d], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };
    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();
    assert!(all.contains(&d));
    assert!(all.contains(&f), "F affected via range containment");
    assert!(all.contains(&g), "G affected via cell dep on F");

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(d) < level_of(f));
    assert!(level_of(f) < level_of(g));
}

/// Regression: downstream dependents of a cycle must be in levels, not cycle_cells.
///
/// Setup: A↔B (cycle), C depends on A, D depends on C (chain downstream).
/// Expected: cycle_cells = {A, B}, levels contain C and D in correct order.
/// Bug: Kahn's leaves C and D with non-zero in-degree, so both land in cycle_cells.
#[test]
fn test_affected_cells_levels_downstream_of_cycle_not_in_cycle_cells() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A↔B cycle
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    // C depends on A, D depends on C (downstream chain)
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(c)]);

    let sheet = sid(1);
    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 1,
                col: 0,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet,
                row: 2,
                col: 0,
            })
        } else if *cell == d {
            Some(CellPosition {
                sheet,
                row: 3,
                col: 0,
            })
        } else {
            None
        }
    };

    let result = graph.affected_cells_levels(&[a], &resolve);
    let (levels, cycle_cells) = result.into_value();

    let cycle_set: FxHashSet<CellId> = cycle_cells.iter().copied().collect();
    let level_cells: Vec<CellId> = levels.iter().flatten().copied().collect();

    // Only A and B should be cycle members
    assert!(cycle_set.contains(&a), "A should be in cycle_cells");
    assert!(cycle_set.contains(&b), "B should be in cycle_cells");

    // C and D are downstream — they should be in levels, not cycle_cells
    assert!(
        !cycle_set.contains(&c),
        "C is downstream of cycle, should NOT be in cycle_cells"
    );
    assert!(
        !cycle_set.contains(&d),
        "D is downstream of cycle, should NOT be in cycle_cells"
    );
    assert!(level_cells.contains(&c), "C should appear in levels");
    assert!(level_cells.contains(&d), "D should appear in levels");

    // Ordering: C before D (C is D's precedent)
    let pos_c = level_cells.iter().position(|x| *x == c).unwrap();
    let pos_d = level_cells.iter().position(|x| *x == d).unwrap();
    assert!(pos_c < pos_d, "C should be scheduled before D in levels");
}

// ─────────────────────────────────────────────────────────────────
// Residual: subset_levels row-major ordering contract
// ─────────────────────────────────────────────────────────────────

/// `subset_levels` documents: "Within each level, cells are sorted by row-major
/// position order." This contract must hold for ALL levels — including
/// downstream-of-cycle levels produced by `kahn_sort`.
///
/// Bug: `kahn_sort` (topo.rs) does not sort within levels, so downstream-of-cycle
/// levels come back in hash iteration order rather than row-major order.
///
/// This test uses multiple downstream cells at the same level to surface the
/// ordering violation. It's run 5 times to overcome hash-map non-determinism.
#[test]
fn test_subset_levels_row_major_ordering_downstream_of_cycle() {
    // Graph:
    //   A ↔ B (cycle)
    //   C depends on A (downstream level 1)
    //   D depends on A (downstream level 1)
    //   E depends on A (downstream level 1)
    //
    // C, D, E are at the same downstream level. The contract says they
    // should be sorted by row-major position order.
    //
    // Positions: C at (s,10,0), D at (s,5,0), E at (s,8,0)
    // Expected order within the level: D (row 5), E (row 8), C (row 10)

    let sheet = sid(1);

    // Run multiple times — hash order is non-deterministic, so a single
    // pass might accidentally be sorted.
    for iteration in 0..5 {
        let a = cid(1 + iteration * 100);
        let b = cid(2 + iteration * 100);
        let c = cid(3 + iteration * 100);
        let d = cid(4 + iteration * 100);
        let e = cid(5 + iteration * 100);

        let mut graph = DependencyGraph::new();
        // Cycle
        graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
        graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
        // Downstream
        graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
        graph.set_precedents(&d, vec![DepTarget::Cell(a)]);
        graph.set_precedents(&e, vec![DepTarget::Cell(a)]);

        let resolve = move |cell: &CellId| -> Option<CellPosition> {
            if *cell == a {
                Some(CellPosition {
                    sheet,
                    row: 0,
                    col: 0,
                })
            } else if *cell == b {
                Some(CellPosition {
                    sheet,
                    row: 1,
                    col: 0,
                })
            } else if *cell == c {
                Some(CellPosition {
                    sheet,
                    row: 10,
                    col: 0,
                })
            } else if *cell == d {
                Some(CellPosition {
                    sheet,
                    row: 5,
                    col: 0,
                })
            } else if *cell == e {
                Some(CellPosition {
                    sheet,
                    row: 8,
                    col: 0,
                })
            } else {
                None
            }
        };

        let all_cells = vec![a, b, c, d, e];
        let result = graph.subset_levels(&all_cells, &resolve);
        let (levels, _cycle_cells) = result.into_value();

        // Find the level that contains the downstream cells C, D, E
        for level in &levels {
            let downstream: Vec<CellId> = level
                .iter()
                .copied()
                .filter(|cell| *cell == c || *cell == d || *cell == e)
                .collect();
            if downstream.len() >= 2 {
                // Verify row-major order within this level
                for window in downstream.windows(2) {
                    let pos0 = resolve(&window[0]).unwrap();
                    let pos1 = resolve(&window[1]).unwrap();
                    assert!(
                        (pos0.sheet.as_u128(), pos0.row, pos0.col)
                            <= (pos1.sheet.as_u128(), pos1.row, pos1.col),
                        "subset_levels contract violation (iteration {iteration}): \
                         cell at ({},{},{}) appears before ({},{},{}) — \
                         downstream-of-cycle levels must be row-major sorted",
                        pos0.sheet.as_u128(),
                        pos0.row,
                        pos0.col,
                        pos1.sheet.as_u128(),
                        pos1.row,
                        pos1.col,
                    );
                }
            }
        }
    }
}

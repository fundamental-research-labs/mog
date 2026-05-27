use super::*;

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

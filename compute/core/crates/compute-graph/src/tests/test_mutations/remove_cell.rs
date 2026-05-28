use super::*;

#[test]
fn test_remove_cell_cleans_up_both_directions() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A depends on B, B depends on C
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    // Remove B
    graph.remove_cell(&b);

    // B should no longer exist in the graph
    assert!(!graph.has_cell(&b));

    // A still has B in its precedents list (the DepTarget::Cell(b) entry remains
    // in the precedents map), but B's dependents set is gone.
    // Actually, remove_cell should also clean up cells that have B as dependent.
    // After removing B, C should not list B as dependent.
    assert!(
        !graph.has_dependent(&c, &b),
        "C should not list B as dependent after B is removed"
    );
}

#[test]
fn test_remove_cell_with_volatile() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    graph.mark_volatile(&a);
    assert!(graph.is_volatile(&a));
    assert!(graph.has_cell(&a));

    graph.remove_cell(&a);
    assert!(!graph.is_volatile(&a));
    assert!(!graph.has_cell(&a));
}

#[test]
fn test_remove_cell_from_range_deps() {
    let mut graph = DependencyGraph::new();
    let sum1 = cid(100);
    let sum2 = cid(101);
    let sheet = sid(1);

    let range = DepTarget::Range(RangePos::new(sheet, 0, 0, 99, 3), RangeAccess::Aggregate);

    // Both sum1 and sum2 depend on the same range
    graph.set_precedents(&sum1, vec![range.clone()]);
    graph.set_precedents(&sum2, vec![range]);

    assert_eq!(graph.range_deps.len(), 1);
    let expected_rect = RangePos::new(sheet, 0, 0, 99, 3);
    assert_eq!(graph.range_deps.get(&expected_rect).unwrap().len(), 2);

    // Remove sum1
    graph.remove_cell(&sum1);

    // Range should still exist with sum2
    assert_eq!(graph.range_deps.len(), 1);
    let dep_set = graph.range_deps.get(&expected_rect).unwrap();
    assert!(dep_set.contains(&sum2));
    assert_eq!(dep_set.len(), 1);
}

#[test]
fn test_remove_cell_cleans_up_range_deps_and_volatile() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f = cid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);

    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.mark_volatile(&f);

    assert_eq!(graph.range_dep_count(), 1);
    assert!(graph.is_volatile(&f));

    graph.remove_cell(&f);

    // Everything should be cleaned up
    assert!(!graph.has_cell(&f));
    assert!(!graph.is_volatile(&f));
    assert_eq!(
        graph.range_dep_count(),
        0,
        "range deps should be cleaned up"
    );
    assert_eq!(graph.formula_cell_count(), 0);
}

#[test]
fn test_remove_cell_rebuilds_range_index_for_remaining_ranges() {
    // Two formula cells depend on DIFFERENT ranges on the same sheet.
    // Removing one cell should remove its range but rebuild the tree
    // with the other range still intact (hitting remove_from_range_index's
    // else branch where rects is non-empty).
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f1 = cid(1);
    let f2 = cid(2);

    let r1 = RangePos::new(sheet, 0, 0, 50, 0);
    let r2 = RangePos::new(sheet, 100, 0, 200, 0);

    graph.set_precedents(&f1, vec![DepTarget::Range(r1, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(r2, RangeAccess::Aggregate)]);

    assert_eq!(graph.range_dep_count(), 2);
    assert!(graph.has_range_index_for_sheet(&sheet));

    // Remove f1 — r1 should be gone, r2 should remain, index rebuilt
    graph.remove_cell(&f1);

    assert_eq!(graph.range_dep_count(), 1);
    assert!(
        graph.has_range_index_for_sheet(&sheet),
        "index should be rebuilt, not removed"
    );
    // r2's range should still work for queries
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 150, 0)])
            .contains(&f2)
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 25, 0)])
            .is_empty()
    );
}

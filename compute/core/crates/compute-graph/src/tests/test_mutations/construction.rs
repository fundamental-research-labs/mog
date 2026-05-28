use super::*;

#[test]
fn test_with_capacity_is_functional_equivalent_of_new() {
    let mut g1 = DependencyGraph::new();
    let mut g2 = DependencyGraph::with_capacity(100);
    let mut g3 = DependencyGraph::with_capacity_full(100, 200);

    let a = cid(1);
    let b = cid(2);

    for g in [&mut g1, &mut g2, &mut g3] {
        g.set_precedents(&a, vec![DepTarget::Cell(b)]);
        g.mark_volatile(&a);
    }

    for g in [&g1, &g2, &g3] {
        assert_eq!(g.get_precedents(&a), &[DepTarget::Cell(b)]);
        assert!(g.has_dependent(&b, &a));
        assert!(g.is_volatile(&a));
        assert_eq!(g.formula_cell_count(), 1);
        assert_eq!(g.edge_count(), 1);
    }
}

#[test]
fn test_empty_graph() {
    let graph = DependencyGraph::new();
    assert_eq!(graph.formula_cell_count(), 0);
    assert_eq!(graph.edge_count(), 0);
    assert_eq!(graph.max_depth(), 0);
    assert_eq!(graph.volatile_count(), 0);
    let nr = null_resolver();
    assert!(graph.detect_cycles(&nr).into_value().is_empty());
    assert!(
        graph
            .evaluation_levels(&nr)
            .unwrap()
            .into_value()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .is_empty()
    );
    assert!(graph.affected_cells(&[], &nr).into_value().is_empty());
}

#[test]
fn test_single_cell_no_deps() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    // A has a formula but depends on nothing (e.g., =42)
    graph.set_precedents(&a, vec![]);
    assert_eq!(graph.formula_cell_count(), 1);
    assert_eq!(graph.edge_count(), 0);
    assert!(graph.has_cell(&a));
}

#[test]
fn test_default_trait() {
    let graph = DependencyGraph::default();
    assert_eq!(graph.formula_cell_count(), 0);
}

#[test]
fn test_has_cell_volatile_only() {
    // A cell marked volatile but with no edges should still register
    // as existing in the graph.
    let mut graph = DependencyGraph::new();
    let v = cid(42);
    graph.mark_volatile(&v);
    assert!(graph.has_cell(&v), "volatile-only cell should be found");
}

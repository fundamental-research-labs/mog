use super::*;

#[test]
fn test_volatile_mark_unmark() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    graph.mark_volatile(&a);
    assert!(graph.is_volatile(&a));
    assert_eq!(graph.volatile_count(), 1);

    graph.unmark_volatile(&a);
    assert!(!graph.is_volatile(&a));
    assert_eq!(graph.volatile_count(), 0);
}

#[test]
fn test_volatile_count() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    graph.mark_volatile(&a);
    graph.mark_volatile(&b);

    assert_eq!(graph.volatile_count(), 2);
}

#[test]
fn test_get_volatile_cells_empty() {
    let graph = DependencyGraph::new();
    assert!(graph.volatile_cells().next().is_none());
}

#[test]
fn test_get_volatile_cells_reflects_mark_unmark() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    graph.mark_volatile(&a);
    graph.mark_volatile(&b);
    graph.mark_volatile(&c);

    assert_eq!(graph.volatile_count(), 3);
    assert!(graph.is_volatile(&a));
    assert!(graph.is_volatile(&b));
    assert!(graph.is_volatile(&c));

    graph.unmark_volatile(&b);
    assert_eq!(graph.volatile_count(), 2);
    assert!(graph.is_volatile(&a));
    assert!(!graph.is_volatile(&b));
    assert!(graph.is_volatile(&c));
}

#[test]
fn test_get_volatile_cells_survives_clear() {
    // clear() should empty everything including volatile cells.
    let mut graph = DependencyGraph::new();
    graph.mark_volatile(&cid(1));
    graph.mark_volatile(&cid(2));
    assert_eq!(graph.volatile_count(), 2);

    graph.clear();
    assert!(graph.volatile_cells().next().is_none());
}

#[test]
fn test_clear_resets_everything() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.mark_volatile(&a);

    graph.clear();

    assert_eq!(graph.formula_cell_count(), 0);
    assert_eq!(graph.edge_count(), 0);
    assert_eq!(graph.volatile_count(), 0);
    assert!(!graph.has_cell(&a));
    assert!(!graph.has_cell(&b));
}

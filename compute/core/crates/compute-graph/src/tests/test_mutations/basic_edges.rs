use super::*;

#[test]
fn test_basic_dependency_a_depends_on_b() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // A depends on B (A's formula references B)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // A's precedents should include B
    assert_eq!(graph.get_precedents(&a), &[DepTarget::Cell(b)]);

    // B's dependents should include A
    assert!(graph.has_dependent(&b, &a));

    // Both cells should be in the graph
    assert!(graph.has_cell(&a));
    assert!(graph.has_cell(&b));
}

#[test]
fn test_fan_out() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A depends on B, C, D
    graph.set_precedents(
        &a,
        vec![DepTarget::Cell(b), DepTarget::Cell(c), DepTarget::Cell(d)],
    );

    // B changes -> only A affected (plus B itself)
    let affected = graph.affected_cells(&[b], &null_resolver()).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(!affected.contains(&c));
    assert!(!affected.contains(&d));
}

#[test]
fn test_fan_in() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A, B, C all depend on D
    graph.set_precedents(&a, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    // D changes -> A, B, C all affected
    let affected = graph.affected_cells(&[d], &null_resolver()).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(affected.contains(&c));
    assert!(affected.contains(&d));
}

#[test]
fn test_has_cell_for_pure_data_cell() {
    // B is a pure data cell — no formula, but A depends on it.
    // has_cell(B) should return true because B appears in dependents.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    assert!(graph.has_cell(&b), "B is in dependents map");
    assert!(graph.has_cell(&a), "A is in precedents map");
    assert!(!graph.has_cell(&cid(999)), "unknown cell");
}

use super::*;

#[test]
fn test_topological_sort_simple() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A depends on B, B depends on C
    // Eval order: C, B, A
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();

    assert!(pos_c < pos_b, "C must be evaluated before B");
    assert!(pos_b < pos_a, "B must be evaluated before A");
}

#[test]
fn test_topological_sort_with_cycle_returns_error() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // A -> B -> A (cycle)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&null_resolver);
    assert!(result.is_err(), "Cycles should produce an error");
}

#[test]
fn test_topological_sort_diamond() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // D depends on B and C; B depends on A; C depends on A
    // A -> B -> D
    // A -> C -> D
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    let pos_d = order.iter().position(|x| *x == d).unwrap();

    assert!(pos_a < pos_b, "A before B");
    assert!(pos_a < pos_c, "A before C");
    assert!(pos_b < pos_d, "B before D");
    assert!(pos_c < pos_d, "C before D");
}

#[test]
#[allow(clippy::many_single_char_names)]
fn test_complex_graph_evaluation_order() {
    let mut graph = DependencyGraph::new();
    //
    // Graph:
    //   E -> C -> A
    //   E -> D -> B
    //   F -> D
    //
    // A and B are leaf values (no deps)
    // C depends on A, D depends on B
    // E depends on C and D, F depends on D
    //
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let e = cid(5);
    let f = cid(6);

    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&e, vec![DepTarget::Cell(c), DepTarget::Cell(d)]);
    graph.set_precedents(&f, vec![DepTarget::Cell(d)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    let pos = |cell: CellId| order.iter().position(|x| *x == cell).unwrap();

    assert!(pos(a) < pos(c), "A before C");
    assert!(pos(b) < pos(d), "B before D");
    assert!(pos(c) < pos(e), "C before E");
    assert!(pos(d) < pos(e), "D before E");
    assert!(pos(d) < pos(f), "D before F");
}

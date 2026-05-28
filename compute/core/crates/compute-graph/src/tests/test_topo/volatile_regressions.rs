use super::*;

/// Regression test: a cell that is ONLY marked volatile (no `set_precedents` call)
/// must appear in `get_evaluation_order()`.
///
/// Bug: `get_evaluation_order` collects cells from `precedents` and `dependents`
/// but not from `volatile_cells`. A volatile-only cell is invisible.
#[test]
fn test_volatile_only_cell_in_evaluation_order() {
    let mut graph = DependencyGraph::new();
    let v = cid(1);

    // Only mark as volatile — no set_precedents call.
    graph.mark_volatile(&v);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert!(
        order.contains(&v),
        "Volatile-only cell should appear in full evaluation order, got: {order:?}",
    );
}

/// Same bug via the range-aware variant.
#[test]
fn test_volatile_only_cell_in_evaluation_order_with_positions() {
    let mut graph = DependencyGraph::new();
    let v = cid(1);

    graph.mark_volatile(&v);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let order: Vec<CellId> = graph
        .evaluation_levels(&resolve)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect();
    assert!(
        order.contains(&v),
        "Volatile-only cell should appear in range-aware evaluation order, got: {order:?}",
    );
}

/// Same bug via the levels variant.
#[test]
fn test_volatile_only_cell_in_evaluation_levels() {
    let mut graph = DependencyGraph::new();
    let v = cid(1);

    graph.mark_volatile(&v);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = graph.evaluation_levels(&resolve).unwrap().into_value();
    let all_cells: Vec<CellId> = levels.into_iter().flatten().collect();
    assert!(
        all_cells.contains(&v),
        "Volatile-only cell should appear in evaluation levels, got: {all_cells:?}",
    );
}

/// Volatile-only cell with dependents: the volatile cell AND its dependents
/// must all appear in evaluation order.
#[test]
fn test_volatile_only_cell_with_dependents_in_evaluation_order() {
    let mut graph = DependencyGraph::new();
    let v = cid(1); // volatile, no precedents
    let a = cid(2); // depends on v

    graph.mark_volatile(&v);
    graph.set_precedents(&a, vec![DepTarget::Cell(v)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert!(order.contains(&v), "Volatile cell should be in order");
    assert!(
        order.contains(&a),
        "Dependent of volatile should be in order"
    );

    let pos_v = order.iter().position(|x| *x == v).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    assert!(
        pos_v < pos_a,
        "Volatile cell should be evaluated before its dependent"
    );
}

use super::*;

#[test]
fn test_evaluation_order_with_positions_empty() {
    let graph = DependencyGraph::new();
    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[test]
fn test_evaluation_levels_with_positions_empty() {
    let graph = DependencyGraph::new();
    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

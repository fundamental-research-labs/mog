use super::*;

/// After `remove_cell(a)` where `b -> a`, the cached `dep_edge_stats().total_edges`
/// must match the ground-truth `edge_count()`.
///
/// Bug: `remove_cell` cleans up reverse edges from other cells' precedent lists
/// (line 399) without decrementing `total_edges`, so the cached counter drifts.
#[test]
fn test_dep_edge_stats_consistent_after_remove_cell() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // b depends on a
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    assert_eq!(graph.edge_count(), 1);
    assert_eq!(graph.dep_edge_stats().total_edges, 1);

    // Remove a — b's precedent list should be cleaned up
    graph.remove_cell(&a);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(
        actual_edges, 0,
        "edge_count() should be 0 after removing the target cell"
    );
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges})"
    );
}

/// Same drift test for `remove_cell` with fan-in: multiple cells depend on
/// the removed cell, each losing an edge from their precedent list.
#[test]
fn test_dep_edge_stats_consistent_after_remove_cell_fan_in() {
    let mut graph = DependencyGraph::new();
    let a = cid(1); // target to be removed
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // b, c, d all depend on a
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(a)]);
    assert_eq!(graph.edge_count(), 3);
    assert_eq!(graph.dep_edge_stats().total_edges, 3);

    graph.remove_cell(&a);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(actual_edges, 0);
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges}) after removing cell with 3 dependents"
    );
}

/// Cached metrics must stay consistent after `bulk_remove_cells`.
#[test]
fn test_dep_edge_stats_consistent_after_bulk_remove() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // b -> a, c -> a
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    assert_eq!(graph.dep_edge_stats().total_edges, 2);

    graph.bulk_remove_cells(&[a]);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges}) after bulk_remove_cells"
    );
}

/// Cached metrics must stay consistent after `cleanup_sheet_ranges`.
#[test]
fn test_dep_edge_stats_consistent_after_cleanup_sheet_ranges() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f = cid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);

    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    assert_eq!(graph.dep_edge_stats().total_edges, 1);

    graph.cleanup_sheet_ranges(&sheet);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges}) after cleanup_sheet_ranges"
    );
}

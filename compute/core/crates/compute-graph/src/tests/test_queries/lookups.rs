use super::*;

// ─────────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_b_changes_a_is_affected() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // B changes -> A should be affected
    let affected = graph.affected_cells(&[b], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
}

#[test]
fn test_chain_dependency_a_b_c() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A depends on B, B depends on C
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    // C changes -> both B and A affected
    let affected = graph.affected_cells(&[c], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(affected.contains(&c));

    // Verify order: C before B before A
    let pos_c = affected.iter().position(|x| *x == c).unwrap();
    let pos_b = affected.iter().position(|x| *x == b).unwrap();
    let pos_a = affected.iter().position(|x| *x == a).unwrap();
    assert!(pos_c < pos_b, "C should come before B");
    assert!(pos_b < pos_a, "B should come before A");
}

#[test]
fn test_cell_with_no_dependents() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // A depends on B, but nothing depends on A
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // A should have no dependents
    assert!(graph.dependent_count(&a) == 0);

    // B's dependents should include A
    assert!(graph.has_dependent(&b, &a));
}

#[test]
fn test_get_precedents_empty() {
    let graph = DependencyGraph::new();
    let a = cid(1);
    assert_eq!(graph.get_precedents(&a), &[]);
}

#[test]
fn test_get_dependents_none() {
    let graph = DependencyGraph::new();
    let a = cid(1);
    assert!(graph.dependent_count(&a) == 0);
}

// ─────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_formula_cell_count() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    assert_eq!(graph.formula_cell_count(), 2); // A and B have formulas
}

#[test]
fn test_edge_count() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    graph.set_precedents(&a, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    assert_eq!(graph.edge_count(), 3); // A->B, A->C, B->C
}

#[test]
fn test_edge_count_with_range_deps() {
    let mut graph = DependencyGraph::new();
    let sum = cid(100);
    let sheet = sid(1);

    // sum depends on a large range (>= 256 cells)
    graph.set_precedents(
        &sum,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 99, 3),
            RangeAccess::Aggregate,
        )],
    );

    // 1 range edge
    assert_eq!(graph.edge_count(), 1);
}

#[test]
fn test_max_depth() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // Chain: A -> B -> C -> D (depth = 3 for A)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    assert_eq!(graph.max_depth(), 3);
}

#[test]
fn test_max_depth_diamond() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // Diamond: D depends on B and C; B depends on A; C depends on A
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    // D -> B -> A = depth 2, D -> C -> A = depth 2
    assert_eq!(graph.max_depth(), 2);
}

#[test]
fn test_dep_edge_stats_empty_graph() {
    let graph = DependencyGraph::new();
    assert_eq!(
        graph.dep_edge_stats(),
        EdgeStats {
            total_edges: 0,
            max_deps_per_cell: 0
        }
    );
}

#[test]
fn test_dep_edge_stats_single_cell_dep() {
    let mut graph = DependencyGraph::new();
    // A depends on B — one edge total, max 1
    graph.set_precedents(&cid(1), vec![DepTarget::Cell(cid(2))]);
    assert_eq!(
        graph.dep_edge_stats(),
        EdgeStats {
            total_edges: 1,
            max_deps_per_cell: 1
        }
    );
}

#[test]
fn test_dep_edge_stats_counts_both_cell_and_range_targets() {
    // dep_edge_stats iterates precedent VALUES (Vec<DepTarget>) and counts
    // all entries regardless of type. This tests that range targets are
    // counted the same as cell targets in the stats.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);
    // A depends on B (cell) and a range — total 2 deps for A
    graph.set_precedents(
        &cid(1),
        vec![
            DepTarget::Cell(cid(2)),
            DepTarget::Range(range, RangeAccess::Aggregate),
        ],
    );
    assert_eq!(
        graph.dep_edge_stats(),
        EdgeStats {
            total_edges: 2,
            max_deps_per_cell: 2
        }
    );
}

#[test]
fn test_dep_edge_stats_max_tracks_widest_cell() {
    let mut graph = DependencyGraph::new();
    // A depends on B, C, D (3 deps)
    graph.set_precedents(
        &cid(1),
        vec![
            DepTarget::Cell(cid(10)),
            DepTarget::Cell(cid(11)),
            DepTarget::Cell(cid(12)),
        ],
    );
    // E depends on F (1 dep)
    graph.set_precedents(&cid(2), vec![DepTarget::Cell(cid(13))]);

    let stats = graph.dep_edge_stats();
    assert_eq!(stats.total_edges, 4); // 3 + 1
    assert_eq!(stats.max_deps_per_cell, 3); // A has the most
}

// ─────────────────────────────────────────────────────────────────
// Diagnostics (summary)
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_summary_contains_all_stats() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    graph.set_precedents(
        &cid(1),
        vec![DepTarget::Cell(cid(2)), DepTarget::Cell(cid(3))],
    );
    graph.set_precedents(&cid(2), vec![DepTarget::Cell(cid(3))]);
    graph.set_precedents(
        &cid(4),
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.mark_volatile(&cid(4));

    let s = graph.summary();
    assert!(s.contains("formulas: 3"), "got: {s}");
    assert!(s.contains("ranges: 1"), "got: {s}");
    assert!(s.contains("volatile: 1"), "got: {s}");
}

#[test]
fn test_summary_empty_graph() {
    let graph = DependencyGraph::new();
    let s = graph.summary();
    assert!(s.contains("formulas: 0"), "got: {s}");
    assert!(s.contains("edges: 0"), "got: {s}");
    assert!(s.contains("volatile: 0"), "got: {s}");
}

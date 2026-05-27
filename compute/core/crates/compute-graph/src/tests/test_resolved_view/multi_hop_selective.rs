use super::*;

// ─────────────────────────────────────────────────────────────────
// Multi-hop selective back-edge tests
//
// The existing selective tests only cover DIRECT back-edges (A3 → B1).
// These tests exercise INDIRECT chains (A3 → C1 → B1) which the
// one-hop filter in is_selective_back_edge fails to suppress.
// ─────────────────────────────────────────────────────────────────

/// Multi-hop selective back-edge: A3 → C1 → B1, B1 = INDEX(A:A, 3).
/// A3 is in A:A but reaches B1 only through C1 (two hops).
/// subset_levels should NOT report a false cycle.
#[test]
fn test_selective_multi_hop_no_false_cycle_subset_levels() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0); // A1:A3

    // B1 = INDEX(A:A, 3) — selective dep on A1:A3
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // C1 = B1 + 1 — direct dep on B1
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    // A3 = C1 * 2 — indirect back-edge to B1 via C1
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.subset_levels(&[a1, a2, a3, b1, c1], &resolver);
    let (_levels, cycle_cells) = &result.value;

    assert!(
        cycle_cells.is_empty(),
        "Multi-hop selective back-edge should not produce a false cycle, got: {cycle_cells:?}"
    );
}

/// Same multi-hop scenario but via evaluation_levels (full-graph topo sort).
#[test]
fn test_selective_multi_hop_no_false_cycle_evaluation_levels() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Multi-hop selective back-edge should not cause CycleDetected in evaluation_levels"
    );
}

/// Same multi-hop scenario but via detect_cycles (diagnostic cycle enumeration).
#[test]
fn test_selective_multi_hop_no_false_cycle_detect_cycles() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "Multi-hop selective back-edge should not be detected as a cycle, got: {cycles:?}"
    );
}

/// Same multi-hop scenario but via would_create_cycle (hypothetical edit check).
/// Graph already has A3 → C1 → B1. User types =INDEX(A:A,3) in B1.
#[test]
fn test_selective_multi_hop_no_false_cycle_would_create_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    // Existing graph: A3 → C1 → B1
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    // Hypothetical: user types =INDEX(A:A, 3) in B1
    let edit = HypotheticalDependencyEdit {
        cell: b1,
        new_precedents: vec![DepTarget::Range(range_a, RangeAccess::Selective)],
    };

    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "Multi-hop selective back-edge should not report false cycle in would_create_cycle"
    );
}

/// Three-hop chain: A3 → D1 → C1 → B1, B1 = INDEX(A:A, 3).
/// Verifies the fix is truly transitive, not just two-hop.
#[test]
fn test_selective_multi_hop_three_deep_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let c1 = cid(20);
    let d1 = cid(30);

    let range_a = RangePos::new(sheet, 0, 0, 2, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    graph.set_precedents(&d1, vec![DepTarget::Cell(c1)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(d1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
        (d1, sheet, 0, 3),
    ]);

    // All four APIs should agree: no false cycle
    let result = graph.subset_levels(&[a1, a3, b1, c1, d1], &resolver);
    assert!(
        result.value.1.is_empty(),
        "Three-hop selective back-edge: subset_levels false cycle, got: {:?}",
        result.value.1
    );

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Three-hop selective back-edge: evaluation_levels false cycle"
    );

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "Three-hop selective back-edge: detect_cycles false cycle, got: {cycles:?}"
    );
}

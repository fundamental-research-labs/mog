use super::*;

// ═════════════════════════════════════════════════════════════════════════════
// Range selectivity: detect_cycles and would_create_cycle tests
// ═════════════════════════════════════════════════════════════════════════════

/// detect_cycles: INDEX(A:A, 3) in B1, A3 = B1*2 → no false cycle.
#[test]
fn test_detect_cycles_selective_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "detect_cycles: Selective INDEX should not produce false cycle: {cycles:?}"
    );
}

/// detect_cycles: SUM(A:A) in B1, A3 = B1*2 → real cycle detected.
#[test]
fn test_detect_cycles_aggregate_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        !cycles.is_empty(),
        "detect_cycles: Aggregate SUM should detect the real cycle"
    );
}

/// would_create_cycle: editing B1 to INDEX(A:A, 3), with A3 = B1*2 already
/// in the graph → should NOT report a cycle.
#[test]
fn test_would_create_cycle_selective_no_false_positive() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    // A3 = B1*2 is already in the graph
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    // Hypothetical: user types =INDEX(A:A, 3) in B1
    let edit = HypotheticalDependencyEdit {
        cell: b1,
        new_precedents: vec![DepTarget::Range(range_a, RangeAccess::Selective)],
    };

    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "would_create_cycle: Selective INDEX should not report false cycle"
    );
}

/// would_create_cycle: editing B1 to SUM(A:A), with A3 = B1*2 already
/// in the graph → SHOULD report a cycle.
#[test]
fn test_would_create_cycle_aggregate_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    // A3 = B1*2 is already in the graph
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    // Hypothetical: user types =SUM(A:A) in B1
    let edit = HypotheticalDependencyEdit {
        cell: b1,
        new_precedents: vec![DepTarget::Range(range_a, RangeAccess::Aggregate)],
    };

    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        result.value,
        "would_create_cycle: Aggregate SUM should detect the real cycle"
    );
}

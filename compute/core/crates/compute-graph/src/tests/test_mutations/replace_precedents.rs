use super::*;

#[test]
fn test_update_precedents_replaces_old() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A initially depends on B
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    assert!(graph.has_dependent(&b, &a));

    // Now A depends on C instead
    graph.set_precedents(&a, vec![DepTarget::Cell(c)]);

    // B should no longer have A as dependent
    assert!(
        !graph.has_dependent(&b, &a),
        "B should not list A as dependent after A's precedents changed"
    );

    // C should have A as dependent
    assert!(graph.has_dependent(&c, &a));
}

#[test]
fn test_multiple_set_precedents_same_cell() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A depends on B and C
    graph.set_precedents(&a, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    assert_eq!(graph.edge_count(), 2);
    assert!(graph.has_dependent(&b, &a));
    assert!(graph.has_dependent(&c, &a));

    // Update: A now depends on C and D (B removed)
    graph.set_precedents(&a, vec![DepTarget::Cell(c), DepTarget::Cell(d)]);

    assert_eq!(graph.edge_count(), 2);
    assert!(!graph.has_dependent(&b, &a));
    assert!(graph.has_dependent(&c, &a));
    assert!(graph.has_dependent(&d, &a));
}

#[test]
fn test_set_precedents_replaces_range_deps() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f = cid(1);
    let r1 = RangePos::new(sheet, 0, 0, 50, 0);
    let r2 = RangePos::new(sheet, 100, 0, 200, 0);

    // Set initial range dep
    graph.set_precedents(&f, vec![DepTarget::Range(r1, RangeAccess::Aggregate)]);
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 25, 0)])
            .contains(&f)
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 150, 0)])
            .is_empty()
    );

    // Replace with different range
    graph.set_precedents(&f, vec![DepTarget::Range(r2, RangeAccess::Aggregate)]);
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 25, 0)])
            .is_empty(),
        "old range should be gone"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 150, 0)])
            .contains(&f),
        "new range should be active"
    );
}

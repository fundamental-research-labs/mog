use super::*;

#[test]
fn test_max_depth_with_cycle() {
    // A -> B -> A (cycle). Neither should contribute infinite depth.
    // max_depth should be finite (the acyclic portion has depth 0 or 1).
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let depth = graph.max_depth();
    // With cycle guard: A's depth calculation hits B, B hits A (cycle → 0),
    // so B's depth = 0, A's depth = 1. max = 1.
    assert!(
        depth <= 1,
        "cycle should not cause unbounded depth, got {depth}",
    );
}

#[test]
fn test_max_depth_chain_with_cycle_spur() {
    // Linear chain: D -> C -> B, plus B -> A -> B (cycle spur).
    // The acyclic portion D -> C -> B has depth 2.
    // The cycle spur should not affect that.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    graph.set_precedents(&d, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]); // cycle: A -> B -> A

    let depth = graph.max_depth();
    // D -> C -> B -> A(cycle). D's chain is 3 deep in acyclic terms
    // but B -> A -> B is a cycle so A's depth of B is 0 (cycle guard).
    // Result should be finite and reasonable.
    assert!(depth <= 4, "depth should be bounded, got {depth}");
    assert!(
        depth >= 2,
        "acyclic chain D->C->B should give at least depth 2, got {depth}",
    );
}

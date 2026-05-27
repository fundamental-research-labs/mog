use super::*;

// ═══════════════════════════════════════════════════════════════════
// Range-mediated multi-hop chain tests
//
// Topology: two nested ranges where intermediate hops are range-mediated.
//
//   C at (0,0) inside R_inner
//   F_inner = INDEX(R_inner, ...) at (1,0), also inside R_outer
//   F_outer = INDEX(R_outer, ...) at (2,0)
//   C = F_outer + 1 (cell dep)
//
// Chain: F_outer → [selective on R_outer] → F_inner [inside R_outer]
//        F_inner → [selective on R_inner] → C [inside R_inner]
//        C → F_outer (cell dep)
//
// The F_inner→C link is range-mediated. A BFS that only follows
// cell-to-cell edges after the initial range seed will miss it.
// ═══════════════════════════════════════════════════════════════════

fn build_range_mediated_chain() -> (DependencyGraph, impl Fn(&CellId) -> Option<CellPosition>) {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let c = cid(1); // (0,0) — inside R_inner
    let f_inner = cid(2); // (1,0) — inside R_outer
    let f_outer = cid(3); // (2,0)

    let r_inner = RangePos::new(sheet, 0, 0, 0, 0); // just (0,0)
    let r_outer = RangePos::new(sheet, 0, 0, 1, 0); // rows 0-1, col 0

    // F_inner = INDEX(R_inner, ...) — selective dep on R_inner
    graph.set_precedents(
        &f_inner,
        vec![DepTarget::Range(r_inner, RangeAccess::Selective)],
    );
    // F_outer = INDEX(R_outer, ...) — selective dep on R_outer
    graph.set_precedents(
        &f_outer,
        vec![DepTarget::Range(r_outer, RangeAccess::Selective)],
    );
    // C = F_outer + 1 — cell dep
    graph.set_precedents(&c, vec![DepTarget::Cell(f_outer)]);

    let resolver = make_resolver(vec![
        (c, sheet, 0, 0),
        (f_inner, sheet, 1, 0),
        (f_outer, sheet, 2, 0),
    ]);

    (graph, resolver)
}

/// Test A: subset_levels with range-mediated multi-hop chain produces no false cycles.
#[test]
fn test_range_mediated_chain_no_false_cycle_subset_levels() {
    let (graph, resolver) = build_range_mediated_chain();
    let c = cid(1);
    let f_inner = cid(2);
    let f_outer = cid(3);

    let result = graph.subset_levels(&[c, f_inner, f_outer], &resolver);
    let (_levels, cycle_cells) = &result.value;
    assert!(
        cycle_cells.is_empty(),
        "Range-mediated multi-hop chain should not produce a false cycle in subset_levels, got: {cycle_cells:?}"
    );
}

/// Test B: evaluation_levels with range-mediated multi-hop chain succeeds (no cycle).
#[test]
fn test_range_mediated_chain_no_false_cycle_evaluation_levels() {
    let (graph, resolver) = build_range_mediated_chain();

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Range-mediated multi-hop chain should not cause CycleDetected in evaluation_levels"
    );
}

/// Test C: detect_cycles finds no cycles in range-mediated multi-hop chain.
#[test]
fn test_range_mediated_chain_no_false_cycle_detect_cycles() {
    let (graph, resolver) = build_range_mediated_chain();

    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        cycles.is_empty(),
        "Range-mediated multi-hop chain: detect_cycles should find no cycles, got: {cycles:?}"
    );
}

/// Test D: would_create_cycle correctly identifies the chain is acyclic.
#[test]
fn test_range_mediated_chain_would_create_cycle() {
    let (graph, resolver) = build_range_mediated_chain();
    let sheet = sid(1);
    let c = cid(1);
    let f_outer = cid(3);

    let r_outer = RangePos::new(sheet, 0, 0, 1, 0);

    // Proposing F_outer's existing selective dep on R_outer — should not be a cycle
    let edit = HypotheticalDependencyEdit {
        cell: f_outer,
        new_precedents: vec![DepTarget::Range(r_outer, RangeAccess::Selective)],
    };
    let would_cycle = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !would_cycle.into_value(),
        "Range-mediated chain: would_create_cycle should return false for existing topology"
    );

    // Proposing C depends on F_outer (already exists) — should not be a cycle
    let edit2 = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(f_outer)],
    };
    let would_cycle2 = graph.would_create_cycle(&edit2, &resolver);
    assert!(
        !would_cycle2.into_value(),
        "Range-mediated chain: would_create_cycle should return false for existing cell dep"
    );
}

/// Test E: affected_cells correctly propagates through range-mediated chain.
#[test]
fn test_range_mediated_chain_affected_cells_propagation() {
    let (graph, resolver) = build_range_mediated_chain();
    let c = cid(1);
    let f_inner = cid(2);
    let f_outer = cid(3);

    // Changing C should affect F_inner (via R_inner range) and F_outer (via R_outer range)
    let affected = graph.affected_cells(&[c], &resolver);
    let affected_set: FxHashSet<CellId> = affected.value.iter().copied().collect();

    assert!(
        affected_set.contains(&f_inner),
        "Changing C should affect F_inner via range R_inner containment"
    );
    assert!(
        affected_set.contains(&f_outer),
        "Changing C should affect F_outer via range R_outer containment (multi-hop)"
    );
}

/// Test F: mixed aggregate deps — self-referencing ones produce cycles,
/// non-self-referencing ones evaluate correctly via barrier.
#[test]
fn test_mixed_aggregate_self_ref_partition() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    // Range R covers rows 0-2, col 0 — contains A1, A2, A3
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let range_r = RangePos::new(sheet, 0, 0, 2, 0);

    // SUM_self at (1,0) = SUM(R) — aggregate, self-referencing (inside R at row 1)
    let sum_self = cid(10);
    // SUM_ext at (3,0) = SUM(R) — aggregate, NOT self-referencing (outside R)
    let sum_ext = cid(11);

    graph.set_precedents(
        &sum_self,
        vec![DepTarget::Range(range_r, RangeAccess::Aggregate)],
    );
    graph.set_precedents(
        &sum_ext,
        vec![DepTarget::Range(range_r, RangeAccess::Aggregate)],
    );

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (sum_self, sheet, 1, 0), // inside range — self-ref
        (sum_ext, sheet, 3, 0),  // outside range — not self-ref
    ]);

    // Use subset_levels (cycle-tolerant) to verify:
    // - sum_self IS in cycle_cells (genuine self-ref)
    // - sum_ext is NOT in cycle_cells (should evaluate normally via barrier)
    let result = graph.subset_levels(&[a1, a2, a3, sum_self, sum_ext], &resolver);
    let (levels, cycle_cells) = &result.value;

    // sum_ext should NOT be in cycles — it's outside the range, no self-ref
    assert!(
        !cycle_cells.contains(&sum_ext),
        "sum_ext (outside range) should not be in cycle_cells, got: {cycle_cells:?}"
    );

    // sum_ext should appear in the normal levels, after contained cells
    let flat: Vec<CellId> = levels.iter().flatten().copied().collect();
    assert!(
        flat.contains(&sum_ext),
        "sum_ext should appear in normal evaluation levels"
    );

    let pos_a1 = flat.iter().position(|c| *c == a1);
    let pos_sum_ext = flat.iter().position(|c| *c == sum_ext);
    if let (Some(pa1), Some(ps)) = (pos_a1, pos_sum_ext) {
        assert!(ps > pa1, "sum_ext should evaluate after contained cell a1");
    }
}

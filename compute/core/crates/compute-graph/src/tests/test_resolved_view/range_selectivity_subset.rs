use super::*;

// ═════════════════════════════════════════════════════════════════════════════
// Range selectivity: access-mode-aware barrier graph tests
// ═════════════════════════════════════════════════════════════════════════════

/// INDEX(A:A, 3) in B1, A3 = B1*2 → no false cycle (selective, A3 excluded).
#[test]
fn test_selective_index_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    // B1 = INDEX(A:A, 3) — selective dep on A:A
    let b1 = cid(10);
    // A1, A2, A3, A4 are data cells; A3 = B1*2
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let a4 = cid(4);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0); // A1:A4

    // B1 depends selectively on A:A
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // A3 depends on B1 (cell-to-cell)
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (a4, sheet, 3, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.subset_levels(&[a1, a2, a3, a4, b1], &resolver);
    let (levels, cycle_cells) = &result.value;

    // No cycle should be detected — the back-edge from A3 to B1 is excluded
    // because B1's dep on A:A is selective.
    assert!(
        cycle_cells.is_empty(),
        "Selective INDEX should not produce a false cycle, got cycle: {cycle_cells:?}"
    );

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // B1 should be computed before A3 (A3 depends on B1)
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
}

/// SUM(A:A) in B1, A3 = B1*2 → real cycle detected (aggregate, A3 in barrier).
#[test]
fn test_aggregate_sum_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0); // A1:A4

    // B1 = SUM(A:A) — aggregate dep on A:A
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    // A3 = B1*2 — depends on B1
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.subset_levels(&[a1, a3, b1], &resolver);
    let (_levels, cycle_cells) = &result.value;

    // Real cycle: SUM reads all cells including A3, but A3 depends on B1.
    // The aggregate path includes A3 in the barrier → cycle detected.
    assert!(
        !cycle_cells.is_empty(),
        "Aggregate SUM should detect the real cycle through A3"
    );
}

/// INDEX(A:A, 5) in B1, A5 = SUM(C1:C10) — selective dep, no false cycle.
///
/// With hybrid deferral, selective deps get no range barriers. B1 may evaluate
/// before A5 at the graph level. The recalc driver's fixup pass corrects this.
/// At graph level, we only verify: no false cycle, cell-to-cell ordering preserved.
#[test]
fn test_selective_preserves_ordering_for_non_backedge_cells() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a5 = cid(5);
    let c1 = cid(20);

    let range_a = RangePos::new(sheet, 0, 0, 4, 0); // A1:A5

    // B1 = INDEX(A:A, 5) — selective dep on A:A
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // A5 = SUM(C1:C10) — depends on C1, no back-edge to B1
    graph.set_precedents(&a5, vec![DepTarget::Cell(c1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a5, sheet, 4, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.subset_levels(&[a1, a5, b1, c1], &resolver);
    let (levels, cycle_cells) = &result.value;

    assert!(cycle_cells.is_empty(), "No cycle expected");

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // Cell-to-cell ordering is still guaranteed: C1 before A5
    assert!(level_of(c1) < level_of(a5), "C1 before A5");

    // All cells should be present in evaluation order
    let all: Vec<CellId> = levels.iter().flatten().copied().collect();
    assert!(all.contains(&b1), "B1 in evaluation order");
    assert!(all.contains(&a5), "A5 in evaluation order");
}

/// Same range, different formulas: B1 = INDEX(A:A, 3) selective, C1 = SUM(A:A) aggregate.
/// Each gets its own barrier with appropriate filtering.
#[test]
fn test_mixed_access_same_range_different_formulas() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let c1 = cid(20);
    let a1 = cid(1);
    let a3 = cid(3);
    let a5 = cid(5);

    let range_a = RangePos::new(sheet, 0, 0, 4, 0); // A1:A5

    // B1 = INDEX(A:A, 3) — selective
    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    // C1 = SUM(A:A) — aggregate
    graph.set_precedents(&c1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    // A3 = B1*2 — back-edge to B1
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (a5, sheet, 4, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    let result = graph.subset_levels(&[a1, a3, a5, b1, c1], &resolver);
    let (levels, cycle_cells) = &result.value;

    // No cycle: the aggregate barrier includes A3, but A3's back-edge is to
    // B1 (selective), not to C1 (aggregate). The topo sort handles this:
    // A1, A5 → B1 (selective barrier) → A3 (depends on B1) → C1 (aggregate
    // barrier waits for A3).
    //
    // Note: cycle detection here depends on whether A3→B1→barrier_agg→C1
    // creates a cycle. A3 is in the aggregate barrier (→ C1). C1 doesn't
    // depend on A3 directly. B1 depends selectively on A:A. So:
    // Order: data cells → B1 → A3 → C1. No cycle.
    assert!(
        cycle_cells.is_empty(),
        "Mixed access should not produce false cycle: {cycle_cells:?}"
    );

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // B1 before A3 (A3 depends on B1)
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
    // A3 before C1 (A3 is in aggregate barrier → C1)
    assert!(level_of(a3) < level_of(c1), "A3 before C1");
}

/// INDEX(A:A, 3) + SUM(A:A) in same formula → aggregate wins.
#[test]
fn test_mixed_access_same_formula_aggregate_wins() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0); // A1:A4

    // B1 = INDEX(A:A, 3) + SUM(A:A) — both selective and aggregate.
    // Both survive dedup (different RangeAccess → different Hash).
    // B1 has ANY aggregate dep on this range → goes to aggregate path.
    graph.set_precedents(
        &b1,
        vec![
            DepTarget::Range(range_a, RangeAccess::Selective),
            DepTarget::Range(range_a, RangeAccess::Aggregate),
        ],
    );
    // A3 = B1*2
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.subset_levels(&[a1, a3, b1], &resolver);
    let (_levels, cycle_cells) = &result.value;

    // Aggregate wins: B1 is in the aggregate path for this range.
    // A3 is in the full (unfiltered) barrier → real cycle detected.
    assert!(
        !cycle_cells.is_empty(),
        "Aggregate should win: INDEX+SUM on same range detects real cycle"
    );
}

/// Cross-sheet INDEX mutual refs → selective, back-edge cells excluded.
#[test]
fn test_cross_sheet_selective_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);

    // Core!C0 = INDEX(Debt!A:C, ...) — selective dep on Debt range
    let core_c0 = cid(10);
    // Debt!C0 = INDEX(Core!A:C, ...) — selective dep on Core range
    let debt_c0 = cid(20);
    // Some data cells
    let core_a0 = cid(11);
    let debt_a0 = cid(21);

    let core_range = RangePos::new(sheet1, 0, 0, 0, 2); // Core!A:C row 0
    let debt_range = RangePos::new(sheet2, 0, 0, 0, 2); // Debt!A:C row 0

    // Core!C0 depends selectively on Debt range
    graph.set_precedents(
        &core_c0,
        vec![DepTarget::Range(debt_range, RangeAccess::Selective)],
    );
    // Debt!C0 depends selectively on Core range
    graph.set_precedents(
        &debt_c0,
        vec![DepTarget::Range(core_range, RangeAccess::Selective)],
    );

    let resolver = make_resolver(vec![
        (core_a0, sheet1, 0, 0),
        (core_c0, sheet1, 0, 2),
        (debt_a0, sheet2, 0, 0),
        (debt_c0, sheet2, 0, 2),
    ]);

    let result = graph.subset_levels(&[core_a0, core_c0, debt_a0, debt_c0], &resolver);
    let (_levels, cycle_cells) = &result.value;

    assert!(
        cycle_cells.is_empty(),
        "Cross-sheet selective INDEX should not produce false cycle: {cycle_cells:?}"
    );
}

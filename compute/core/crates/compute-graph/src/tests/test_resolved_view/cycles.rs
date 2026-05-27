use super::*;

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: detect_cycles
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_detect_cycles_range_aware() {
    // Cycle through range dep: A depends on range containing B, B depends on A.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    // A depends on range [row 1, col 0] which contains B
    let range = RangePos::new(sheet, 1, 0, 1, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    // B depends on A (cell dep)
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(!cycles.is_empty(), "Should detect a range-mediated cycle");

    // The cycle should involve both A and B
    let all_cycle_cells: FxHashSet<CellId> = cycles.iter().flatten().copied().collect();
    assert!(all_cycle_cells.contains(&a), "A should be in cycle");
    assert!(all_cycle_cells.contains(&b), "B should be in cycle");
}

#[test]
fn test_detect_cycles_no_false_cycle() {
    // An unpositioned cell must NOT create a false cycle.
    // A depends on B (cell dep). C is unpositioned but depends on A.
    // No cycle exists.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    // C has no position
    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(cycles.is_empty(), "No cycle should be detected");
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: would_create_cycle
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_would_create_cycle_basic() {
    // Chain: A → B → C. Adding C → A would create a cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(result.value, "Adding C→A should create cycle A→B→C→A");
}

#[test]
fn test_would_create_cycle_range() {
    // Range-mediated cycle: A depends on B. Adding B → Range(containing A) creates cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    // B depends on range containing A's position (row 0, col 0)
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    let edit = HypotheticalDependencyEdit {
        cell: b,
        new_precedents: vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(result.value, "Range dep on A from B should create cycle");
}

#[test]
fn test_would_create_cycle_self_reference() {
    // Cell inside its own Aggregate range dep IS a cycle.
    // SUM(A:A) in A5 reads every cell including A5 → circular.
    let graph = DependencyGraph::new();
    let a = cid(1);
    let sheet = sid(1);

    let resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(result.value, "Aggregate self-referencing range IS a cycle");
}

#[test]
fn test_would_create_cycle_self_reference_selective() {
    // Cell inside its own Selective range dep is NOT a cycle.
    // INDEX(A:A, MATCH(...)) in A5 references whole column but only reads one cell.
    let graph = DependencyGraph::new();
    let a = cid(1);
    let sheet = sid(1);

    let resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Range(range, RangeAccess::Selective)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "Selective self-referencing range is NOT a cycle at edit-time"
    );
}

#[test]
fn test_would_create_cycle_new_cell() {
    // Cell not yet in graph, position provided via WithOverrides.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let new_cell = cid(99);
    let sheet = sid(1);

    // A depends on B
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    let base_resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0)]);
    let resolver = WithOverrides::new(base_resolver).with_override(
        new_cell,
        CellPosition {
            sheet,
            row: 5,
            col: 0,
        },
    );
    // new_cell depends on A — no cycle since nothing depends on new_cell
    let edit = HypotheticalDependencyEdit {
        cell: new_cell,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "New cell depending on A should not create cycle"
    );
}

#[test]
fn test_would_create_cycle_no_false_positive() {
    // Verify no false cycles: A → B, C → D (disjoint chains).
    // Adding A → D should NOT create a cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    let resolver = make_resolver(vec![
        (a, sheet, 0, 0),
        (b, sheet, 1, 0),
        (c, sheet, 2, 0),
        (d, sheet, 3, 0),
    ]);
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Cell(d)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(
        !result.value,
        "Disjoint chains should not produce false cycle"
    );
    assert_eq!(result.completeness, AnalysisCompleteness::Exact);
}

#[test]
fn test_would_create_cycle_incomplete_when_cell_has_no_position() {
    // A graph cell without a position causes the initial range expansion to
    // be incomplete — even if no cycle is found, the result must report
    // Incomplete because that cell was invisible to the position index.
    //
    // Setup: A (has position) and B (no position) are in the graph.
    // Propose: new cell C depends on A via a cell dep. No cycle exists.
    // But B has no position, so the position index build is incomplete.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2); // no position — dropped by position index
    let c = cid(3);
    let sheet = sid(1);

    // A depends on B (cell-to-cell edge, so B is in the graph)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // Only A and C have positions; B deliberately omitted.
    let base_resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let resolver = WithOverrides::new(base_resolver).with_override(
        c,
        CellPosition {
            sheet,
            row: 2,
            col: 0,
        },
    );
    // Propose: C depends on A (cell dep). No cycle — nothing depends on C.
    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    let result = graph.would_create_cycle(&edit, &resolver);
    assert!(!result.value, "No cycle exists");
    assert_eq!(
        result.completeness,
        AnalysisCompleteness::Incomplete,
        "Analysis must be Incomplete when a graph cell (B) has no position"
    );
}

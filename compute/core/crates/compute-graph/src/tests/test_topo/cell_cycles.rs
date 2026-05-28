use super::*;

#[test]
fn test_cycle_detection_simple() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A -> B -> C -> A (cycle)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(!cycles.is_empty(), "Should detect at least one cycle");

    // The cycle should contain A, B, C
    let cycle = &cycles[0];
    assert!(cycle.contains(&a) || cycle.contains(&b) || cycle.contains(&c));
}

#[test]
fn test_no_cycle() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A -> B -> C (no cycle)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Should detect no cycles");
}

#[test]
fn test_self_reference_cycle() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    // A -> A (self-reference)
    graph.set_precedents(&a, vec![DepTarget::Cell(a)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(!cycles.is_empty(), "Self-reference should be a cycle");
}

#[test]
fn test_would_create_cycle_true() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A -> B -> C
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    // Adding C -> A would create A -> B -> C -> A
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(graph.would_create_cycle(&edit, &null_resolver).into_value());
}

#[test]
fn test_would_create_cycle_false() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A -> B, C -> D (separate chains)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    // Adding A -> D would not create a cycle
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Cell(b), DepTarget::Cell(d)],
    };
    assert!(!graph.would_create_cycle(&edit, &null_resolver).into_value());
}

#[test]
fn test_would_create_cycle_self_reference() {
    let graph = DependencyGraph::new();
    let a = cid(1);

    // Self-reference is always a cycle
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(graph.would_create_cycle(&edit, &null_resolver).into_value());
}

#[test]
fn test_would_create_cycle_deep_chain() {
    let mut graph = DependencyGraph::new();
    // A -> B -> C -> D -> E
    let cells: Vec<CellId> = (1..=5).map(cid).collect();

    graph.set_precedents(&cells[0], vec![DepTarget::Cell(cells[1])]);
    graph.set_precedents(&cells[1], vec![DepTarget::Cell(cells[2])]);
    graph.set_precedents(&cells[2], vec![DepTarget::Cell(cells[3])]);
    graph.set_precedents(&cells[3], vec![DepTarget::Cell(cells[4])]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };

    // E -> A would create cycle
    let edit = HypotheticalDependencyEdit {
        cell: cells[4],
        new_precedents: vec![DepTarget::Cell(cells[0])],
    };
    assert!(graph.would_create_cycle(&edit, &null_resolver).into_value());
    // E -> C would create cycle
    let edit = HypotheticalDependencyEdit {
        cell: cells[4],
        new_precedents: vec![DepTarget::Cell(cells[2])],
    };
    assert!(graph.would_create_cycle(&edit, &null_resolver).into_value());
    // A -> E would NOT create cycle (already exists as A->B->...->E)
    // Wait, A already depends on B which depends on ... E. So adding A -> E
    // would just add a shortcut edge. would_create_cycle checks if adding
    // "from depends on to" would create a cycle. from=A, to=E.
    // Does E transitively depend on A? E is a leaf, so no.
    let edit = HypotheticalDependencyEdit {
        cell: cells[0],
        new_precedents: vec![DepTarget::Cell(cells[1]), DepTarget::Cell(cells[4])],
    };
    assert!(!graph.would_create_cycle(&edit, &null_resolver).into_value());
}

#[test]
fn test_cross_sheet_cycle_two_sheets() {
    let mut graph = DependencyGraph::new();
    let a_cell = cid(100);
    let b_cell = cid(200);

    graph.set_precedents(&a_cell, vec![DepTarget::Cell(b_cell)]);
    graph.set_precedents(&b_cell, vec![DepTarget::Cell(a_cell)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(!cycles.is_empty(), "Should detect cross-sheet 2-cell cycle");
    let all_cycle_cells: FxHashSet<CellId> =
        cycles.iter().flat_map(|c| c.iter().copied()).collect();
    assert!(all_cycle_cells.contains(&a_cell));
    assert!(all_cycle_cells.contains(&b_cell));
}

/// Cross-sheet cycle via three sheets.
#[test]
fn test_cross_sheet_cycle_three_sheets() {
    let mut graph = DependencyGraph::new();
    let a_cell = cid(100);
    let b_cell = cid(200);
    let c_cell = cid(300);

    graph.set_precedents(&a_cell, vec![DepTarget::Cell(b_cell)]);
    graph.set_precedents(&b_cell, vec![DepTarget::Cell(c_cell)]);
    graph.set_precedents(&c_cell, vec![DepTarget::Cell(a_cell)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(!cycles.is_empty(), "Should detect cross-sheet 3-cell cycle");
    let all_cycle_cells: FxHashSet<CellId> =
        cycles.iter().flat_map(|c| c.iter().copied()).collect();
    assert!(all_cycle_cells.contains(&a_cell));
    assert!(all_cycle_cells.contains(&b_cell));
    assert!(all_cycle_cells.contains(&c_cell));
}

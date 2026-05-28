use super::*;

#[test]
fn test_would_create_cycle_with_positions_self_reference() {
    let graph = DependencyGraph::new();
    let a = cid(1);
    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let edit = HypotheticalDependencyEdit {
        cell: a,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(graph.would_create_cycle(&edit, &resolve).into_value());
}

#[test]
fn test_would_create_cycle_with_positions_through_range_true() {
    // A depends on range containing B's position, B depends on C.
    // Check: would C -> A create a cycle?
    // Path: A -> range(contains B) -> B -> C. If C -> A added, C -> A -> B -> C = cycle.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    let range = RangePos::new(sheet, 0, 0, 999, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == b {
            Some(CellPosition {
                sheet: sheet,
                row: 500,
                col: 0,
            }) // inside the range
        } else if *cell == a {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 1,
            }) // outside the range
        } else {
            None
        }
    };

    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(
        graph.would_create_cycle(&edit, &resolve).into_value(),
        "C -> A should create cycle via range containing B"
    );
}

#[test]
fn test_would_create_cycle_with_positions_through_range_false() {
    // A depends on range, B is inside the range but B does NOT depend on C.
    // Check: would C -> A create a cycle? No — C is not reachable from A.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    let range = RangePos::new(sheet, 0, 0, 999, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    // B has no deps — it's just a data cell inside the range
    // C is completely disconnected

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == b {
            Some(CellPosition {
                sheet: sheet,
                row: 500,
                col: 0,
            })
        } else if *cell == a {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 1,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 2,
            })
        } else {
            None
        }
    };

    let edit = HypotheticalDependencyEdit {
        cell: c,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(
        !graph.would_create_cycle(&edit, &resolve).into_value(),
        "C -> A should NOT create cycle — C not reachable from A"
    );
}
/// Regression test: `would_create_cycle_with_positions` must detect cycles
/// even when the proposed `from` cell is not yet in the graph.
///
/// Setup:
///   - A = SUM(range) where the range contains position (5, 0)
///   - X is a plain data cell at position (5, 0) — NOT in the graph
///   - Proposed edge: X depends on A
///
/// Expected: Returns `true` — adding X -> A creates X -> A -> range(contains X) -> X.
///
/// Bug: `all_graph_cells()` doesn't include X (it's not in precedents, dependents,
/// or `range_deps`), so the position index built for the DFS never contains X's position.
/// The DFS from A's precedents checks the range but can't find X inside it.
#[test]
fn test_would_create_cycle_with_new_cell_in_range() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let a = cid(1); // A = SUM(range including position of X)
    let x = cid(2); // plain data cell at (5, 0), NOT in the graph

    let range = RangePos::new(sheet, 0, 0, 10, 0); // rows 0-10, col 0
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    // X is at (5, 0), inside the range. A is at (0, 1), outside the range.
    let resolve = |cell: &CellId| -> Option<CellPosition> {
        match cell.as_u128() {
            1 => Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 1,
            }), // A
            2 => Some(CellPosition {
                sheet: sheet,
                row: 5,
                col: 0,
            }), // X — inside the range
            _ => None,
        }
    };

    // X is not in the graph yet. We're asking: "would making X depend on A create a cycle?"
    // Yes: X -> A -> range -> X (because X's position is inside A's range dependency).
    let edit = HypotheticalDependencyEdit {
        cell: x,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(
        graph.would_create_cycle(&edit, &resolve).into_value(),
        "Adding X -> A should create a cycle: X -> A -> range(contains X) -> X",
    );
}

/// Control test: when the proposed cell is NOT inside any range, no false positive.
#[test]
fn test_would_create_cycle_with_new_cell_outside_range() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let a = cid(1);
    let y = cid(3); // at (20, 0), OUTSIDE the range

    let range = RangePos::new(sheet, 0, 0, 10, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        match cell.as_u128() {
            1 => Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 1,
            }),
            3 => Some(CellPosition {
                sheet: sheet,
                row: 20,
                col: 0,
            }), // Y — outside the range
            _ => None,
        }
    };

    // Y -> A is safe: Y is not inside A's range dependency.
    let edit = HypotheticalDependencyEdit {
        cell: y,
        new_precedents: vec![DepTarget::Cell(a)],
    };
    assert!(
        !graph.would_create_cycle(&edit, &resolve).into_value(),
        "Y -> A should NOT create a cycle (Y is outside the range)",
    );
}

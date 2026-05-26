use super::*;
use crate::positions::CellPosition;
use crate::topo::{kahn_sort, tarjan_scc};

fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

// ─────────────────────────────────────────────────────────────────
// Cycle detection (cell-only)
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// Cycle detection (range-aware)
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_cycle_through_range() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let a_cell = cid(100);
    let b_cell = cid(200);
    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 1, 999, 1),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&b_cell, vec![DepTarget::Cell(a_cell)]);
    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 0,
                col: 0,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 1,
            })
        } else {
            None
        }
    };
    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(!cycles.is_empty(), "Should detect range cycle");
    let all_cycle_cells: FxHashSet<CellId> =
        cycles.iter().flat_map(|c| c.iter().copied()).collect();
    assert!(all_cycle_cells.contains(&a_cell), "a_cell in cycle");
    assert!(all_cycle_cells.contains(&b_cell), "b_cell in cycle");
    let resolver2 = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 0,
                col: 0,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 1,
            })
        } else {
            None
        }
    };
    let edit = HypotheticalDependencyEdit {
        cell: a_cell,
        new_precedents: vec![DepTarget::Cell(b_cell)],
    };
    assert!(
        graph.would_create_cycle(&edit, &resolver2).into_value(),
        "a_cell -> b_cell should be a cycle"
    );
}

/// 4d extra: Cell-only cycle detection misses range cycles
#[test]
fn test_cycle_through_range_not_detected_without_positions() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let a_cell = cid(100);
    let b_cell = cid(200);
    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 1, 999, 1),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&b_cell, vec![DepTarget::Cell(a_cell)]);
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.detect_cycles(&null_resolver);
    assert!(
        result.value.is_empty(),
        "Cell-only should miss range cycles"
    );
    assert_eq!(
        result.completeness,
        AnalysisCompleteness::Incomplete,
        "Null resolver should report incomplete analysis"
    );
    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 0,
                col: 0,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 1,
            })
        } else {
            None
        }
    };
    let result = graph.detect_cycles(&resolver);
    assert!(
        !result.value.is_empty(),
        "Position-aware should find range cycle"
    );
    assert_eq!(
        result.completeness,
        AnalysisCompleteness::Exact,
        "Full resolver should report exact analysis"
    );
}

/// Cross-sheet cycle via range deps.
#[test]
fn test_cross_sheet_cycle_via_range() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let a_cell = cid(100);
    let b_cell = cid(200);

    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet2, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&b_cell, vec![DepTarget::Cell(a_cell)]);

    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 0,
                col: 0,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet2,
                row: 500,
                col: 0,
            })
        } else {
            None
        }
    };
    let cycles = graph.detect_cycles(&resolver).into_value();
    assert!(
        !cycles.is_empty(),
        "Should detect cross-sheet range-mediated cycle"
    );
}

// ─────────────────────────────────────────────────────────────────
// Topological sort (cell-only)
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_topological_sort_simple() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A depends on B, B depends on C
    // Eval order: C, B, A
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();

    assert!(pos_c < pos_b, "C must be evaluated before B");
    assert!(pos_b < pos_a, "B must be evaluated before A");
}

#[test]
fn test_topological_sort_with_cycle_returns_error() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // A -> B -> A (cycle)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&null_resolver);
    assert!(result.is_err(), "Cycles should produce an error");
}

#[test]
fn test_topological_sort_diamond() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // D depends on B and C; B depends on A; C depends on A
    // A -> B -> D
    // A -> C -> D
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    let pos_d = order.iter().position(|x| *x == d).unwrap();

    assert!(pos_a < pos_b, "A before B");
    assert!(pos_a < pos_c, "A before C");
    assert!(pos_b < pos_d, "B before D");
    assert!(pos_c < pos_d, "C before D");
}

#[test]
#[allow(clippy::many_single_char_names)]
fn test_complex_graph_evaluation_order() {
    let mut graph = DependencyGraph::new();
    //
    // Graph:
    //   E -> C -> A
    //   E -> D -> B
    //   F -> D
    //
    // A and B are leaf values (no deps)
    // C depends on A, D depends on B
    // E depends on C and D, F depends on D
    //
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let e = cid(5);
    let f = cid(6);

    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&e, vec![DepTarget::Cell(c), DepTarget::Cell(d)]);
    graph.set_precedents(&f, vec![DepTarget::Cell(d)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    let pos = |cell: CellId| order.iter().position(|x| *x == cell).unwrap();

    assert!(pos(a) < pos(c), "A before C");
    assert!(pos(b) < pos(d), "B before D");
    assert!(pos(c) < pos(e), "C before E");
    assert!(pos(d) < pos(e), "D before E");
    assert!(pos(d) < pos(f), "D before F");
}

// ─────────────────────────────────────────────────────────────────
// Range-aware topo sort
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_topo_sort_with_range_deps_correct_order() {
    // A depends on range containing B's position.
    // B is also a formula cell (has precedents) so it appears in eval order.
    // B should be sorted before A.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3); // data cell B depends on

    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 10, 10);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]); // B is a formula cell

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == b {
            Some(CellPosition {
                sheet: sheet,
                row: 5,
                col: 3,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 0,
            })
        } else {
            None
        }
    };

    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_ok(), "Should not detect false cycle");
    let order = result.unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    assert!(
        pos_b < pos_a,
        "B should be evaluated before A (B at {pos_b}, A at {pos_a})"
    );
}

#[test]
fn test_topo_sort_with_mixed_cell_and_range_deps() {
    // A depends on B (Cell) and C (Range) → both before A
    // C is a formula cell so it appears in eval order.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4); // data cell C depends on

    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 5, 5);
    graph.set_precedents(
        &a,
        vec![
            DepTarget::Cell(b),
            DepTarget::Range(range, RangeAccess::Aggregate),
        ],
    );
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]); // C is a formula cell

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == c {
            Some(CellPosition {
                sheet: sheet,
                row: 3,
                col: 3,
            })
        } else {
            None
        }
    };

    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_ok());
    let order = result.unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    assert!(pos_b < pos_a, "B should be before A");
    assert!(pos_c < pos_a, "C should be before A");
}

#[test]
fn test_topo_sort_with_range_deps_no_false_cycle() {
    // A depends on B via Range dep only → no cycle error
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 10, 10);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == b {
            Some(CellPosition {
                sheet: sheet,
                row: 5,
                col: 5,
            })
        } else {
            None
        }
    };

    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(
        result.is_ok(),
        "Range-only deps should NOT produce false cycle"
    );
}

#[test]
fn test_topo_sort_cross_sheet_range_deps() {
    // A (sheet 1) depends on range on sheet 2 containing B.
    // B is a formula cell on sheet 2.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3); // data cell B depends on

    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let range = RangePos::new(sheet2, 0, 0, 100, 10);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]); // B is a formula cell

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a {
            Some(CellPosition {
                sheet: sheet1,
                row: 0,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet: sheet2,
                row: 50,
                col: 5,
            })
        } else {
            None
        }
    };

    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_ok());
    let order = result.unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    assert!(pos_b < pos_a, "B (sheet2) should be before A (sheet1)");
}

#[test]
fn test_topo_sort_range_only_chain() {
    // Chain: C (data) -> range -> B (formula) -> range -> A (formula)
    // B and A are formula cells. C is a data cell that appears via dependents
    // (B depends on C via cell edge to make C visible in graph).
    //
    // B is at (25, 3) which is inside range_ab (rows 10-30) but OUTSIDE range_bc
    // (rows 0-20). Since B depends on range_bc via Aggregate, placing B inside
    // range_bc would be an aggregate self-reference (SUM reads B).
    // We move B outside range_bc to avoid the self-reference cycle.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    let sheet = sid(1);
    let range_bc = RangePos::new(sheet, 0, 0, 20, 5);
    let range_ab = RangePos::new(sheet, 10, 0, 30, 5);
    graph.set_precedents(
        &b,
        vec![
            DepTarget::Range(range_bc, RangeAccess::Aggregate),
            DepTarget::Cell(c),
        ],
    );
    // A depends on range containing B's position
    graph.set_precedents(&a, vec![DepTarget::Range(range_ab, RangeAccess::Aggregate)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == c {
            Some(CellPosition {
                sheet,
                row: 5,
                col: 3,
            }) // inside range_bc
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 25,
                col: 3,
            }) // inside range_ab but OUTSIDE range_bc (row 25 > 20)
        } else if *cell == a {
            Some(CellPosition {
                sheet,
                row: 40,
                col: 0,
            }) // outside both ranges
        } else {
            None
        }
    };

    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_ok(), "Range-only chain should not produce cycle");
    let order = result.unwrap();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    assert!(pos_c < pos_b, "C before B");
    assert!(pos_b < pos_a, "B before A");
}

// ─────────────────────────────────────────────────────────────────
// Evaluation levels
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_evaluation_levels_simple_chain() {
    // C -> B -> A
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_ok());
    let levels = result.unwrap();

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(c) < level_of(b));
    assert!(level_of(b) < level_of(a));
}

#[test]
fn test_evaluation_levels_diamond_with_range() {
    // D is a data cell at (sheet1, 0, 0).
    // B = D+1 (cell dep on D)
    // C = SUM(A1:A100) (range dep containing D's position)
    // A depends on B and C
    //
    // Expected: D at level 0, B and C at same level, A at last level.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    let range = RangePos::new(sheet, 0, 0, 99, 0);
    graph.set_precedents(&b, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&c, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&a, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == d {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 0,
            })
        } else if *cell == b {
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
        } else if *cell == a {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 3,
            })
        } else {
            None
        }
    };

    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_ok());
    let levels = result.unwrap();

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };

    // D is a root — should be at earliest level
    assert!(level_of(d) < level_of(b));
    assert!(level_of(d) < level_of(c));
    // A depends on both B and C — should be at last level
    assert!(level_of(b) < level_of(a));
    assert!(level_of(c) < level_of(a));
}

#[test]
fn test_evaluation_levels_cycle_returns_err() {
    // A -> B -> A (cycle)
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_err(), "cycle should return Err");
    match result.unwrap_err() {
        GraphError::CycleDetected {
            cycle_cores: cycle_members,
            ..
        } => {
            assert!(cycle_members.contains(&a));
            assert!(cycle_members.contains(&b));
        }
    }
}

/// Regression: CycleDetected.cells should NOT include downstream dependents.
///
/// Setup: A↔B (cycle), C depends on A (downstream).
/// Expected: CycleDetected.cells = {A, B} only.
/// Bug: Kahn's leaves C with non-zero in-degree, so it's included in the error.
#[test]
fn test_evaluation_levels_cycle_error_excludes_downstream() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A↔B cycle
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    // C depends on A (downstream, not part of cycle)
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_err(), "cycle should return Err");
    match result.unwrap_err() {
        GraphError::CycleDetected {
            cycle_cores,
            downstream,
        } => {
            assert!(cycle_cores.contains(&a), "A is a cycle core");
            assert!(cycle_cores.contains(&b), "B is a cycle core");
            assert!(
                !cycle_cores.contains(&c),
                "C is downstream of the cycle, not a participant — should NOT be in cycle_cores"
            );
            assert!(downstream.contains(&c), "C should be in downstream");
        }
    }
}

#[test]
fn test_evaluation_levels_independent_subgraphs() {
    // Two independent chains: X->Y and P->Q
    // X and P should be at the same level (both roots).
    // Y and Q should be at the same level (both depend on a root).
    let mut graph = DependencyGraph::new();
    let x = cid(1);
    let y = cid(2);
    let p = cid(3);
    let q = cid(4);
    graph.set_precedents(&y, vec![DepTarget::Cell(x)]);
    graph.set_precedents(&q, vec![DepTarget::Cell(p)]);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_ok());
    let levels = result.unwrap();

    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert_eq!(level_of(x), level_of(p), "roots at same level");
    assert_eq!(level_of(y), level_of(q), "dependents at same level");
    assert!(level_of(x) < level_of(y));
}

// ─────────────────────────────────────────────────────────────────
// would_create_cycle_with_positions — range-aware cycle check
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// Cycle fallback in topo_sort_subset_with_positions
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_evaluation_order_with_positions_cycle() {
    // A -> B -> A (cycle) with position resolution.
    // Should return Err containing cycle members.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a {
            Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet: sheet,
                row: 1,
                col: 0,
            })
        } else {
            None
        }
    };

    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_err());
    match result.unwrap_err() {
        GraphError::CycleDetected {
            cycle_cores: cycle, ..
        } => {
            assert!(cycle.contains(&a));
            assert!(cycle.contains(&b));
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// max_depth with cycles — cycle-back edges treated as depth 0
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// Self-referencing range in level-grouped topo sort
// (cells both inside range AND depending on it)
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_evaluation_levels_self_referencing_range() {
    // A = SUM(A1:A100). A is at position (sheet, 50, 0) — inside its own range.
    // B depends on A via cell edge. C is a data cell at (sheet, 10, 0) inside the range.
    //
    // Aggregate self-reference is a true cycle: SUM reads A's own value.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    let range = RangePos::new(sheet, 0, 0, 99, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a {
            Some(CellPosition {
                sheet,
                row: 50,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 1,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet,
                row: 10,
                col: 0,
            })
        } else {
            None
        }
    };

    let result = graph.evaluation_levels(&resolve);
    assert!(
        result.is_err(),
        "Aggregate self-referencing range should be detected as a cycle"
    );
}

#[test]
fn test_evaluation_levels_self_referencing_range_with_other_contained_cells() {
    // A = SUM(A1:A100) at (sheet, 50, 0) — inside its own range.
    // C is a data cell at (sheet, 10, 0) — also inside the range.
    // D is a data cell at (sheet, 20, 0) — also inside the range.
    // B depends on A via cell edge.
    //
    // Aggregate self-reference is a true cycle — SUM reads A's own value.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    let range = RangePos::new(sheet, 0, 0, 99, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(cid(90))]);
    graph.set_precedents(&d, vec![DepTarget::Cell(cid(91))]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == a {
            Some(CellPosition {
                sheet,
                row: 50,
                col: 0,
            })
        } else if *cell == b {
            Some(CellPosition {
                sheet,
                row: 0,
                col: 1,
            })
        } else if *cell == c {
            Some(CellPosition {
                sheet,
                row: 10,
                col: 0,
            })
        } else if *cell == d {
            Some(CellPosition {
                sheet,
                row: 20,
                col: 0,
            })
        } else {
            None
        }
    };

    let result = graph.evaluation_levels(&resolve);
    assert!(
        result.is_err(),
        "Aggregate self-referencing range with other contained cells should be detected as a cycle"
    );
}

// ─────────────────────────────────────────────────────────────────
// Empty graph edge cases for position-aware topo sorts
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_evaluation_order_with_positions_empty() {
    let graph = DependencyGraph::new();
    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[test]
fn test_evaluation_levels_with_positions_empty() {
    let graph = DependencyGraph::new();
    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let result = graph.evaluation_levels(&resolve).map(|a| a.into_value());
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

// ─────────────────────────────────────────────────────────────────
// Scale tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_deep_chain_1000_no_stack_overflow() {
    let mut graph = DependencyGraph::new();
    let cells: Vec<CellId> = (1..=1000).map(cid).collect();

    // cell i+1 depends on cell i: cells[1] -> cells[0], cells[2] -> cells[1], ...
    for i in 1..1000 {
        graph.set_precedents(&cells[i], vec![DepTarget::Cell(cells[i - 1])]);
    }

    // No cycles in a linear chain
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Linear chain should have no cycles");

    // Evaluation order should contain all 1000 cells
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(order.len(), 1000);

    // Cells must be in correct topological order: cells[0] before cells[1] before ... cells[999]
    for i in 0..999 {
        let pos_i = order.iter().position(|x| *x == cells[i]).unwrap();
        let pos_next = order.iter().position(|x| *x == cells[i + 1]).unwrap();
        assert!(
            pos_i < pos_next,
            "cell {} should come before cell {} in eval order",
            i,
            i + 1
        );
    }

    // Max depth of a 1000-cell linear chain is 999
    assert_eq!(graph.max_depth(), 999);
}

#[test]
fn test_wide_fan_out_10000() {
    let mut graph = DependencyGraph::new();
    let root = cid(1);

    // 10,000 formula cells each depending on root
    let formula_cells: Vec<CellId> = (2..=10_001).map(cid).collect();
    for &fc in &formula_cells {
        graph.set_precedents(&fc, vec![DepTarget::Cell(root)]);
    }

    // All 10,001 cells (root + 10,000 formulas) should be affected
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let (levels, cycle_cells) = graph
        .affected_cells_levels(&[root], &null_resolver)
        .into_value();
    let affected: FxHashSet<CellId> = levels.into_iter().flatten().chain(cycle_cells).collect();
    assert_eq!(affected.len(), 10_001);
    assert!(affected.contains(&root));
    for &fc in &formula_cells {
        assert!(affected.contains(&fc));
    }

    // No cycles
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Fan-out graph should have no cycles");
}

#[test]
fn test_diamond_graph_10000() {
    // 100 layers x 100 cells per layer.
    // Each cell in layer L depends on every cell in layer L-1.
    let mut graph = DependencyGraph::new();
    let layers: usize = 100;
    let width: usize = 100;

    // cells[layer][col] — use unique IDs: layer * 1000 + col + 1
    let cell_ids: Vec<Vec<CellId>> = (0..layers)
        .map(|layer| {
            (0..width)
                .map(|col| cid((layer * 1000 + col + 1) as u128))
                .collect()
        })
        .collect();

    // Each cell in layer L (L >= 1) depends on all cells in layer L-1
    for layer in 1..layers {
        let deps: Vec<DepTarget> = cell_ids[layer - 1]
            .iter()
            .map(|&c| DepTarget::Cell(c))
            .collect();
        for cell in &cell_ids[layer] {
            graph.set_precedents(cell, deps.clone());
        }
    }

    // No cycles
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Diamond graph should have no cycles");

    // Evaluation order should succeed
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(order.len(), layers * width);

    // Every cell must appear after all its deps (cells in the previous layer)
    let pos_of = |cell: CellId| order.iter().position(|x| *x == cell).unwrap();
    for layer in 1..layers {
        for col in 0..width {
            let my_pos = pos_of(cell_ids[layer][col]);
            for (dep_col, &dep_cell) in cell_ids[layer - 1].iter().enumerate() {
                let dep_pos = pos_of(dep_cell);
                assert!(
                    dep_pos < my_pos,
                    "layer {} dep (col {}) at pos {} should be before layer {} cell (col {}) at pos {}",
                    layer - 1,
                    dep_col,
                    dep_pos,
                    layer,
                    col,
                    my_pos
                );
            }
        }
    }
}

#[test]
fn test_stress_wide_fan_out_100k() {
    // One cell with 100K dependents
    let mut graph = DependencyGraph::new();
    let root = cid(1);
    for i in 2..=100_001u128 {
        graph.set_precedents(&CellId::from_raw(i), vec![DepTarget::Cell(root)]);
    }

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let (levels, cycle_cells) = graph
        .affected_cells_levels(&[root], &null_resolver)
        .into_value();
    let affected: FxHashSet<CellId> = levels.into_iter().flatten().chain(cycle_cells).collect();
    assert_eq!(affected.len(), 100_001);

    // Topo sort should work
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(order.len(), 100_001);
    assert_eq!(order[0], root); // root should be first
}

// ─────────────────────────────────────────────────────────────────
// Bug regression: unpositioned cells must not create false cycles
// ─────────────────────────────────────────────────────────────────

/// Regression test for false cycle detection caused by unpositioned cells.
///
/// Setup:
///   - A depends on Range(rect containing B's position)
///   - C depends on Cell(A)
///   - B has a known position (inside the range), C has NO position
///
/// Expected: The graph is acyclic. `get_evaluation_order_with_positions`
/// should return Ok with a valid ordering (B before A before C).
///
/// Bug: `build_barrier_graph` conservatively adds unpositioned cells to
/// `contained` for every range. This creates a false edge C -> barrier -> A,
/// and combined with the real edge A -> C, manufactures a cycle: A -> C -> barrier -> A.
#[test]
fn test_unpositioned_cell_must_not_create_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let a = cid(1); // formula: depends on range containing B
    let b = cid(2); // formula cell inside the range
    let c = cid(3); // formula: depends on A, but has NO position
    let d = cid(4); // data cell B depends on

    let range = RangePos::new(sheet, 0, 0, 10, 10);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(d)]); // B is a formula at (5, 3)
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]); // C depends on A

    // B is inside the range, C has no position (resolver returns None)
    let resolve = |cell: &CellId| -> Option<CellPosition> {
        match cell.as_u128() {
            2 => Some(CellPosition {
                sheet: sheet,
                row: 5,
                col: 3,
            }), // B at row 5, col 3
            4 => Some(CellPosition {
                sheet: sheet,
                row: 0,
                col: 0,
            }), // D at row 0, col 0
            _ => None, // A and C have no position
        }
    };

    // The graph is acyclic: D -> B -> (range) -> A -> C
    // Must not report a false cycle.
    let result = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>());
    assert!(
        result.is_ok(),
        "Acyclic graph with unpositioned cells should NOT produce CycleDetected, got: {result:?}",
    );

    let order = result.unwrap();
    // B should appear before A (B is inside A's range dependency)
    assert!(
        order.contains(&a) && order.contains(&b) && order.contains(&c),
        "All formula cells should be in evaluation order",
    );
}

/// Same scenario but via partial recalc: unpositioned cells must not cause
/// `get_affected_cells_levels` to produce false cycles that corrupt level grouping.
#[test]
fn test_unpositioned_cell_must_not_corrupt_affected_levels() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let a = cid(1); // depends on range
    let b = cid(2); // inside range, has position
    let c = cid(3); // depends on A, no position

    let range = RangePos::new(sheet, 0, 0, 10, 10);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(cid(99))]); // B depends on data cell
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);

    let resolve = |cell: &CellId| -> Option<CellPosition> {
        match cell.as_u128() {
            2 => Some(CellPosition {
                sheet: sheet,
                row: 5,
                col: 3,
            }),
            _ => None,
        }
    };

    // Change B (inside range) -> should dirty A -> should dirty C
    let analyzed = graph.affected_cells_levels(&[b], &resolve);
    let (mut levels, cycle_cells) = analyzed.into_value();
    if !cycle_cells.is_empty() {
        levels.push(cycle_cells);
    }
    let levels = levels;

    // All three should appear in the levels
    let all_cells: Vec<CellId> = levels.iter().flatten().copied().collect();
    assert!(all_cells.contains(&b), "B should be in affected set");
    assert!(
        all_cells.contains(&a),
        "A should be in affected set (range dep on B)"
    );
    assert!(
        all_cells.contains(&c),
        "C should be in affected set (depends on A)"
    );

    // A must not appear in the same or earlier level as C
    let level_of = |cell: CellId| -> usize {
        levels
            .iter()
            .position(|level| level.contains(&cell))
            .unwrap_or(usize::MAX)
    };
    assert!(
        level_of(a) < level_of(c),
        "A (level {}) must be before C (level {}) — C depends on A",
        level_of(a),
        level_of(c),
    );
}

// ─────────────────────────────────────────────────────────────────
// Bug regression: would_create_cycle must detect range-based cycles
// for cells not yet in the graph
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// Bug regression: volatile-only cells must appear in full recalc order
// ─────────────────────────────────────────────────────────────────

/// Regression test: a cell that is ONLY marked volatile (no `set_precedents` call)
/// must appear in `get_evaluation_order()`.
///
/// Bug: `get_evaluation_order` collects cells from `precedents` and `dependents`
/// but not from `volatile_cells`. A volatile-only cell is invisible.
#[test]
fn test_volatile_only_cell_in_evaluation_order() {
    let mut graph = DependencyGraph::new();
    let v = cid(1);

    // Only mark as volatile — no set_precedents call.
    graph.mark_volatile(&v);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert!(
        order.contains(&v),
        "Volatile-only cell should appear in full evaluation order, got: {order:?}",
    );
}

/// Same bug via the range-aware variant.
#[test]
fn test_volatile_only_cell_in_evaluation_order_with_positions() {
    let mut graph = DependencyGraph::new();
    let v = cid(1);

    graph.mark_volatile(&v);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let order: Vec<CellId> = graph
        .evaluation_levels(&resolve)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect();
    assert!(
        order.contains(&v),
        "Volatile-only cell should appear in range-aware evaluation order, got: {order:?}",
    );
}

/// Same bug via the levels variant.
#[test]
fn test_volatile_only_cell_in_evaluation_levels() {
    let mut graph = DependencyGraph::new();
    let v = cid(1);

    graph.mark_volatile(&v);

    let resolve = |_: &CellId| -> Option<CellPosition> { None };
    let levels = graph.evaluation_levels(&resolve).unwrap().into_value();
    let all_cells: Vec<CellId> = levels.into_iter().flatten().collect();
    assert!(
        all_cells.contains(&v),
        "Volatile-only cell should appear in evaluation levels, got: {all_cells:?}",
    );
}

/// Volatile-only cell with dependents: the volatile cell AND its dependents
/// must all appear in evaluation order.
#[test]
fn test_volatile_only_cell_with_dependents_in_evaluation_order() {
    let mut graph = DependencyGraph::new();
    let v = cid(1); // volatile, no precedents
    let a = cid(2); // depends on v

    graph.mark_volatile(&v);
    graph.set_precedents(&a, vec![DepTarget::Cell(v)]);

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert!(order.contains(&v), "Volatile cell should be in order");
    assert!(
        order.contains(&a),
        "Dependent of volatile should be in order"
    );

    let pos_v = order.iter().position(|x| *x == v).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();
    assert!(
        pos_v < pos_a,
        "Volatile cell should be evaluated before its dependent"
    );
}

// ─────────────────────────────────────────────────────────────────
// Unit tests: tarjan_scc
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_tarjan_no_cycles() {
    // A -> B -> C (no cycles), all SCCs should be singletons
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    assert_eq!(sccs.len(), 3, "Three singleton SCCs expected");
    for scc in &sccs {
        assert_eq!(scc.len(), 1, "Each SCC should be a singleton");
    }
}

#[test]
fn test_tarjan_simple_2_cycle() {
    // A <-> B (cycle)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![1]);
    let nodes: FxHashSet<u32> = [1, 2].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    // Should have exactly one SCC of size 2
    let big_sccs: Vec<_> = sccs.iter().filter(|s| s.len() >= 2).collect();
    assert_eq!(big_sccs.len(), 1, "One SCC of size 2");
    let scc_set: FxHashSet<u32> = big_sccs[0].iter().copied().collect();
    assert!(scc_set.contains(&1));
    assert!(scc_set.contains(&2));
}

#[test]
fn test_tarjan_self_loop() {
    // A -> A (self-loop)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![1]);
    let nodes: FxHashSet<u32> = [1].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    assert_eq!(sccs.len(), 1);
    assert_eq!(sccs[0].len(), 1);
    assert_eq!(sccs[0][0], 1);
}

#[test]
fn test_tarjan_two_disjoint_cycles() {
    // A <-> B, C <-> D (two disjoint cycles)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![1]);
    adj.insert(3, vec![4]);
    adj.insert(4, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3, 4].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    let big_sccs: Vec<_> = sccs.iter().filter(|s| s.len() >= 2).collect();
    assert_eq!(big_sccs.len(), 2, "Two disjoint SCCs");
}

#[test]
fn test_tarjan_chain_with_cycle() {
    // A <-> B (cycle), A -> C (downstream singleton)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2, 3]);
    adj.insert(2, vec![1]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    let big_sccs: Vec<_> = sccs.iter().filter(|s| s.len() >= 2).collect();
    assert_eq!(big_sccs.len(), 1, "One cycle SCC");
    let singletons: Vec<_> = sccs.iter().filter(|s| s.len() == 1).collect();
    assert!(!singletons.is_empty(), "At least one singleton (node 3)");
}

// ─────────────────────────────────────────────────────────────────
// Unit tests: kahn_sort
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_kahn_sort_basic() {
    // Resolved: {1, 2}. Downstream: 3 depends on 1 and 2.
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![3]);
    adj.insert(2, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();
    let resolved: FxHashSet<u32> = [1, 2].into_iter().collect();

    let levels = kahn_sort(&adj, &nodes, &resolved);
    let all: Vec<u32> = levels.into_iter().flatten().collect();
    assert_eq!(all, vec![3]);
}

#[test]
fn test_kahn_sort_chain() {
    // Resolved: {1}. Downstream: 2 depends on 1, 3 depends on 2.
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();
    let resolved: FxHashSet<u32> = [1].into_iter().collect();

    let levels = kahn_sort(&adj, &nodes, &resolved);
    let all: Vec<u32> = levels.into_iter().flatten().collect();
    assert_eq!(all.len(), 2);
    let pos_2 = all.iter().position(|&x| x == 2).unwrap();
    let pos_3 = all.iter().position(|&x| x == 3).unwrap();
    assert!(pos_2 < pos_3, "2 should come before 3");
}

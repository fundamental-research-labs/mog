use super::*;

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

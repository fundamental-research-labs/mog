use super::*;

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

use super::*;

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

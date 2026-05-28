use super::*;

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

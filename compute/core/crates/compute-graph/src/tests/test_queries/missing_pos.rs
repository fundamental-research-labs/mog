use super::*;

// ─────────────────────────────────────────────────────────────────
// Bug reproduction: range dep chain broken by missing positions
// ─────────────────────────────────────────────────────────────────
// These tests expose the real bug in data_table_prepass: when
// `resolve_position` returns `None` for an intermediate cell in a
// dependency chain, the BFS in `get_affected_cells_levels` skips
// the range-index lookup for that cell, so downstream cells
// reachable only via range deps are never discovered.

/// Minimal reproduction: src → mid (cell edge) → sink (range dep).
/// When `resolve_position` returns `None` for `mid`, the BFS never
/// looks up `mid`'s position in the range index, so `sink` (which
/// depends on a range containing `mid`) is never found.
///
/// This test should FAIL until the bug is fixed.
#[test]
fn test_range_dep_chain_broken_by_missing_position() {
    let mut graph = DependencyGraph::new();

    let sheet = sid(1);
    let src = cid(10);
    let mid = cid(20);
    let sink = cid(30);

    // mid depends on src via cell-to-cell edge
    graph.set_precedents(&mid, vec![DepTarget::Cell(src)]);

    // sink depends on a range in `sheet` that contains mid's position
    let range = RangePos::new(sheet, 0, 0, 999, 0);
    graph.set_precedents(&sink, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    // resolve_position returns None for mid — simulating the data table
    // prepass where the mirror cannot resolve the cell's position.
    // mid is actually at (sheet, 5, 0) inside the range, but the
    // closure doesn't know that.
    //
    // src is on a DIFFERENT sheet so its position doesn't accidentally
    // fall inside the range that sink depends on.
    let src_sheet = sid(2);
    let resolve = |cell: &CellId| -> Option<CellPosition> {
        if *cell == src {
            Some(CellPosition {
                sheet: src_sheet,
                row: 0,
                col: 0,
            })
        } else {
            // mid and sink both return None — the bug scenario
            None
        }
    };

    let levels = {
        let _a = graph.affected_cells_levels(&[src], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };
    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();

    assert!(all.contains(&src), "changed cell src must be present");
    assert!(all.contains(&mid), "mid (cell dep on src) must be captured");
    assert!(
        all.contains(&sink),
        "sink must be captured — it depends on a range containing mid, \
         but the BFS skips the range lookup because resolve_position \
         returns None for mid"
    );
}

/// 6-cell chain mixing cell-to-cell and range deps:
///   `input` -> `s2_cell` (cell) -> `s3_cell` (range) -> `s4_cell` (cell)
///           -> `s5_cell` (range) -> `result` (cell)
///
/// `resolve_position` returns `None` for `s3_cell` (simulating a cell whose
/// sheet isn't in the mirror). This breaks the second range hop:
/// `s5_cell` depends on a range containing `s4_cell`, but `s4_cell` was
/// discovered via a cell edge from `s3_cell`. Since `s3_cell` has no
/// position, the range lookup that would find `s3_cell` inside the
/// range for `s3_cell`->`s4_cell`... actually this hop uses a cell edge.
/// The breakage is: `s4_cell` IS found (cell edge from `s3_cell`), but
/// `s4_cell`'s position is unknown too (returns `None`), so the range
/// lookup for `s5_cell` never fires.
///
/// This test should FAIL until the bug is fixed.
#[test]
fn test_deep_chain_broken_when_intermediate_position_missing() {
    let mut graph = DependencyGraph::new();

    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let sheet3 = sid(3);
    let sheet4 = sid(4);
    let sheet5 = sid(5);

    let input = cid(100);
    let s2_cell = cid(200); // on sheet2
    let s3_cell = cid(300); // on sheet3 — range dep on sheet2
    let s4_cell = cid(400); // on sheet4 — cell dep on s3_cell
    let s5_cell = cid(500); // on sheet5 — range dep on sheet4
    let result = cid(600); // cell dep on s5_cell

    // input → s2_cell: cell edge
    graph.set_precedents(&s2_cell, vec![DepTarget::Cell(input)]);

    // s3_cell depends on range in sheet2 containing s2_cell
    let range_s2 = RangePos::new(sheet2, 0, 0, 999, 0);
    graph.set_precedents(
        &s3_cell,
        vec![DepTarget::Range(range_s2, RangeAccess::Aggregate)],
    );

    // s4_cell depends on s3_cell: cell edge
    graph.set_precedents(&s4_cell, vec![DepTarget::Cell(s3_cell)]);

    // s5_cell depends on range in sheet4 containing s4_cell
    let range_s4 = RangePos::new(sheet4, 0, 0, 999, 0);
    graph.set_precedents(
        &s5_cell,
        vec![DepTarget::Range(range_s4, RangeAccess::Aggregate)],
    );

    // result depends on s5_cell: cell edge
    graph.set_precedents(&result, vec![DepTarget::Cell(s5_cell)]);

    // resolve_position: returns None for s4_cell — the mirror doesn't
    // know this cell's position. This means when the BFS reaches s4_cell,
    // it won't do a range-index lookup, so s5_cell is never discovered.
    let resolve = move |cell: &CellId| -> Option<CellPosition> {
        if *cell == input {
            Some(CellPosition {
                sheet: sheet1,
                row: 0,
                col: 0,
            })
        } else if *cell == s2_cell {
            Some(CellPosition {
                sheet: sheet2,
                row: 5,
                col: 0,
            })
        } else if *cell == s3_cell {
            Some(CellPosition {
                sheet: sheet3,
                row: 10,
                col: 0,
            })
        } else if *cell == s5_cell {
            Some(CellPosition {
                sheet: sheet5,
                row: 3,
                col: 0,
            })
        } else if *cell == result {
            Some(CellPosition {
                sheet: sheet5,
                row: 20,
                col: 0,
            })
        } else {
            // s4_cell returns None — the bug trigger
            None
        }
    };

    let levels = {
        let _a = graph.affected_cells_levels(&[input], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };
    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();

    assert!(all.contains(&input), "changed cell must be present");
    assert!(
        all.contains(&s2_cell),
        "s2_cell (cell dep) must be captured"
    );
    assert!(
        all.contains(&s3_cell),
        "s3_cell (range dep on sheet2) must be captured"
    );
    assert!(
        all.contains(&s4_cell),
        "s4_cell (cell dep on s3_cell) must be captured"
    );
    assert!(
        all.contains(&s5_cell),
        "s5_cell must be captured — it depends on a range containing \
         s4_cell, but s4_cell's position is None so the range lookup \
         is skipped"
    );
    assert!(
        all.contains(&result),
        "result must be captured — it depends on s5_cell which was \
         missed due to the broken range lookup chain"
    );
}

/// Simulate the exact two-variable data table pattern: a dependency
/// chain goes through 5 sheets via range deps. `resolve_position`
/// returns `None` for cells on the middle sheet (`sheet3`), breaking
/// propagation to all downstream sheets.
///
/// Chain (all range deps):
///   `input_cell` (`sheet1`) -> `sheet2_cell` -> `sheet3_cell` -> `sheet4_cell`
///   -> `sheet5_cell` -> `result_cell` (`sheet6`)
///
/// `resolve_position` returns `None` for `sheet3_cell`. When the BFS
/// reaches `sheet3_cell`, it cannot look up its position in the range
/// index, so `sheet4_cell` (which depends on a range containing
/// `sheet3_cell`) is never enqueued, and everything downstream is lost.
///
/// This test should FAIL until the bug is fixed.
#[test]
fn test_stale_propagation_with_partial_position_resolution() {
    let mut graph = DependencyGraph::new();

    let sheet1 = sid(10);
    let sheet2 = sid(20);
    let sheet3 = sid(30);
    let sheet4 = sid(40);
    let sheet5 = sid(50);
    let sheet6 = sid(60);

    let input_cell = cid(100);
    let sheet2_cell = cid(200);
    let sheet3_cell = cid(300);
    let sheet4_cell = cid(400);
    let sheet5_cell = cid(500);
    let result_cell = cid(600);

    // Each cell depends on a range in the previous sheet.
    let range1 = RangePos::new(sheet1, 0, 0, 999, 0);
    let range2 = RangePos::new(sheet2, 0, 0, 999, 0);
    let range3 = RangePos::new(sheet3, 0, 0, 999, 0);
    let range4 = RangePos::new(sheet4, 0, 0, 999, 0);
    let range5 = RangePos::new(sheet5, 0, 0, 999, 0);

    graph.set_precedents(
        &sheet2_cell,
        vec![DepTarget::Range(range1, RangeAccess::Aggregate)],
    );
    graph.set_precedents(
        &sheet3_cell,
        vec![DepTarget::Range(range2, RangeAccess::Aggregate)],
    );
    graph.set_precedents(
        &sheet4_cell,
        vec![DepTarget::Range(range3, RangeAccess::Aggregate)],
    );
    graph.set_precedents(
        &sheet5_cell,
        vec![DepTarget::Range(range4, RangeAccess::Aggregate)],
    );
    graph.set_precedents(
        &result_cell,
        vec![DepTarget::Range(range5, RangeAccess::Aggregate)],
    );

    // resolve_position returns None for sheet3_cell — simulating the
    // data table prepass where the mirror for sheet3 is stale or the
    // cell hasn't been placed yet.
    let resolve = move |cell: &CellId| -> Option<CellPosition> {
        if *cell == input_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 10,
                col: 0,
            })
        } else if *cell == sheet2_cell {
            Some(CellPosition {
                sheet: sheet2,
                row: 5,
                col: 0,
            })
        } else if *cell == sheet3_cell {
            // BUG: returns None — mirror doesn't know this cell's position
            None
        } else if *cell == sheet4_cell {
            Some(CellPosition {
                sheet: sheet4,
                row: 3,
                col: 0,
            })
        } else if *cell == sheet5_cell {
            Some(CellPosition {
                sheet: sheet5,
                row: 12,
                col: 0,
            })
        } else if *cell == result_cell {
            Some(CellPosition {
                sheet: sheet6,
                row: 20,
                col: 0,
            })
        } else {
            None
        }
    };

    let levels = {
        let _a = graph.affected_cells_levels(&[input_cell], &resolve);
        let (mut _levels, _cycle_cells) = _a.into_value();
        if !_cycle_cells.is_empty() {
            _levels.push(_cycle_cells);
        }
        _levels
    };
    let all: Vec<CellId> = levels.iter().flat_map(|l| l.iter().copied()).collect();

    assert!(all.contains(&input_cell), "changed cell must be present");
    assert!(
        all.contains(&sheet2_cell),
        "sheet2_cell (range dep on sheet1) must be captured"
    );
    assert!(
        all.contains(&sheet3_cell),
        "sheet3_cell (range dep on sheet2) must be captured"
    );
    // These assertions expose the bug: sheet3_cell's position is None,
    // so the BFS never checks if sheet3_cell falls inside range3.
    // sheet4_cell depends on range3, but the range lookup for
    // sheet3_cell is skipped entirely.
    assert!(
        all.contains(&sheet4_cell),
        "sheet4_cell must be captured — it depends on a range in sheet3 \
         containing sheet3_cell, but sheet3_cell's position is None so \
         the range lookup is skipped. This is the data table prepass bug."
    );
    assert!(
        all.contains(&sheet5_cell),
        "sheet5_cell must be captured — lost because sheet4_cell was \
         never enqueued due to the missing position for sheet3_cell"
    );
    assert!(
        all.contains(&result_cell),
        "result_cell must be captured — the final output is stale \
         because the entire downstream chain was lost"
    );
}

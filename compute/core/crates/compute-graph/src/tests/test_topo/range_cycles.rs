use super::*;

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

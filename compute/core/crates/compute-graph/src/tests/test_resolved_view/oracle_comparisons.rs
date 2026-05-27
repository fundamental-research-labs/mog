use super::*;

// ═════════════════════════════════════════════════════════════════════════════
// Oracle comparison tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_oracle_affected_cells_small_graph() {
    // Build a small graph with 10 cells, mix of cell and range deps.
    //
    // Layout on sheet 1:
    //   Row 0: C1(0,0)  C2(0,1)
    //   Row 1: C3(1,0)  C4(1,1)
    //   Row 2: C5(2,0)  C6(2,1)
    //   Row 3: C7(3,0)  C8(3,1)
    //   Row 4: C9(4,0)  C10(4,1)
    //
    // Dependencies:
    //   C3 depends on C1 (cell dep)
    //   C5 depends on C3 (cell dep)
    //   C7 depends on Range(rows 0-1, col 1) = [C2, C4] (range dep)
    //   C9 depends on C7 and C5 (cell deps)
    //   C10 depends on Range(rows 2-3, col 0) = [C5, C7] (range dep)

    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let cells: Vec<CellId> = (1..=10).map(cid).collect();
    let [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10] = [
        cells[0], cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], cells[8],
        cells[9],
    ];

    let pos_table = vec![
        (c1, sheet, 0, 0),
        (c2, sheet, 0, 1),
        (c3, sheet, 1, 0),
        (c4, sheet, 1, 1),
        (c5, sheet, 2, 0),
        (c6, sheet, 2, 1),
        (c7, sheet, 3, 0),
        (c8, sheet, 3, 1),
        (c9, sheet, 4, 0),
        (c10, sheet, 4, 1),
    ];

    // Cell deps
    graph.set_precedents(&c3, vec![DepTarget::Cell(c1)]);
    graph.set_precedents(&c5, vec![DepTarget::Cell(c3)]);

    // Range deps
    let range_c2_c4 = RangePos::new(sheet, 0, 1, 1, 1); // col 1, rows 0-1
    graph.set_precedents(
        &c7,
        vec![DepTarget::Range(range_c2_c4, RangeAccess::Aggregate)],
    );

    // Mixed cell deps
    graph.set_precedents(&c9, vec![DepTarget::Cell(c7), DepTarget::Cell(c5)]);

    let range_c5_c7 = RangePos::new(sheet, 2, 0, 3, 0); // col 0, rows 2-3
    graph.set_precedents(
        &c10,
        vec![DepTarget::Range(range_c5_c7, RangeAccess::Aggregate)],
    );

    let resolver = make_resolver(pos_table.clone());
    let resolver_fn = make_resolver(pos_table);

    // Test changing C1
    {
        let api_result = graph.affected_cells(&[c1], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c1]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C1 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing C2
    {
        let api_result = graph.affected_cells(&[c2], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c2]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C2 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing C4 (inside range_c2_c4)
    {
        let api_result = graph.affected_cells(&[c4], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c4]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C4 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing multiple cells: C1 and C2
    {
        let api_result = graph.affected_cells(&[c1, c2], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c1, c2]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C1+C2 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing an isolated cell (C6 — no dependents)
    {
        let api_result = graph.affected_cells(&[c6], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c6]);

        assert_eq!(
            api_set,
            oracle_set,
            "Affected cells mismatch for C6 change.\nAPI: {:?}\nOracle: {:?}",
            api_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
            oracle_set.iter().map(|c| c.as_u128()).collect::<Vec<_>>(),
        );
    }

    // Test changing C8 (isolated)
    {
        let api_result = graph.affected_cells(&[c8], &resolver);
        let api_set: FxHashSet<CellId> = api_result.value.iter().copied().collect();
        let oracle_set = oracle::naive_affected_cells(&graph, &resolver_fn, &[c8]);

        assert_eq!(api_set, oracle_set, "Affected cells mismatch for C8 change");
    }
}

#[test]
fn test_oracle_topo_sort_small_graph() {
    // Same graph as oracle affected cells test, verify topo ordering
    // against the naive oracle.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let cells: Vec<CellId> = (1..=6).map(cid).collect();
    let [c1, c2, c3, c4, c5, c6] = [cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]];

    let pos_table = vec![
        (c1, sheet, 0, 0),
        (c2, sheet, 1, 0),
        (c3, sheet, 2, 0),
        (c4, sheet, 3, 0),
        (c5, sheet, 0, 1),
        (c6, sheet, 1, 1),
    ];

    // C2 depends on C1
    // C3 depends on C2
    // C4 depends on C3 and C5
    // C6 depends on Range(row 0, col 0-1) = [C1, C5]
    graph.set_precedents(&c2, vec![DepTarget::Cell(c1)]);
    graph.set_precedents(&c3, vec![DepTarget::Cell(c2)]);
    graph.set_precedents(&c4, vec![DepTarget::Cell(c3), DepTarget::Cell(c5)]);
    let range = RangePos::new(sheet, 0, 0, 0, 1); // row 0, cols 0-1
    graph.set_precedents(&c6, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let resolver = make_resolver(pos_table.clone());
    let resolver_fn = make_resolver(pos_table);

    // Get API evaluation levels
    let api_result = graph.evaluation_levels(&resolver).expect("Acyclic graph");
    let api_levels = &api_result.value;

    // Flatten to get all cells in API order
    let api_flat: Vec<CellId> = api_levels.iter().flatten().copied().collect();

    // Oracle
    let all_cells: FxHashSet<CellId> = graph.all_graph_cells();
    let oracle_result = oracle::naive_topo_sort(&graph, &resolver_fn, &all_cells);
    let oracle_flat = oracle_result.expect("Acyclic graph");

    // Both should have the same set of cells
    let api_set: FxHashSet<CellId> = api_flat.iter().copied().collect();
    let oracle_set: FxHashSet<CellId> = oracle_flat.iter().copied().collect();
    assert_eq!(api_set, oracle_set, "Topo sort cell sets should match");

    // Verify topological ordering is respected: for each edge u→v, u must
    // come before v in the flattened order.
    let api_pos = |cell: CellId| -> usize { api_flat.iter().position(|c| *c == cell).unwrap() };

    // Check cell deps
    assert!(api_pos(c1) < api_pos(c2), "C1 before C2");
    assert!(api_pos(c2) < api_pos(c3), "C2 before C3");
    assert!(api_pos(c3) < api_pos(c4), "C3 before C4");
    assert!(api_pos(c5) < api_pos(c4), "C5 before C4");
    // C6 depends on range containing C1 and C5
    assert!(api_pos(c1) < api_pos(c6), "C1 before C6 (range dep)");
    assert!(api_pos(c5) < api_pos(c6), "C5 before C6 (range dep)");

    // Verify oracle respects the same invariants
    let oracle_pos =
        |cell: CellId| -> usize { oracle_flat.iter().position(|c| *c == cell).unwrap() };
    assert!(oracle_pos(c1) < oracle_pos(c2));
    assert!(oracle_pos(c2) < oracle_pos(c3));
    assert!(oracle_pos(c3) < oracle_pos(c4));
    assert!(oracle_pos(c5) < oracle_pos(c4));
}

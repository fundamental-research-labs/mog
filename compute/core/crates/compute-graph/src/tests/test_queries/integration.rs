use super::*;

// ─────────────────────────────────────────────────────────────────
// Integration: full recalc cycle simulation
// ─────────────────────────────────────────────────────────────────

#[test]
#[allow(clippy::cast_possible_truncation)]
fn test_integration_multi_sheet_data_table() {
    // Simulate a realistic workbook:
    //   Sheet 1: data cells (no formulas) at rows 0..10, col 0
    //   Sheet 2: formula cells that depend on Sheet 1 ranges
    //   Sheet 3: summary formulas that depend on Sheet 2 cells
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let sheet3 = sid(3);

    // Sheet 1 data cells (IDs 1..=10) — no formulas, just data
    let data_cells: Vec<CellId> = (1..=10).map(cid).collect();

    // Sheet 2 formula cells (IDs 101..=105) — each depends on a range in Sheet 1
    let s2_cells: Vec<CellId> = (101..=105).map(cid).collect();
    let range_s1 = RangePos::new(sheet1, 0, 0, 9, 0); // A1:A10 on Sheet 1
    for &fc in &s2_cells {
        graph.set_precedents(
            &fc,
            vec![DepTarget::Range(range_s1, RangeAccess::Aggregate)],
        );
    }

    // Sheet 3 summary formulas (IDs 201..=203) — each depends on Sheet 2 cells
    let s3_cells: Vec<CellId> = (201..=203).map(cid).collect();
    graph.set_precedents(
        &s3_cells[0],
        vec![DepTarget::Cell(s2_cells[0]), DepTarget::Cell(s2_cells[1])],
    );
    graph.set_precedents(
        &s3_cells[1],
        vec![DepTarget::Cell(s2_cells[2]), DepTarget::Cell(s2_cells[3])],
    );
    graph.set_precedents(&s3_cells[2], vec![DepTarget::Cell(s2_cells[4])]);

    // No cycles
    let cycles = graph.detect_cycles(&null_resolver);
    assert!(
        cycles.is_empty(),
        "Multi-sheet workbook should have no cycles"
    );

    // Build position map — data cells on sheet1, formula cells on sheet2/3
    let mut positions = FxHashMap::default();
    for (i, &dc) in data_cells.iter().enumerate() {
        positions.insert(dc, (sheet1, i as u32, 0u32));
    }
    for (i, &fc) in s2_cells.iter().enumerate() {
        positions.insert(fc, (sheet2, i as u32, 0u32));
    }
    for (i, &fc) in s3_cells.iter().enumerate() {
        positions.insert(fc, (sheet3, i as u32, 0u32));
    }

    // Change a Sheet 1 data cell → should propagate through Sheet 2 and Sheet 3
    let changed_cell = data_cells[3]; // row 3 on Sheet 1
    let affected = {
        let _resolver = |cell: &CellId| -> Option<CellPosition> {
            positions
                .get(cell)
                .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
        };
        graph
            .affected_cells(&[changed_cell], &_resolver)
            .into_value()
    };

    // All Sheet 2 formula cells should be affected (they depend on the Sheet 1 range)
    for &fc in &s2_cells {
        assert!(
            affected.contains(&fc),
            "Sheet 2 formula {fc:?} should be affected when Sheet 1 data changes",
        );
    }

    // All Sheet 3 summary cells should be affected (they depend on Sheet 2 cells)
    for &fc in &s3_cells {
        assert!(
            affected.contains(&fc),
            "Sheet 3 summary {fc:?} should be affected via transitive propagation",
        );
    }

    // Evaluation order should be valid
    let resolve = |cell: &CellId| -> Option<CellPosition> {
        positions
            .get(cell)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    };
    let order = graph
        .evaluation_levels(&resolve)
        .map(|a| a.into_value().into_iter().flatten().collect::<Vec<_>>())
        .unwrap();

    // Sheet 2 cells must come before Sheet 3 cells that depend on them
    let pos_of = |cell: CellId| order.iter().position(|x| *x == cell).unwrap();
    assert!(
        pos_of(s2_cells[0]) < pos_of(s3_cells[0]),
        "Sheet 2 cell must be evaluated before its Sheet 3 dependent"
    );
    assert!(
        pos_of(s2_cells[4]) < pos_of(s3_cells[2]),
        "Sheet 2 cell must be evaluated before its Sheet 3 dependent"
    );
}

#[test]
fn test_integration_incremental_update() {
    // Build a graph with 100 formula cells in two independent subgraphs.
    // Subgraph A: cells 1..=50 in a chain (cell i+1 depends on cell i)
    // Subgraph B: cells 51..=100 in a chain
    let mut graph = DependencyGraph::new();
    let all_cells: Vec<CellId> = (1..=100).map(cid).collect();

    for i in 1..50 {
        graph.set_precedents(&all_cells[i], vec![DepTarget::Cell(all_cells[i - 1])]);
    }
    for i in 51..100 {
        graph.set_precedents(&all_cells[i], vec![DepTarget::Cell(all_cells[i - 1])]);
    }

    // Change one formula in subgraph A: update cell 25's precedents
    // (e.g., user edited the formula to also reference a cell in subgraph B)
    graph.set_precedents(
        &all_cells[25],
        vec![
            DepTarget::Cell(all_cells[24]), // original dep
            DepTarget::Cell(all_cells[75]), // new cross-subgraph dep
        ],
    );

    // Only cells downstream of cell 25 in subgraph A should be dirty,
    // plus cell 25 itself and the changed root
    let affected_a = graph
        .affected_cells(&[all_cells[0]], &null_resolver)
        .into_value();
    // Changing cell 0 affects the entire subgraph A chain (cells 0..=49)
    for (i, cell) in all_cells[..50].iter().enumerate() {
        assert!(
            affected_a.contains(cell),
            "cell {i} should be affected when cell 0 changes",
        );
    }
    // Subgraph B cells should NOT be affected (cell 25 depends on B, not the other way)
    for (i, cell) in all_cells[50..100].iter().enumerate() {
        let idx = i + 50;
        assert!(
            !affected_a.contains(cell),
            "cell {idx} (subgraph B) should NOT be affected",
        );
    }

    // Now change a cell in subgraph B that cell 25 depends on
    let affected_b = graph
        .affected_cells(&[all_cells[75]], &null_resolver)
        .into_value();
    // cell 75 change should affect cells 76..=99 in subgraph B
    for (i, cell) in all_cells[75..100].iter().enumerate() {
        let idx = i + 75;
        assert!(
            affected_b.contains(cell),
            "cell {idx} should be affected when cell 75 changes",
        );
    }
    // cell 25 depends on cell 75, so cell 25 and its downstream (26..=49) should also be affected
    assert!(
        affected_b.contains(&all_cells[25]),
        "cell 25 should be affected (it depends on cell 75)"
    );
    for (i, cell) in all_cells[26..50].iter().enumerate() {
        let idx = i + 26;
        assert!(
            affected_b.contains(cell),
            "cell {idx} (downstream of 25) should be affected",
        );
    }
    // cells 0..25 in subgraph A should NOT be affected
    for (i, cell) in all_cells[..25].iter().enumerate() {
        assert!(
            !affected_b.contains(cell),
            "cell {i} (upstream of 25) should NOT be affected",
        );
    }
}

#[test]
fn test_position_resolver_returns_none_for_all_cells() {
    // Build a graph with range deps and verify that get_affected_cells_with_positions
    // degrades gracefully when position resolution returns None for all cells.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let sum_cell = cid(100);
    let data_cell = cid(1);

    // sum_cell depends on a range
    graph.set_precedents(
        &sum_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 99, 0),
            RangeAccess::Aggregate,
        )],
    );

    // Empty positions map — resolver returns None for all cells
    let positions: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    // Should not panic — degrades gracefully
    let affected = {
        let _resolver = |cell: &CellId| -> Option<CellPosition> {
            positions
                .get(cell)
                .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
        };
        graph.affected_cells(&[data_cell], &_resolver).into_value()
    };

    // The changed cell itself should be in the result
    assert!(
        affected.contains(&data_cell),
        "Changed cell should always be in the affected set"
    );

    // Without positions, the range lookup cannot match data_cell to sum_cell's range,
    // so sum_cell may or may not be in the result depending on implementation.
    // The key invariant: no panic, and the changed cell is present.
}

// ─────────────────────────────────────────────────────────────────
// Stress tests
// ─────────────────────────────────────────────────────────────────

#[test]
#[allow(clippy::cast_possible_truncation)]
fn test_stress_100k_cells_linear_chain() {
    // 100K cell linear chain — verifies the graph handles large scale
    let mut graph = DependencyGraph::new();
    let n = 100_000u128;
    for i in 2..=n {
        graph.set_precedents(
            &CellId::from_raw(i),
            vec![DepTarget::Cell(CellId::from_raw(i - 1))],
        );
    }
    assert_eq!(graph.formula_cell_count(), (n - 1) as usize);

    // Partial recalc from root should propagate to all cells
    let affected = graph
        .affected_cells(&[CellId::from_raw(1)], &null_resolver)
        .into_value();
    assert_eq!(affected.len(), n as usize);
}

#[test]
fn test_cycle_detected_contains_all_cycle_members() {
    // Verify `GraphError::CycleDetected` lists ALL participating cells
    let mut graph = DependencyGraph::new();
    let a = CellId::from_raw(1);
    let b = CellId::from_raw(2);
    let c = CellId::from_raw(3);

    // A -> B -> C -> A (3-cell cycle)
    graph.set_precedents(&a, vec![DepTarget::Cell(c)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(b)]);

    let result = graph.evaluation_levels(&null_resolver);
    match result {
        Err(GraphError::CycleDetected { cycle_cores, .. }) => {
            assert!(cycle_cores.contains(&a), "cycle should contain a");
            assert!(cycle_cores.contains(&b), "cycle should contain b");
            assert!(cycle_cores.contains(&c), "cycle should contain c");
            assert_eq!(cycle_cores.len(), 3);
        }
        Ok(_) | Err(_) => panic!("expected CycleDetected error"),
    }
}

#[test]
fn test_duplicate_range_edges() {
    // A formula references the same range twice — should not double-count
    let mut graph = DependencyGraph::new();
    let sheet = SheetId::from_raw(1);
    let f = CellId::from_raw(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);

    graph.set_precedents(
        &f,
        vec![
            DepTarget::Range(range, RangeAccess::Aggregate),
            DepTarget::Range(range, RangeAccess::Aggregate),
        ],
    );

    // The range should only appear once in range_deps (deduped by the FxHashMap key)
    assert_eq!(graph.range_dep_count(), 1);

    // Querying should still return the formula
    let found = graph.find_by_range_containment(&[(sheet, 500, 0)]);
    assert!(found.contains(&f));
}

// ─────────────────────────────────────────────────────────────────
// Scale & edge-case tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_100k_linear_chain_correctness() {
    // Build a linear chain: cell 0 <- cell 1 <- cell 2 <- ... <- cell 99_999
    // Each cell depends on the previous one.
    let mut graph = DependencyGraph::new();
    let count = 100_000u128;

    for i in 1..count {
        graph.set_precedents(&cid(i), vec![DepTarget::Cell(cid(i - 1))]);
    }

    // Topo sort should place cell 0 before cell 99_999
    let order: Vec<CellId> = graph
        .evaluation_levels(&null_resolver)
        .expect("no cycles in linear chain")
        .into_value()
        .into_iter()
        .flatten()
        .collect();
    let pos_first = order.iter().position(|c| *c == cid(0)).unwrap();
    let pos_last = order.iter().position(|c| *c == cid(count - 1)).unwrap();
    assert!(
        pos_first < pos_last,
        "root (cell 0) must appear before the tail (cell 99999) in topo order"
    );

    // Changing the root should affect every cell in the chain
    let affected = graph.affected_cells(&[cid(0)], &null_resolver).into_value();
    assert_eq!(
        affected.len() as u128,
        count,
        "all 100K cells should be affected when root changes"
    );
}

#[test]
fn test_100k_fan_out() {
    // One root with 100K direct dependents: dep_i depends on root.
    let mut graph = DependencyGraph::new();
    let root = cid(0);
    let fan_count = 100_000u128;

    for i in 1..=fan_count {
        graph.set_precedents(&cid(i), vec![DepTarget::Cell(root)]);
    }

    // Changing root should affect root + all 100K dependents
    let affected = graph.affected_cells(&[root], &null_resolver).into_value();
    assert_eq!(
        affected.len() as u128,
        fan_count + 1,
        "root + all dependents should be affected"
    );

    // Every dependent must appear in the affected set
    for i in 1..=fan_count {
        assert!(
            affected.contains(&cid(i)),
            "dependent cell {i} should be in the affected set"
        );
    }
}

#[test]
fn test_duplicate_cell_dependency_handling() {
    // Passing duplicate DepTarget::Cell entries should not panic and
    // should resolve to the correct dependent count (deduplicated).
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // b depends on a, listed twice
    graph.set_precedents(&b, vec![DepTarget::Cell(a), DepTarget::Cell(a)]);

    // a's dependent set should contain b exactly once
    assert_eq!(
        graph.dependent_count(&a),
        1,
        "duplicate deps should be deduplicated"
    );
    assert!(graph.has_dependent(&a, &b));

    // Affected-cells from changing a should list both a and b
    let affected = graph.affected_cells(&[a], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert_eq!(affected.len(), 2);
}

#[test]
fn test_sheets_with_range_deps_cache_consistency() {
    // Verify has_range_deps_for_sheet stays consistent across
    // add / remove-cell / cleanup-sheet operations.
    let mut graph = DependencyGraph::new();
    let sheet_a = sid(1);
    let sheet_b = sid(2);

    let f1 = cid(1);
    let f2 = cid(2);

    let range_a = RangePos::new(sheet_a, 0, 0, 999, 0);
    let range_b = RangePos::new(sheet_b, 0, 0, 999, 0);

    // Step 1: add range deps on both sheets
    graph.set_precedents(&f1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(range_b, RangeAccess::Aggregate)]);

    assert!(
        graph.has_range_deps_for_sheet(&sheet_a),
        "sheet_a should have range deps after set_precedents"
    );
    assert!(
        graph.has_range_deps_for_sheet(&sheet_b),
        "sheet_b should have range deps after set_precedents"
    );

    // Step 2: remove the cell that had range deps on sheet_a
    graph.remove_cell(&f1);
    assert!(
        !graph.has_range_deps_for_sheet(&sheet_a),
        "sheet_a should lose range deps after removing f1"
    );
    assert!(
        graph.has_range_deps_for_sheet(&sheet_b),
        "sheet_b should still have range deps"
    );

    // Step 3: clean up sheet_b ranges explicitly
    graph.cleanup_sheet_ranges(&sheet_b);
    assert!(
        !graph.has_range_deps_for_sheet(&sheet_b),
        "sheet_b should lose range deps after cleanup_sheet_ranges"
    );
}

#[test]
fn test_mixed_volatile_and_range_deps() {
    // A graph where some cells are volatile AND have range deps.
    // Verify that affected-cells computation captures both paths.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    // Cells: data (cid 1), range_formula (cid 2), volatile_cell (cid 3),
    // downstream (cid 4) depends on volatile_cell via cell edge.
    let data = cid(1);
    let range_formula = cid(2);
    let volatile_cell = cid(3);
    let downstream = cid(4);

    // range_formula depends on a range that covers data's position
    let range = RangePos::new(sheet, 0, 0, 9, 0);
    graph.set_precedents(
        &range_formula,
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    );

    // volatile_cell is volatile (e.g. NOW())
    graph.mark_volatile(&volatile_cell);

    // downstream depends on volatile_cell via cell edge
    graph.set_precedents(&downstream, vec![DepTarget::Cell(volatile_cell)]);

    // Position resolver: data is at (sheet, 0, 0), range_formula at (sheet, 0, 1),
    // volatile_cell at (sheet, 0, 2), downstream at (sheet, 0, 3)
    let mut positions: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();
    positions.insert(data, (sheet, 0, 0));
    positions.insert(range_formula, (sheet, 0, 1));
    positions.insert(volatile_cell, (sheet, 0, 2));
    positions.insert(downstream, (sheet, 0, 3));

    // When data changes, affected should include:
    // - data (changed)
    // - range_formula (via range dep)
    // - volatile_cell (always included because volatile)
    // - downstream (depends on volatile_cell)
    let affected = {
        let _resolver = |cell: &CellId| -> Option<CellPosition> {
            positions
                .get(cell)
                .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
        };
        graph.affected_cells(&[data], &_resolver).into_value()
    };

    assert!(
        affected.contains(&data),
        "changed cell should be in affected set"
    );
    assert!(
        affected.contains(&range_formula),
        "range_formula should be affected via range containment"
    );
    assert!(
        affected.contains(&volatile_cell),
        "volatile cells are always included in affected set"
    );
    assert!(
        affected.contains(&downstream),
        "downstream should be affected via cell dep on volatile_cell"
    );
    assert_eq!(affected.len(), 4, "exactly 4 cells should be affected");
}

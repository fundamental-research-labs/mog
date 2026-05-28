use super::*;

#[test]
fn test_bulk_set_precedents_matches_individual() {
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);

    let deps_list: Vec<(CellId, Vec<DepTarget>)> = vec![
        (
            cid(1),
            vec![DepTarget::Cell(cid(10)), DepTarget::Cell(cid(11))],
        ),
        (
            cid(2),
            vec![
                DepTarget::Cell(cid(10)),
                DepTarget::Range(range, RangeAccess::Aggregate),
            ],
        ),
        (
            cid(3),
            vec![DepTarget::Cell(cid(11)), DepTarget::Cell(cid(12))],
        ),
        (
            cid(4),
            vec![DepTarget::Range(range, RangeAccess::Aggregate)],
        ),
    ];

    // Build via bulk
    let mut builder = GraphBuilder::new();
    builder.bulk_set_precedents(deps_list.clone());
    let bulk_graph = builder.build();

    // Build via individual
    let mut individual_graph = DependencyGraph::new();
    for (cell, deps) in deps_list {
        individual_graph.set_precedents(&cell, deps);
    }

    // Compare: same precedents for every cell
    for id in [1, 2, 3, 4, 10, 11, 12] {
        let cell = cid(id);
        assert_eq!(
            bulk_graph.get_precedents(&cell),
            individual_graph.get_precedents(&cell),
            "precedents mismatch for cell {id}",
        );
    }

    // Compare: same dependents for every target cell
    for id in [10, 11, 12] {
        let cell = cid(id);
        let bulk_deps: FxHashSet<CellId> = bulk_graph.get_dependents(&cell).copied().collect();
        let ind_deps: FxHashSet<CellId> = individual_graph.get_dependents(&cell).copied().collect();
        assert_eq!(bulk_deps, ind_deps, "dependents mismatch for cell {id}",);
    }

    // Compare: same statistics
    assert_eq!(
        bulk_graph.formula_cell_count(),
        individual_graph.formula_cell_count()
    );
    assert_eq!(bulk_graph.edge_count(), individual_graph.edge_count());
    assert_eq!(
        bulk_graph.range_dep_count(),
        individual_graph.range_dep_count()
    );
    assert_eq!(
        bulk_graph.has_range_deps_for_sheet(&sheet),
        individual_graph.has_range_deps_for_sheet(&sheet),
    );
    assert_eq!(
        bulk_graph.has_range_index_for_sheet(&sheet),
        individual_graph.has_range_index_for_sheet(&sheet),
    );
}

#[test]
fn test_bulk_set_precedents_range_index_works() {
    // After bulk insert, the range index should be queryable.
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 50, 0);
    let f = cid(100);
    let mut builder = GraphBuilder::new();
    builder.bulk_set_precedents(vec![(
        f,
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    )]);
    let graph = builder.build();

    // Should find f via range containment
    let result = graph.find_by_range_containment(&[(sheet, 25, 0)]);
    assert!(result.contains(&f));
}

#[test]
#[cfg_attr(
    debug_assertions,
    should_panic(expected = "bulk_set_precedents received duplicate CellIds")
)]
fn bulk_set_precedents_deduplicates_cell_ids() {
    // Same cell appears twice — second entry should win, no stale reverse edges.
    // In debug builds, the debug_assert fires to alert callers about the duplicates.
    // In release builds, dedup silently keeps the last entry.
    let sheet = sid(1);
    let f = cid(1);
    let a = cid(10);
    let b = cid(20);
    let r1 = RangePos::new(sheet, 0, 0, 50, 0);
    let r2 = RangePos::new(sheet, 100, 0, 200, 0);

    let mut builder = GraphBuilder::new();
    builder.bulk_set_precedents(vec![
        (
            f,
            vec![
                DepTarget::Cell(a),
                DepTarget::Range(r1, RangeAccess::Aggregate),
            ],
        ), // first entry — should be discarded
        (
            f,
            vec![
                DepTarget::Cell(b),
                DepTarget::Range(r2, RangeAccess::Aggregate),
            ],
        ), // second entry — should win
    ]);
    let graph = builder.build();

    // These assertions verify correctness in release mode (debug_assert is stripped).
    // Forward edge should use second entry's deps (last wins)
    assert_eq!(
        graph.get_precedents(&f),
        &[
            DepTarget::Cell(b),
            DepTarget::Range(r2, RangeAccess::Aggregate)
        ],
    );

    // Reverse cell edge for second entry's dep should exist
    assert!(graph.has_dependent(&b, &f), "b should have f as dependent");

    // Reverse cell edge for first entry's dep should NOT exist (no stale leak)
    assert!(
        !graph.has_dependent(&a, &f),
        "a should NOT have f as dependent — first entry was overwritten"
    );

    // Range dep for second entry's range should exist
    let result_r2 = graph.find_by_range_containment(&[(sheet, 150, 0)]);
    assert!(result_r2.contains(&f), "r2 should have f as dependent");

    // Range dep for first entry's range should NOT exist (no stale leak)
    let result_r1 = graph.find_by_range_containment(&[(sheet, 25, 0)]);
    assert!(
        !result_r1.contains(&f),
        "r1 should NOT have f as dependent — first entry was overwritten"
    );

    // Only 1 formula cell, 2 edges (1 cell + 1 range)
    assert_eq!(graph.formula_cell_count(), 1);
    assert_eq!(graph.edge_count(), 2);
}

#[test]
fn test_deferred_index_rebuild_with_mixed_threshold_deps() {
    // Realistic scenario: one formula depends on BOTH a small range (expanded
    // to individual Cell edges) AND a large range (stored as a Range dep).
    // We use set_precedents_fresh_defer_index + rebuild_range_index.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let formula = cid(5000);

    // Small range: 3 rows × 3 cols = 9 cells (well below threshold)
    // We expand these to individual cell edges.
    let small_range = RangePos::new(sheet, 0, 0, 2, 2);
    assert!(small_range.cell_count() < RANGE_EXPANSION_THRESHOLD);

    let mut targets: Vec<DepTarget> = Vec::new();
    for r in 0..=2u32 {
        for c in 0..=2u32 {
            let id = u128::from(r) * 100 + u128::from(c) + 1;
            targets.push(DepTarget::Cell(cid(id)));
        }
    }
    assert_eq!(targets.len(), 9);

    // Large range: 20 rows × 20 cols = 400 cells (above threshold)
    let large_range = RangePos::new(sheet, 100, 0, 119, 19);
    assert!(large_range.cell_count() >= RANGE_EXPANSION_THRESHOLD);
    targets.push(DepTarget::Range(large_range, RangeAccess::Aggregate));

    // Use batch mutations (deferred index build)
    {
        let mut batch = graph.batch_mutations();
        batch.set_precedents_fresh(&formula, targets);
    }

    // --- Verify cell edges from the small range ---
    for r in 0..=2u32 {
        for c in 0..=2u32 {
            let id = u128::from(r) * 100 + u128::from(c) + 1;
            assert!(
                graph.has_dependent(&cid(id), &formula),
                "small-range cell ({r},{c}) should have formula as dependent"
            );
        }
    }

    // Affected cells should include the formula
    let changed = cid(1); // row 0, col 0 of the small range
    let affected = graph
        .affected_cells(&[changed], &null_resolver())
        .into_value();
    assert!(affected.contains(&formula));

    // --- Verify range dep for the large range ---
    assert_eq!(graph.range_dep_count(), 1);

    assert!(
        graph
            .find_by_range_containment(&[(sheet, 110, 10)])
            .contains(&formula),
        "point inside large range should find the formula"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 100, 0)])
            .contains(&formula),
        "top-left of large range should find the formula"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 119, 19)])
            .contains(&formula),
        "bottom-right of large range should find the formula"
    );

    // Points outside the large range should not find the formula via range containment
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 99, 0)])
            .is_empty(),
        "row 99 is outside the large range"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 120, 0)])
            .is_empty(),
        "row 120 is outside the large range"
    );
}

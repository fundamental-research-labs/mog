use super::*;

#[test]
fn test_range_expansion_threshold_value() {
    // Contract test: the threshold is 256. Callers rely on this value
    // to decide whether to expand ranges to individual Cell edges.
    assert_eq!(RANGE_EXPANSION_THRESHOLD, 256);
}

#[test]
fn test_small_range_as_individual_cells() {
    // 15 rows × 17 cols = 255 cells — just below the threshold.
    // A correct caller would expand this to 255 individual Cell edges.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let formula = cid(1000);

    let range = RangePos::new(sheet, 0, 0, 14, 16); // rows 0..=14, cols 0..=16
    assert_eq!(range.cell_count(), 255);
    assert!(range.cell_count() < RANGE_EXPANSION_THRESHOLD);

    // Expand to individual cell edges (simulating what a caller does for small ranges)
    let mut cell_targets = Vec::new();
    for r in 0..=14u32 {
        for c in 0..=16u32 {
            // Encode a unique CellId for each position. Use a deterministic scheme.
            let id = u128::from(r) * 1000 + u128::from(c) + 1;
            cell_targets.push(DepTarget::Cell(cid(id)));
        }
    }
    assert_eq!(cell_targets.len(), 255);

    graph.set_precedents(&formula, cell_targets);

    // No range deps were stored — everything is cell-to-cell
    assert_eq!(graph.range_dep_count(), 0);

    // Each individual cell should have `formula` as a dependent
    for r in 0..=14u32 {
        for c in 0..=16u32 {
            let id = u128::from(r) * 1000 + u128::from(c) + 1;
            assert!(
                graph.has_dependent(&cid(id), &formula),
                "cell ({r},{c}) should have formula as dependent"
            );
        }
    }

    // Affected cells should include the formula
    let changed_cell = cid(1); // row 0, col 0
    let affected = graph
        .affected_cells(&[changed_cell], &null_resolver())
        .into_value();
    assert!(affected.contains(&formula));
}

#[test]
fn test_large_range_as_range_dep() {
    // 16 × 16 = 256 cells — exactly at threshold.
    // A correct caller would store this as a Range dep.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let formula = cid(1000);

    let range = RangePos::new(sheet, 0, 0, 15, 15); // rows 0..=15, cols 0..=15
    assert_eq!(range.cell_count(), 256);
    assert!(range.cell_count() >= RANGE_EXPANSION_THRESHOLD);

    graph.set_precedents(
        &formula,
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    );

    assert_eq!(graph.range_dep_count(), 1);

    // Points inside the range should find the formula
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 0, 0)])
            .contains(&formula),
        "top-left corner should be inside"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 15, 15)])
            .contains(&formula),
        "bottom-right corner should be inside"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 8, 8)])
            .contains(&formula),
        "center should be inside"
    );

    // Points outside the range should not find the formula
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 16, 0)])
            .is_empty(),
        "row 16 is outside"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 0, 16)])
            .is_empty(),
        "col 16 is outside"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sid(2), 8, 8)])
            .is_empty(),
        "different sheet is outside"
    );
}

#[test]
fn test_threshold_boundary_257() {
    // 257 cells — just above threshold. Should behave the same as 256.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let formula = cid(1000);

    // 257 rows × 1 col = 257 cells
    let range = RangePos::new(sheet, 0, 0, 256, 0);
    assert_eq!(range.cell_count(), 257);
    assert!(range.cell_count() > RANGE_EXPANSION_THRESHOLD);

    graph.set_precedents(
        &formula,
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    );

    assert_eq!(graph.range_dep_count(), 1);

    // Points inside the range
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 0, 0)])
            .contains(&formula),
        "first row should be inside"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 256, 0)])
            .contains(&formula),
        "last row should be inside"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 128, 0)])
            .contains(&formula),
        "middle row should be inside"
    );

    // Points outside the range
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 257, 0)])
            .is_empty(),
        "row 257 is outside"
    );
    assert!(
        graph.find_by_range_containment(&[(sheet, 0, 1)]).is_empty(),
        "col 1 is outside"
    );
}

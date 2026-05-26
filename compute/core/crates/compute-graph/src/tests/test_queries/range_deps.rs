use super::*;

// ─────────────────────────────────────────────────────────────────
// Range dependencies and affected cells
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_range_dependency() {
    let mut graph = DependencyGraph::new();
    let sum_cell = cid(100);
    let sheet = sid(1);

    // sum_cell depends on range A1:D100 (400 cells >= 256 threshold, stored as range)
    graph.set_precedents(
        &sum_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 99, 3),
            RangeAccess::Aggregate,
        )],
    );

    // Verify range_deps was populated
    assert_eq!(graph.range_deps.len(), 1);
    let expected_rect = RangePos::new(sheet, 0, 0, 99, 3);
    let dep_set = graph.range_deps.get(&expected_rect).unwrap();
    assert!(dep_set.contains(&sum_cell));
    assert_eq!(dep_set.len(), 1);

    // Verify the range rect
    let rect = graph.range_deps.keys().next().unwrap();
    assert_eq!(rect.sheet(), sheet);
    assert_eq!(rect.start_row(), 0);
    assert_eq!(rect.end_row(), 99);
}

#[test]
fn test_range_dependency_with_positions() {
    let mut graph = DependencyGraph::new();
    let sum_cell = cid(100);
    let data_cell = cid(50);
    let sheet = sid(1);

    // sum_cell depends on range A1:D100
    graph.set_precedents(
        &sum_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 99, 3),
            RangeAccess::Aggregate,
        )],
    );

    // data_cell is at position (5, 2) — within the range
    let mut positions = FxHashMap::default();
    positions.insert(data_cell, (sheet, 5, 2));

    let _resolver = |cell: &CellId| -> Option<CellPosition> {
        positions
            .get(cell)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    };
    let affected = graph.affected_cells(&[data_cell], &_resolver).into_value();
    assert!(
        affected.contains(&sum_cell),
        "sum_cell should be affected when a cell in its range changes"
    );
}

#[test]
fn test_range_dependency_outside_range() {
    let mut graph = DependencyGraph::new();
    let sum_cell = cid(100);
    let outside_cell = cid(50);
    let sheet = sid(1);

    // sum_cell depends on range A1:D10
    graph.set_precedents(
        &sum_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 9, 3),
            RangeAccess::Aggregate,
        )],
    );

    // outside_cell is at position (20, 5) — outside the range
    let mut positions = FxHashMap::default();
    positions.insert(outside_cell, (sheet, 20, 5));

    let _resolver = |cell: &CellId| -> Option<CellPosition> {
        positions
            .get(cell)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    };
    let affected = graph
        .affected_cells(&[outside_cell], &_resolver)
        .into_value();
    assert!(
        !affected.contains(&sum_cell),
        "sum_cell should NOT be affected when a cell outside its range changes"
    );
}

#[test]
fn test_range_pos_contains() {
    let rect = RangePos::new(sid(1), 5, 2, 10, 7);

    // Inside
    assert!(rect.contains_pos(sid(1), 5, 2));
    assert!(rect.contains_pos(sid(1), 7, 4));
    assert!(rect.contains_pos(sid(1), 10, 7));

    // Outside
    assert!(!rect.contains_pos(sid(1), 4, 2));
    assert!(!rect.contains_pos(sid(1), 11, 2));
    assert!(!rect.contains_pos(sid(1), 7, 8));
    assert!(!rect.contains_pos(sid(1), 7, 1));

    // Different sheet
    assert!(!rect.contains_pos(sid(2), 7, 4));
}

#[test]
fn test_range_pos_cell_count() {
    let rect = RangePos::new(sid(1), 0, 0, 15, 15);
    assert_eq!(rect.cell_count(), 256); // 16 * 16

    let small = RangePos::new(sid(1), 0, 0, 0, 0);
    assert_eq!(small.cell_count(), 1);
}

#[test]
fn test_get_range_dependents_at() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 10, 10);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&b, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    // Point inside range
    let deps = graph.get_range_dependents_at(sheet, 5, 5);
    assert!(deps.contains(&a));
    assert!(deps.contains(&b));

    // Point outside range
    let deps_outside = graph.get_range_dependents_at(sheet, 20, 20);
    assert!(deps_outside.is_empty());

    // Different sheet
    let deps_other_sheet = graph.get_range_dependents_at(sid(2), 5, 5);
    assert!(deps_other_sheet.is_empty());
}

// ─────────────────────────────────────────────────────────────────
// find_by_range_containment
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_find_by_range_containment_basic() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);
    let formula_cell = cid(100);
    graph.set_precedents(
        &formula_cell,
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    );

    // Position (sheet=1, row=500, col=0) is inside the range
    let result = graph.find_by_range_containment(&[(sheet, 500, 0)]);
    assert!(result.contains(&formula_cell));
}

#[test]
fn test_find_by_range_containment_outside_range() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 10, 5);
    graph.set_precedents(
        &cid(100),
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    );

    // Row 11 is outside
    let result = graph.find_by_range_containment(&[(sheet, 11, 0)]);
    assert!(result.is_empty());

    // Col 6 is outside
    let result = graph.find_by_range_containment(&[(sheet, 5, 6)]);
    assert!(result.is_empty());
}

#[test]
fn test_find_by_range_containment_boundary_inclusive() {
    // Ranges should be inclusive on all four edges: start_row, end_row,
    // start_col, end_col.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let range = RangePos::new(sheet, 5, 3, 10, 7);
    let f = cid(100);
    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    // All four corners should be inside
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 5, 3)])
            .contains(&f),
        "top-left"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 5, 7)])
            .contains(&f),
        "top-right"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 10, 3)])
            .contains(&f),
        "bottom-left"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 10, 7)])
            .contains(&f),
        "bottom-right"
    );

    // Just outside each edge
    assert!(
        graph.find_by_range_containment(&[(sheet, 4, 5)]).is_empty(),
        "above"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 11, 5)])
            .is_empty(),
        "below"
    );
    assert!(
        graph.find_by_range_containment(&[(sheet, 7, 2)]).is_empty(),
        "left"
    );
    assert!(
        graph.find_by_range_containment(&[(sheet, 7, 8)]).is_empty(),
        "right"
    );
}

#[test]
fn test_find_by_range_containment_wrong_sheet() {
    // A position on sheet 2 should NOT match a range on sheet 1, even if
    // row/col coordinates are inside the range rectangle.
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let range = RangePos::new(sheet1, 0, 0, 999, 999);
    graph.set_precedents(
        &cid(100),
        vec![DepTarget::Range(range, RangeAccess::Aggregate)],
    );

    let result = graph.find_by_range_containment(&[(sheet2, 50, 50)]);
    assert!(result.is_empty(), "different sheet should not match");
}

#[test]
fn test_find_by_range_containment_deduplicates() {
    // If two positions fall in the same range, the formula cell should
    // appear only once in the result (deduplicated).
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 100, 0);
    let f = cid(50);
    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let result = graph.find_by_range_containment(&[(sheet, 10, 0), (sheet, 20, 0), (sheet, 30, 0)]);
    assert_eq!(result.len(), 1);
    assert!(result.contains(&f));
}

#[test]
fn test_find_by_range_containment_multiple_formulas_same_range() {
    // Multiple formula cells can depend on the same range. A position
    // inside that range should return all of them.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let range = RangePos::new(sheet, 0, 0, 50, 0);
    let f1 = cid(100);
    let f2 = cid(200);
    graph.set_precedents(&f1, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let result = graph.find_by_range_containment(&[(sheet, 25, 0)]);
    assert!(result.contains(&f1));
    assert!(result.contains(&f2));
    assert_eq!(result.len(), 2);
}

#[test]
fn test_find_by_range_containment_overlapping_ranges() {
    // If a formula depends on range R1 and another on R2, and a position
    // falls in both, both formulas should be returned.
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let r1 = RangePos::new(sheet, 0, 0, 50, 5);
    let r2 = RangePos::new(sheet, 30, 0, 80, 5);
    let f1 = cid(100);
    let f2 = cid(200);
    graph.set_precedents(&f1, vec![DepTarget::Range(r1, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(r2, RangeAccess::Aggregate)]);

    // Position (40, 3) is in the overlap
    let result = graph.find_by_range_containment(&[(sheet, 40, 3)]);
    assert!(result.contains(&f1));
    assert!(result.contains(&f2));

    // Position (10, 3) is only in R1
    let result = graph.find_by_range_containment(&[(sheet, 10, 3)]);
    assert!(result.contains(&f1));
    assert!(!result.contains(&f2));

    // Position (70, 3) is only in R2
    let result = graph.find_by_range_containment(&[(sheet, 70, 3)]);
    assert!(!result.contains(&f1));
    assert!(result.contains(&f2));
}

use super::*;

/// `cleanup_sheet_ranges` removes all range deps and index entries for the target sheet.
#[test]
fn test_cleanup_sheet_ranges_removes_range_deps() {
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
    graph.set_precedents(
        &b_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );

    assert!(graph.has_range_deps_for_sheet(&sheet2));
    assert!(graph.has_range_index_for_sheet(&sheet2));
    assert_eq!(graph.range_dep_count(), 2);

    graph.cleanup_sheet_ranges(&sheet2);

    assert!(!graph.has_range_deps_for_sheet(&sheet2));
    assert!(!graph.has_range_index_for_sheet(&sheet2));
    assert_eq!(graph.range_dep_count(), 1);
    assert!(graph.has_range_deps_for_sheet(&sheet1));
}

/// `cleanup_sheet_ranges` is a no-op for sheets with no range deps.
#[test]
fn test_cleanup_sheet_ranges_noop_for_unknown_sheet() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet99 = sid(99);
    let a_cell = cid(100);

    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 0, 99, 0),
            RangeAccess::Aggregate,
        )],
    );

    assert_eq!(graph.range_dep_count(), 1);
    graph.cleanup_sheet_ranges(&sheet99);
    assert_eq!(graph.range_dep_count(), 1);
}

/// `cleanup_sheet_ranges` preserves cell-to-cell edges (only removes range deps).
#[test]
fn test_cleanup_sheet_ranges_preserves_cell_edges() {
    let mut graph = DependencyGraph::new();
    let sheet2 = sid(2);
    let a_cell = cid(100);
    let b_cell = cid(200);

    graph.set_precedents(
        &a_cell,
        vec![
            DepTarget::Cell(b_cell),
            DepTarget::Range(RangePos::new(sheet2, 0, 0, 999, 0), RangeAccess::Aggregate),
        ],
    );

    graph.cleanup_sheet_ranges(&sheet2);

    assert!(graph.has_cell(&a_cell));
    assert!(graph.has_dependent(&b_cell, &a_cell));
    assert!(!graph.has_range_deps_for_sheet(&sheet2));
}

/// `cleanup_sheet_ranges` should also clean stale `DepTarget::Range` entries from precedents,
/// so `edge_count()` remains accurate and subsequent `set_precedents` doesn't try to remove
/// phantom ranges.
#[test]
fn test_cleanup_sheet_ranges_edge_count_consistent() {
    let mut graph = DependencyGraph::new();
    let sheet2 = sid(2);
    let a_cell = cid(100);
    let b_cell = cid(200);

    graph.set_precedents(
        &a_cell,
        vec![
            DepTarget::Cell(b_cell),
            DepTarget::Range(RangePos::new(sheet2, 0, 0, 999, 0), RangeAccess::Aggregate),
        ],
    );

    // Before cleanup: 1 cell edge + 1 range edge = 2
    assert_eq!(graph.edge_count(), 2);

    graph.cleanup_sheet_ranges(&sheet2);

    // After cleanup: only the cell edge remains
    assert_eq!(graph.edge_count(), 1);
    assert_eq!(graph.get_precedents(&a_cell), &[DepTarget::Cell(b_cell)]);

    // set_precedents should work cleanly afterwards (no phantom range in remove_old_edges)
    graph.set_precedents(&a_cell, vec![DepTarget::Cell(cid(300))]);
    assert_eq!(graph.edge_count(), 1);
}

/// A formula cell whose only dep is a range on the deleted sheet should
/// survive as a formula cell with empty deps (it will evaluate to #REF!).
#[test]
fn test_cleanup_sheet_ranges_preserves_range_only_formula_cells() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let a = cid(1);

    let range = RangePos::new(sheet2, 0, 0, 999, 0);
    graph.set_precedents(&a, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    assert_eq!(graph.formula_cell_count(), 1);

    graph.cleanup_sheet_ranges(&sheet2);

    // Cell should still be a formula cell with empty deps
    assert_eq!(
        graph.formula_cell_count(),
        1,
        "range-only formula should survive cleanup"
    );
    assert!(graph.has_cell(&a));
    assert!(graph.get_precedents(&a).is_empty());

    // Cleaning up an unrelated sheet should be a no-op
    graph.cleanup_sheet_ranges(&sheet1);
    assert_eq!(graph.formula_cell_count(), 1);
}

/// When F depends only on a range from sheet2 and G depends on F,
/// cleanup_sheet_ranges(sheet2) keeps F as a formula cell with empty deps.
/// F remains a formula cell (evaluating to #REF!), G still depends on F.
#[test]
fn test_cleanup_sheet_ranges_formula_survives_with_downstream() {
    let mut graph = DependencyGraph::new();
    let sheet2 = sid(2);
    let f = cid(100); // F = SUM(Sheet2!A1:A1000)
    let g = cid(200); // G = F + 1

    // F depends on a range on sheet2
    graph.set_precedents(
        &f,
        vec![DepTarget::Range(
            RangePos::new(sheet2, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    // G depends on F (cell edge)
    graph.set_precedents(&g, vec![DepTarget::Cell(f)]);

    assert_eq!(graph.formula_cell_count(), 2);
    assert!(graph.has_cell(&f));
    assert!(graph.has_cell(&g));

    // Delete sheet2 — F's only deps are ranges on sheet2
    graph.cleanup_sheet_ranges(&sheet2);

    // F is still a formula cell (with empty deps), G still depends on it
    assert_eq!(graph.formula_cell_count(), 2);
    assert!(graph.has_cell(&f));
    assert!(graph.get_precedents(&f).is_empty());
    assert_eq!(graph.get_precedents(&g), &[DepTarget::Cell(f)]);

    // Now remove G — F remains as a formula cell with empty deps
    graph.remove_cell(&g);
    assert_eq!(graph.formula_cell_count(), 1);
    assert!(graph.has_cell(&f));
}

/// cleanup_sheet_ranges preserves volatile status. A volatile formula cell
/// whose only deps are ranges on the deleted sheet remains volatile (it
/// still has a formula, e.g. =NOW()+SUM(Sheet2!A:A)).
#[test]
fn test_cleanup_sheet_ranges_preserves_volatile_status() {
    let mut graph = DependencyGraph::new();
    let sheet2 = sid(2);
    let f = cid(100);

    graph.set_precedents(
        &f,
        vec![DepTarget::Range(
            RangePos::new(sheet2, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.mark_volatile(&f);

    assert!(graph.is_volatile(&f));
    assert_eq!(graph.formula_cell_count(), 1);
    assert_eq!(graph.volatile_count(), 1);

    graph.cleanup_sheet_ranges(&sheet2);

    // F is still a formula cell, and still volatile
    assert_eq!(graph.formula_cell_count(), 1);
    assert_eq!(graph.volatile_count(), 1);
    assert!(
        graph.is_volatile(&f),
        "volatile status should survive cleanup"
    );
}

/// After cleanup_sheet_ranges, F remains a formula cell (with empty deps).
/// Both F and G appear in evaluation_levels with F before G.
#[test]
fn test_cleanup_sheet_ranges_evaluation_order_valid_after_cleanup() {
    let mut graph = DependencyGraph::new();
    let sheet2 = sid(2);
    let f = cid(100); // F = SUM(Sheet2!A1:A1000)
    let g = cid(200); // G = F + 1

    graph.set_precedents(
        &f,
        vec![DepTarget::Range(
            RangePos::new(sheet2, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&g, vec![DepTarget::Cell(f)]);

    // Before cleanup: both are formula cells
    assert_eq!(graph.formula_cell_count(), 2);
    let nr = null_resolver();
    let order: Vec<CellId> = graph
        .evaluation_levels(&nr)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect();
    assert_eq!(order.len(), 2);

    graph.cleanup_sheet_ranges(&sheet2);

    // After cleanup: both are still formula cells
    assert_eq!(graph.formula_cell_count(), 2);
    assert!(graph.has_cell(&f));

    // Evaluation order still valid — F before G (G depends on F)
    let order: Vec<CellId> = graph
        .evaluation_levels(&nr)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect();
    assert_eq!(order.len(), 2);
    let f_pos = order.iter().position(|c| *c == f).unwrap();
    let g_pos = order.iter().position(|c| *c == g).unwrap();
    assert!(f_pos < g_pos, "F must come before G in evaluation order");
}

/// After cleanup_sheet_ranges, F remains a formula cell. G still depends
/// on F. After removing G, F remains as a formula cell with empty deps.
#[test]
fn test_cleanup_sheet_ranges_dependents_consistency() {
    let mut graph = DependencyGraph::new();
    let sheet2 = sid(2);
    let f = cid(100);
    let g = cid(200);

    graph.set_precedents(
        &f,
        vec![DepTarget::Range(
            RangePos::new(sheet2, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&g, vec![DepTarget::Cell(f)]);

    graph.cleanup_sheet_ranges(&sheet2);

    // F should still have G as a dependent (G's formula still references F)
    assert_eq!(graph.dependent_count(&f), 1);
    assert!(graph.has_dependent(&f, &g));

    // After removing G, F is still a formula cell (with empty deps)
    graph.remove_cell(&g);
    assert_eq!(graph.dependent_count(&f), 0);
    assert!(
        graph.has_cell(&f),
        "F should still exist as a formula cell with empty deps"
    );
    assert_eq!(graph.formula_cell_count(), 1);
}

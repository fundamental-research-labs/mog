use super::*;
use workbook_types::{
    ExternalA1Cell, ExternalAbsFlags, ExternalAddressKey, ExternalRefKey, LinkId,
};

fn external_key(link_raw: u128, row: u32, col: u32) -> ExternalRefKey {
    ExternalRefKey {
        link_id: LinkId::from_raw(link_raw),
        sheet: None,
        address: ExternalAddressKey::A1 {
            r#ref: ExternalA1Cell { row, col },
            abs: ExternalAbsFlags::default(),
        },
    }
}

#[test]
fn external_dependencies_are_indexed_separately_from_local_precedents() {
    let mut graph = DependencyGraph::new();
    let formula = CellId::from_raw(10);
    let local = CellId::from_raw(20);
    let key = external_key(1, 0, 0);

    graph.set_precedents(&formula, vec![DepTarget::Cell(local)]);
    graph.set_external_precedents(&formula, vec![key.clone()]);

    assert_eq!(graph.get_precedents(&formula), &[DepTarget::Cell(local)]);
    assert_eq!(
        graph.get_external_precedents(&formula),
        std::slice::from_ref(&key)
    );
    assert_eq!(
        graph
            .get_external_dependents(&key)
            .copied()
            .collect::<Vec<_>>(),
        vec![formula]
    );
}
use crate::RangeAccess;
use crate::positions::CellPosition;

fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn null_resolver() -> impl PositionResolver {
    |_: &CellId| -> Option<CellPosition> { None }
}

// ─────────────────────────────────────────────────────────────────
// Basic dependencies
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_basic_dependency_a_depends_on_b() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // A depends on B (A's formula references B)
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // A's precedents should include B
    assert_eq!(graph.get_precedents(&a), &[DepTarget::Cell(b)]);

    // B's dependents should include A
    assert!(graph.has_dependent(&b, &a));

    // Both cells should be in the graph
    assert!(graph.has_cell(&a));
    assert!(graph.has_cell(&b));
}

#[test]
fn test_fan_out() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A depends on B, C, D
    graph.set_precedents(
        &a,
        vec![DepTarget::Cell(b), DepTarget::Cell(c), DepTarget::Cell(d)],
    );

    // B changes -> only A affected (plus B itself)
    let affected = graph.affected_cells(&[b], &null_resolver()).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(!affected.contains(&c));
    assert!(!affected.contains(&d));
}

#[test]
fn test_fan_in() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A, B, C all depend on D
    graph.set_precedents(&a, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(d)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    // D changes -> A, B, C all affected
    let affected = graph.affected_cells(&[d], &null_resolver()).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(affected.contains(&c));
    assert!(affected.contains(&d));
}

// ─────────────────────────────────────────────────────────────────
// set_precedents replacement
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_update_precedents_replaces_old() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A initially depends on B
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    assert!(graph.has_dependent(&b, &a));

    // Now A depends on C instead
    graph.set_precedents(&a, vec![DepTarget::Cell(c)]);

    // B should no longer have A as dependent
    assert!(
        !graph.has_dependent(&b, &a),
        "B should not list A as dependent after A's precedents changed"
    );

    // C should have A as dependent
    assert!(graph.has_dependent(&c, &a));
}

#[test]
fn test_multiple_set_precedents_same_cell() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // A depends on B and C
    graph.set_precedents(&a, vec![DepTarget::Cell(b), DepTarget::Cell(c)]);

    assert_eq!(graph.edge_count(), 2);
    assert!(graph.has_dependent(&b, &a));
    assert!(graph.has_dependent(&c, &a));

    // Update: A now depends on C and D (B removed)
    graph.set_precedents(&a, vec![DepTarget::Cell(c), DepTarget::Cell(d)]);

    assert_eq!(graph.edge_count(), 2);
    assert!(!graph.has_dependent(&b, &a));
    assert!(graph.has_dependent(&c, &a));
    assert!(graph.has_dependent(&d, &a));
}

#[test]
fn test_set_precedents_replaces_range_deps() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f = cid(1);
    let r1 = RangePos::new(sheet, 0, 0, 50, 0);
    let r2 = RangePos::new(sheet, 100, 0, 200, 0);

    // Set initial range dep
    graph.set_precedents(&f, vec![DepTarget::Range(r1, RangeAccess::Aggregate)]);
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 25, 0)])
            .contains(&f)
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 150, 0)])
            .is_empty()
    );

    // Replace with different range
    graph.set_precedents(&f, vec![DepTarget::Range(r2, RangeAccess::Aggregate)]);
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 25, 0)])
            .is_empty(),
        "old range should be gone"
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 150, 0)])
            .contains(&f),
        "new range should be active"
    );
}

// ─────────────────────────────────────────────────────────────────
// remove_cell
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_remove_cell_cleans_up_both_directions() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A depends on B, B depends on C
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    // Remove B
    graph.remove_cell(&b);

    // B should no longer exist in the graph
    assert!(!graph.has_cell(&b));

    // A still has B in its precedents list (the DepTarget::Cell(b) entry remains
    // in the precedents map), but B's dependents set is gone.
    // Actually, remove_cell should also clean up cells that have B as dependent.
    // After removing B, C should not list B as dependent.
    assert!(
        !graph.has_dependent(&c, &b),
        "C should not list B as dependent after B is removed"
    );
}

#[test]
fn test_remove_cell_with_volatile() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    graph.mark_volatile(&a);
    assert!(graph.is_volatile(&a));
    assert!(graph.has_cell(&a));

    graph.remove_cell(&a);
    assert!(!graph.is_volatile(&a));
    assert!(!graph.has_cell(&a));
}

#[test]
fn test_remove_cell_from_range_deps() {
    let mut graph = DependencyGraph::new();
    let sum1 = cid(100);
    let sum2 = cid(101);
    let sheet = sid(1);

    let range = DepTarget::Range(RangePos::new(sheet, 0, 0, 99, 3), RangeAccess::Aggregate);

    // Both sum1 and sum2 depend on the same range
    graph.set_precedents(&sum1, vec![range.clone()]);
    graph.set_precedents(&sum2, vec![range]);

    assert_eq!(graph.range_deps.len(), 1);
    let expected_rect = RangePos::new(sheet, 0, 0, 99, 3);
    assert_eq!(graph.range_deps.get(&expected_rect).unwrap().len(), 2);

    // Remove sum1
    graph.remove_cell(&sum1);

    // Range should still exist with sum2
    assert_eq!(graph.range_deps.len(), 1);
    let dep_set = graph.range_deps.get(&expected_rect).unwrap();
    assert!(dep_set.contains(&sum2));
    assert_eq!(dep_set.len(), 1);
}

#[test]
fn test_remove_cell_cleans_up_range_deps_and_volatile() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f = cid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);

    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    graph.mark_volatile(&f);

    assert_eq!(graph.range_dep_count(), 1);
    assert!(graph.is_volatile(&f));

    graph.remove_cell(&f);

    // Everything should be cleaned up
    assert!(!graph.has_cell(&f));
    assert!(!graph.is_volatile(&f));
    assert_eq!(
        graph.range_dep_count(),
        0,
        "range deps should be cleaned up"
    );
    assert_eq!(graph.formula_cell_count(), 0);
}

// ─────────────────────────────────────────────────────────────────
// Volatile
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_volatile_mark_unmark() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    graph.mark_volatile(&a);
    assert!(graph.is_volatile(&a));
    assert_eq!(graph.volatile_count(), 1);

    graph.unmark_volatile(&a);
    assert!(!graph.is_volatile(&a));
    assert_eq!(graph.volatile_count(), 0);
}

#[test]
fn test_volatile_count() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    graph.mark_volatile(&a);
    graph.mark_volatile(&b);

    assert_eq!(graph.volatile_count(), 2);
}

#[test]
fn test_get_volatile_cells_empty() {
    let graph = DependencyGraph::new();
    assert!(graph.volatile_cells().next().is_none());
}

#[test]
fn test_get_volatile_cells_reflects_mark_unmark() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    graph.mark_volatile(&a);
    graph.mark_volatile(&b);
    graph.mark_volatile(&c);

    assert_eq!(graph.volatile_count(), 3);
    assert!(graph.is_volatile(&a));
    assert!(graph.is_volatile(&b));
    assert!(graph.is_volatile(&c));

    graph.unmark_volatile(&b);
    assert_eq!(graph.volatile_count(), 2);
    assert!(graph.is_volatile(&a));
    assert!(!graph.is_volatile(&b));
    assert!(graph.is_volatile(&c));
}

#[test]
fn test_get_volatile_cells_survives_clear() {
    // clear() should empty everything including volatile cells.
    let mut graph = DependencyGraph::new();
    graph.mark_volatile(&cid(1));
    graph.mark_volatile(&cid(2));
    assert_eq!(graph.volatile_count(), 2);

    graph.clear();
    assert!(graph.volatile_cells().next().is_none());
}

// ─────────────────────────────────────────────────────────────────
// clear
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_clear_resets_everything() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.mark_volatile(&a);

    graph.clear();

    assert_eq!(graph.formula_cell_count(), 0);
    assert_eq!(graph.edge_count(), 0);
    assert_eq!(graph.volatile_count(), 0);
    assert!(!graph.has_cell(&a));
    assert!(!graph.has_cell(&b));
}

// ─────────────────────────────────────────────────────────────────
// bulk_set_precedents_fresh
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// cleanup_sheet_ranges
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// cleanup_sheet_ranges — formula preservation tests
//
// These tests verify that cleanup_sheet_ranges preserves formula
// cells even when their only deps are ranges on the deleted sheet.
// The cells remain as formula cells with empty deps (eval to #REF!).
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// Construction and edge cases
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_with_capacity_is_functional_equivalent_of_new() {
    let mut g1 = DependencyGraph::new();
    let mut g2 = DependencyGraph::with_capacity(100);
    let mut g3 = DependencyGraph::with_capacity_full(100, 200);

    let a = cid(1);
    let b = cid(2);

    for g in [&mut g1, &mut g2, &mut g3] {
        g.set_precedents(&a, vec![DepTarget::Cell(b)]);
        g.mark_volatile(&a);
    }

    for g in [&g1, &g2, &g3] {
        assert_eq!(g.get_precedents(&a), &[DepTarget::Cell(b)]);
        assert!(g.has_dependent(&b, &a));
        assert!(g.is_volatile(&a));
        assert_eq!(g.formula_cell_count(), 1);
        assert_eq!(g.edge_count(), 1);
    }
}

#[test]
fn test_empty_graph() {
    let graph = DependencyGraph::new();
    assert_eq!(graph.formula_cell_count(), 0);
    assert_eq!(graph.edge_count(), 0);
    assert_eq!(graph.max_depth(), 0);
    assert_eq!(graph.volatile_count(), 0);
    let nr = null_resolver();
    assert!(graph.detect_cycles(&nr).into_value().is_empty());
    assert!(
        graph
            .evaluation_levels(&nr)
            .unwrap()
            .into_value()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .is_empty()
    );
    assert!(graph.affected_cells(&[], &nr).into_value().is_empty());
}

#[test]
fn test_single_cell_no_deps() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);

    // A has a formula but depends on nothing (e.g., =42)
    graph.set_precedents(&a, vec![]);
    assert_eq!(graph.formula_cell_count(), 1);
    assert_eq!(graph.edge_count(), 0);
    assert!(graph.has_cell(&a));
}

#[test]
fn test_default_trait() {
    let graph = DependencyGraph::default();
    assert_eq!(graph.formula_cell_count(), 0);
}

#[test]
fn test_has_cell_for_pure_data_cell() {
    // B is a pure data cell — no formula, but A depends on it.
    // has_cell(B) should return true because B appears in dependents.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    assert!(graph.has_cell(&b), "B is in dependents map");
    assert!(graph.has_cell(&a), "A is in precedents map");
    assert!(!graph.has_cell(&cid(999)), "unknown cell");
}

#[test]
fn test_has_cell_volatile_only() {
    // A cell marked volatile but with no edges should still register
    // as existing in the graph.
    let mut graph = DependencyGraph::new();
    let v = cid(42);
    graph.mark_volatile(&v);
    assert!(graph.has_cell(&v), "volatile-only cell should be found");
}

// ─────────────────────────────────────────────────────────────────
// Range index rebuild when removing one of multiple ranges on a sheet
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_remove_cell_rebuilds_range_index_for_remaining_ranges() {
    // Two formula cells depend on DIFFERENT ranges on the same sheet.
    // Removing one cell should remove its range but rebuild the tree
    // with the other range still intact (hitting remove_from_range_index's
    // else branch where rects is non-empty).
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f1 = cid(1);
    let f2 = cid(2);

    let r1 = RangePos::new(sheet, 0, 0, 50, 0);
    let r2 = RangePos::new(sheet, 100, 0, 200, 0);

    graph.set_precedents(&f1, vec![DepTarget::Range(r1, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(r2, RangeAccess::Aggregate)]);

    assert_eq!(graph.range_dep_count(), 2);
    assert!(graph.has_range_index_for_sheet(&sheet));

    // Remove f1 — r1 should be gone, r2 should remain, index rebuilt
    graph.remove_cell(&f1);

    assert_eq!(graph.range_dep_count(), 1);
    assert!(
        graph.has_range_index_for_sheet(&sheet),
        "index should be rebuilt, not removed"
    );
    // r2's range should still work for queries
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 150, 0)])
            .contains(&f2)
    );
    assert!(
        graph
            .find_by_range_containment(&[(sheet, 25, 0)])
            .is_empty()
    );
}

// ─────────────────────────────────────────────────────────────────
// Range expansion threshold boundary tests
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// P2: Cached edge metrics must stay consistent after mutations
// ─────────────────────────────────────────────────────────────────

/// After `remove_cell(a)` where `b -> a`, the cached `dep_edge_stats().total_edges`
/// must match the ground-truth `edge_count()`.
///
/// Bug: `remove_cell` cleans up reverse edges from other cells' precedent lists
/// (line 399) without decrementing `total_edges`, so the cached counter drifts.
#[test]
fn test_dep_edge_stats_consistent_after_remove_cell() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    // b depends on a
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    assert_eq!(graph.edge_count(), 1);
    assert_eq!(graph.dep_edge_stats().total_edges, 1);

    // Remove a — b's precedent list should be cleaned up
    graph.remove_cell(&a);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(
        actual_edges, 0,
        "edge_count() should be 0 after removing the target cell"
    );
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges})"
    );
}

/// Same drift test for `remove_cell` with fan-in: multiple cells depend on
/// the removed cell, each losing an edge from their precedent list.
#[test]
fn test_dep_edge_stats_consistent_after_remove_cell_fan_in() {
    let mut graph = DependencyGraph::new();
    let a = cid(1); // target to be removed
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // b, c, d all depend on a
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&d, vec![DepTarget::Cell(a)]);
    assert_eq!(graph.edge_count(), 3);
    assert_eq!(graph.dep_edge_stats().total_edges, 3);

    graph.remove_cell(&a);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(actual_edges, 0);
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges}) after removing cell with 3 dependents"
    );
}

/// Cached metrics must stay consistent after `bulk_remove_cells`.
#[test]
fn test_dep_edge_stats_consistent_after_bulk_remove() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // b -> a, c -> a
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);
    graph.set_precedents(&c, vec![DepTarget::Cell(a)]);
    assert_eq!(graph.dep_edge_stats().total_edges, 2);

    graph.bulk_remove_cells(&[a]);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges}) after bulk_remove_cells"
    );
}

/// Cached metrics must stay consistent after `cleanup_sheet_ranges`.
#[test]
fn test_dep_edge_stats_consistent_after_cleanup_sheet_ranges() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let f = cid(1);
    let range = RangePos::new(sheet, 0, 0, 999, 0);

    graph.set_precedents(&f, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    assert_eq!(graph.dep_edge_stats().total_edges, 1);

    graph.cleanup_sheet_ranges(&sheet);

    let actual_edges = graph.edge_count();
    let cached_edges = graph.dep_edge_stats().total_edges;
    assert_eq!(
        cached_edges, actual_edges as u64,
        "dep_edge_stats().total_edges ({cached_edges}) drifted from edge_count() ({actual_edges}) after cleanup_sheet_ranges"
    );
}

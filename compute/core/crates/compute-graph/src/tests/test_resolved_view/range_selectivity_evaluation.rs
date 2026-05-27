use super::*;

// ═════════════════════════════════════════════════════════════════════════════
// Range selectivity: barrier_topo / evaluation_levels path tests
//
// These tests exercise build_barrier_graph (via evaluation_levels), which is
// a separate code path from subset_levels. Both must be selectivity-aware.
// ═════════════════════════════════════════════════════════════════════════════

/// INDEX(A:A, 3) in B1, A3 = B1*2 → no false cycle via evaluation_levels.
/// Exercises build_barrier_graph's selective partition path.
#[test]
fn test_barrier_topo_selective_index_no_false_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);
    let a4 = cid(4);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (a4, sheet, 3, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Selective INDEX should not produce false cycle via evaluation_levels: {:?}",
        result.err()
    );

    let levels = result.unwrap().value;
    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
}

/// SUM(A:A) in B1, A3 = B1*2 → real cycle detected via evaluation_levels.
/// Exercises build_barrier_graph's aggregate partition path.
#[test]
fn test_barrier_topo_aggregate_sum_detects_real_cycle() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let a1 = cid(1);
    let a3 = cid(3);

    let range_a = RangePos::new(sheet, 0, 0, 3, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (b1, sheet, 0, 1),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_err(),
        "Aggregate SUM should detect real cycle via evaluation_levels"
    );
}

/// Mixed: B1 = INDEX(A:A, 3) selective, C1 = SUM(A:A) aggregate, A3 = B1*2.
/// Exercises build_barrier_graph with both paths on the same range.
#[test]
fn test_barrier_topo_mixed_access_same_range() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);
    let b1 = cid(10);
    let c1 = cid(20);
    let a1 = cid(1);
    let a3 = cid(3);
    let a5 = cid(5);

    let range_a = RangePos::new(sheet, 0, 0, 4, 0);

    graph.set_precedents(&b1, vec![DepTarget::Range(range_a, RangeAccess::Selective)]);
    graph.set_precedents(&c1, vec![DepTarget::Range(range_a, RangeAccess::Aggregate)]);
    graph.set_precedents(&a3, vec![DepTarget::Cell(b1)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a3, sheet, 2, 0),
        (a5, sheet, 4, 0),
        (b1, sheet, 0, 1),
        (c1, sheet, 0, 2),
    ]);

    // No cycle: aggregate barrier includes A3 → C1, but A3's back-edge is
    // to B1 (selective). Order: data → B1 → A3 → C1.
    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "Mixed access should not produce false cycle via evaluation_levels: {:?}",
        result.err()
    );

    let levels = result.unwrap().value;
    let level_of =
        |cell: CellId| -> usize { levels.iter().position(|l| l.contains(&cell)).unwrap() };
    assert!(level_of(b1) < level_of(a3), "B1 before A3");
    assert!(level_of(a3) < level_of(c1), "A3 before C1");
}

/// Two selective formulas F1, F2 on the same range.
/// Contained cell X has a back-edge to F1 only.
///
/// With hybrid deferral, selective deps get no range barriers. F2 may evaluate
/// before X at graph level. The recalc driver's fixup pass corrects this.
/// At graph level, we verify: no false cycle, cell-to-cell ordering (F1 before X),
/// all cells present.
#[test]
fn test_selective_barrier_per_formula() {
    let mut graph = DependencyGraph::new();
    let sheet = sid(1);

    let x = cid(10); // A1 — has back-edge to F1
    let y = cid(11); // A2
    let z = cid(12); // A3

    let f1 = cid(20); // B1 — selective dep on A1:A3
    let f2 = cid(21); // B2 — selective dep on A1:A3

    let range = RangePos::new(sheet, 0, 0, 2, 0); // A1:A3

    graph.set_precedents(&f1, vec![DepTarget::Range(range, RangeAccess::Selective)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(range, RangeAccess::Selective)]);
    graph.set_precedents(&x, vec![DepTarget::Cell(f1)]);

    let resolver = make_resolver(vec![
        (x, sheet, 0, 0),
        (y, sheet, 1, 0),
        (z, sheet, 2, 0),
        (f1, sheet, 0, 1),
        (f2, sheet, 1, 1),
    ]);

    let result = graph.evaluation_levels(&resolver);
    assert!(
        result.is_ok(),
        "No cycle expected with hybrid deferral — selective deps get no barriers"
    );
    let levels = result.unwrap().into_value();
    let all_cells: Vec<CellId> = levels.iter().flatten().copied().collect();

    // Cell-to-cell ordering preserved: F1 before X (X depends on F1)
    let pos_f1 = all_cells.iter().position(|c| *c == f1).unwrap();
    let pos_x = all_cells.iter().position(|c| *c == x).unwrap();
    assert!(pos_f1 < pos_x, "F1 before X (cell-to-cell edge)");

    // Formula cells and their cell-to-cell deps present
    assert!(all_cells.contains(&f1), "F1 in evaluation order");
    assert!(all_cells.contains(&f2), "F2 in evaluation order");
    assert!(
        all_cells.contains(&x),
        "X in evaluation order (depends on F1)"
    );
}

use super::*;

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: affected_cells
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_affected_cells_basic() {
    // Chain: A→B→C (A depends on B, B depends on C)
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let sheet = sid(1);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (b, sheet, 1, 0), (c, sheet, 2, 0)]);
    // Change C => A, B, C all affected
    let result = graph.affected_cells(&[c], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(affected.contains(&a), "A should be affected");
    assert!(affected.contains(&b), "B should be affected");
    assert!(affected.contains(&c), "C should be affected");
    assert_eq!(result.completeness, AnalysisCompleteness::Exact);
}

#[test]
fn test_affected_cells_with_range() {
    // SUM (cid 10) depends on range A1:A3 (rows 0-2, col 0).
    // Cells A1=cid(1), A2=cid(2), A3=cid(3) are inside the range.
    // Changing A2 should dirty SUM.
    let mut graph = DependencyGraph::new();
    let a1 = cid(1);
    let a2 = cid(2);
    let a3 = cid(3);
    let sum = cid(10);
    let sheet = sid(1);

    let range = RangePos::new(sheet, 0, 0, 2, 0); // A1:A3
    graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (a2, sheet, 1, 0),
        (a3, sheet, 2, 0),
        (sum, sheet, 0, 1),
    ]);
    let result = graph.affected_cells(&[a2], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(
        affected.contains(&sum),
        "SUM should be dirtied by A2 change"
    );
    assert!(affected.contains(&a2), "A2 should be in affected set");
    assert_eq!(result.completeness, AnalysisCompleteness::Exact);
}

#[test]
fn test_affected_cells_transitive_range() {
    // Transitive range chain:
    //   A1 is in Range1 => formula F1 depends on Range1
    //   F1 is in Range2 => formula F2 depends on Range2
    // Changing A1 should dirty both F1 and F2.
    let mut graph = DependencyGraph::new();
    let a1 = cid(1);
    let f1 = cid(10);
    let f2 = cid(20);
    let sheet = sid(1);

    let range1 = RangePos::new(sheet, 0, 0, 0, 0); // just A1
    let range2 = RangePos::new(sheet, 1, 0, 1, 0); // just F1's position

    graph.set_precedents(&f1, vec![DepTarget::Range(range1, RangeAccess::Aggregate)]);
    graph.set_precedents(&f2, vec![DepTarget::Range(range2, RangeAccess::Aggregate)]);

    let resolver = make_resolver(vec![
        (a1, sheet, 0, 0),
        (f1, sheet, 1, 0),
        (f2, sheet, 2, 0),
    ]);
    let result = graph.affected_cells(&[a1], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(affected.contains(&f1), "F1 should be dirtied transitively");
    assert!(
        affected.contains(&f2),
        "F2 should be dirtied transitively through range chain"
    );
}

#[test]
fn test_affected_cells_volatile() {
    // Volatile cell is always included even when not in changed set.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let vol = cid(99);
    let sheet = sid(1);

    graph.mark_volatile(&vol);

    let resolver = make_resolver(vec![(a, sheet, 0, 0), (vol, sheet, 5, 0)]);
    let result = graph.affected_cells(&[a], &resolver);
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(
        affected.contains(&vol),
        "Volatile cell should always be included"
    );
    assert!(affected.contains(&a), "Changed cell should be included");
}

#[test]
fn test_affected_cells_incomplete_position() {
    // An unpositioned cell triggers Incomplete completeness.
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let sheet = sid(1);

    // B depends on a range, but B has no position in the resolver
    let range = RangePos::new(sheet, 0, 0, 0, 0);
    graph.set_precedents(&b, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);

    // Only provide position for A, not for B
    let resolver = make_resolver(vec![(a, sheet, 0, 0)]);
    let result = graph.affected_cells(&[a], &resolver);
    // B should be in the dirty set because the range dep covers A's position
    let affected: FxHashSet<CellId> = result.value.iter().copied().collect();
    assert!(affected.contains(&b), "B should be dirtied via range");
    // Completeness should be Incomplete because B has no position for topo sort
    assert_eq!(result.completeness, AnalysisCompleteness::Incomplete);
}

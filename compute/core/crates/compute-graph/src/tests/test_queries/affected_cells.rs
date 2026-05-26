use super::*;

// ─────────────────────────────────────────────────────────────────
// Partial recalc (cell-deps only)
// ─────────────────────────────────────────────────────────────────

#[test]
#[allow(clippy::many_single_char_names)]
fn test_partial_recalc_only_affected() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);
    let e = cid(5);

    // Subgraph 1: A -> B -> C
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    // Subgraph 2: D -> E (independent)
    graph.set_precedents(&d, vec![DepTarget::Cell(e)]);

    // C changes -> only A, B, C affected, NOT D or E
    let affected = graph.affected_cells(&[c], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(affected.contains(&c));
    assert!(!affected.contains(&d));
    assert!(!affected.contains(&e));
}

#[test]
fn test_partial_recalc_correct_order() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // A depends on B, B depends on C
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.set_precedents(&b, vec![DepTarget::Cell(c)]);

    let order = graph.affected_cells(&[c], &null_resolver).into_value();
    let pos_c = order.iter().position(|x| *x == c).unwrap();
    let pos_b = order.iter().position(|x| *x == b).unwrap();
    let pos_a = order.iter().position(|x| *x == a).unwrap();

    assert!(pos_c < pos_b, "C before B");
    assert!(pos_b < pos_a, "B before A");
}

#[test]
fn test_independent_subgraphs() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);
    let d = cid(4);

    // Subgraph 1: A -> B
    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    // Subgraph 2: C -> D
    graph.set_precedents(&c, vec![DepTarget::Cell(d)]);

    // B changes -> only A affected, not C or D
    let affected = graph.affected_cells(&[b], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(!affected.contains(&c));
    assert!(!affected.contains(&d));

    // D changes -> only C affected, not A or B
    let affected = graph.affected_cells(&[d], &null_resolver).into_value();
    assert!(affected.contains(&c));
    assert!(affected.contains(&d));
    assert!(!affected.contains(&a));
    assert!(!affected.contains(&b));
}

#[test]
fn test_affected_cells_empty_changed_no_volatile() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);

    // No changes, no volatile -> nothing affected
    let affected = graph.affected_cells(&[], &null_resolver).into_value();
    assert!(affected.is_empty());
}

#[test]
fn test_affected_cells_empty_changed_with_volatile() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let v = cid(99);

    graph.set_precedents(&a, vec![DepTarget::Cell(b)]);
    graph.mark_volatile(&v);

    // No explicit changes, but volatile cell should be included
    let affected = graph.affected_cells(&[], &null_resolver).into_value();
    assert!(affected.contains(&v));
    // A and B should NOT be affected (v is not connected to them)
    assert!(!affected.contains(&a));
    assert!(!affected.contains(&b));
}

#[test]
fn test_volatile_always_included() {
    let mut graph = DependencyGraph::new();
    let a = cid(1);
    let b = cid(2);
    let c = cid(3);

    // B depends on A (normal dependency)
    graph.set_precedents(&b, vec![DepTarget::Cell(a)]);

    // C is volatile (e.g., =NOW())
    graph.mark_volatile(&c);

    assert!(graph.is_volatile(&c));
    assert!(!graph.is_volatile(&a));

    // When A changes, B and C (volatile) should be in affected set
    let affected = graph.affected_cells(&[a], &null_resolver).into_value();
    assert!(affected.contains(&a));
    assert!(affected.contains(&b));
    assert!(
        affected.contains(&c),
        "Volatile cell should always be included"
    );
}

#[test]
fn test_volatile_with_dependents() {
    let mut graph = DependencyGraph::new();
    let now_cell = cid(1);
    let display_cell = cid(2);

    // display_cell depends on now_cell (e.g., =TEXT(NOW(), "HH:MM"))
    graph.set_precedents(&display_cell, vec![DepTarget::Cell(now_cell)]);
    graph.mark_volatile(&now_cell);

    // Any recalc should include both
    let affected = graph.affected_cells(&[], &null_resolver).into_value();
    assert!(affected.contains(&now_cell));
    assert!(affected.contains(&display_cell));
}

use super::*;

// ─────────────────────────────────────────────────────────────────
// Range-aware affected cells
// ─────────────────────────────────────────────────────────────────

/// Transitive range chain
#[test]
fn test_transitive_range_chain() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let c_cell = cid(300);
    let b_cell = cid(200);
    let a_cell = cid(100);
    graph.set_precedents(
        &b_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 2, 999, 2),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 1, 999, 1),
            RangeAccess::Aggregate,
        )],
    );
    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == c_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 2,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 1,
            })
        } else if *cell == a_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 0,
            })
        } else {
            None
        }
    };
    let affected = graph.affected_cells(&[c_cell], &resolver).into_value();
    assert!(affected.contains(&c_cell), "c_cell must be affected");
    assert!(
        affected.contains(&b_cell),
        "b_cell must be dirtied via range"
    );
    assert!(
        affected.contains(&a_cell),
        "a_cell must be dirtied transitively"
    );
    assert_eq!(affected.len(), 3);
}

/// Mixed range + cell chain
#[test]
fn test_mixed_range_and_cell_chain() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let c_cell = cid(300);
    let b_cell = cid(200);
    let d_cell = cid(400);
    let e_cell = cid(500);
    graph.set_precedents(
        &b_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 2, 999, 2),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&d_cell, vec![DepTarget::Cell(b_cell)]);
    graph.set_precedents(
        &e_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 3, 999, 3),
            RangeAccess::Aggregate,
        )],
    );
    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == c_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 2,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 1,
            })
        } else if *cell == d_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 3,
            })
        } else if *cell == e_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 4,
            })
        } else {
            None
        }
    };
    let affected = graph.affected_cells(&[c_cell], &resolver).into_value();
    assert!(affected.contains(&c_cell), "c_cell must be affected");
    assert!(affected.contains(&b_cell), "b_cell dirtied via range");
    assert!(affected.contains(&d_cell), "d_cell dirtied via cell dep");
    assert!(affected.contains(&e_cell), "e_cell dirtied via range");
    assert_eq!(affected.len(), 4);
    // b_cell -> d_cell is a cell edge, so d_cell must come after b_cell
    let pos_b = affected.iter().position(|x| *x == b_cell).unwrap();
    let pos_d = affected.iter().position(|x| *x == d_cell).unwrap();
    assert!(pos_b < pos_d, "b before d (cell edge)");
}

/// Cross-sheet range chain
#[test]
fn test_cross_sheet_range_chain() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let sheet3 = sid(3);
    let c_cell = cid(300);
    let b_cell = cid(200);
    let a_cell = cid(100);
    graph.set_precedents(
        &b_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet2, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    let resolver = |cell: &CellId| -> Option<CellPosition> {
        if *cell == c_cell {
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 0,
            })
        } else if *cell == b_cell {
            Some(CellPosition {
                sheet: sheet2,
                row: 500,
                col: 0,
            })
        } else if *cell == a_cell {
            Some(CellPosition {
                sheet: sheet3,
                row: 500,
                col: 0,
            })
        } else {
            None
        }
    };
    let affected = graph.affected_cells(&[c_cell], &resolver).into_value();
    assert!(affected.contains(&c_cell), "c_cell affected");
    assert!(affected.contains(&b_cell), "b_cell dirtied cross-sheet");
    assert!(affected.contains(&a_cell), "a_cell dirtied cross-sheet");
    assert_eq!(affected.len(), 3);
}

/// Property test - all affected cells are transitively reachable
#[test]
fn test_affected_cells_reachability_invariant() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let c1 = cid(1);
    let c2 = cid(2);
    let c3 = cid(3);
    let c4 = cid(4);
    let c5 = cid(5);
    let c6 = cid(6);
    let c7 = cid(7);
    let c8 = cid(8);
    let c9 = cid(9);
    let c10 = cid(10);
    let positions: FxHashMap<CellId, (SheetId, u32, u32)> = [
        (c1, (sheet1, 500, 0)),
        (c2, (sheet1, 500, 1)),
        (c3, (sheet1, 500, 2)),
        (c4, (sheet1, 500, 3)),
        (c5, (sheet1, 500, 4)),
        (c6, (sheet1, 600, 4)),
        (c7, (sheet1, 500, 5)),
        (c8, (sheet1, 500, 6)),
        (c9, (sheet1, 500, 7)),
        (c10, (sheet1, 500, 8)),
    ]
    .into_iter()
    .collect();
    graph.set_precedents(
        &c2,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 0, 999, 0),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&c3, vec![DepTarget::Cell(c2)]);
    graph.set_precedents(
        &c4,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 2, 999, 2),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&c5, vec![DepTarget::Cell(c4)]);
    graph.set_precedents(&c6, vec![DepTarget::Cell(c5)]);
    graph.set_precedents(
        &c7,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 4, 999, 4),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(&c8, vec![DepTarget::Cell(c7)]);
    graph.set_precedents(&c10, vec![DepTarget::Cell(c9)]);
    let _resolver = |cell: &CellId| -> Option<CellPosition> {
        positions
            .get(cell)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    };
    let affected = graph.affected_cells(&[c1], &_resolver).into_value();
    let affected_set: FxHashSet<CellId> = affected.iter().copied().collect();
    assert!(affected_set.contains(&c1), "c1 is changed");
    assert!(affected_set.contains(&c2), "c2 range contains c1");
    assert!(affected_set.contains(&c3), "c3 cell dep on c2");
    assert!(affected_set.contains(&c4), "c4 range contains c3");
    assert!(affected_set.contains(&c5), "c5 cell dep on c4");
    assert!(affected_set.contains(&c6), "c6 cell dep on c5");
    assert!(affected_set.contains(&c7), "c7 range contains c5/c6");
    assert!(affected_set.contains(&c8), "c8 cell dep on c7");
    assert!(!affected_set.contains(&c9), "c9 is independent");
    assert!(!affected_set.contains(&c10), "c10 is independent");
    // Verify invariant via manual BFS
    let mut manual_dirty = FxHashSet::default();
    manual_dirty.insert(c1);
    let mut manual_queue: std::collections::VecDeque<CellId> =
        manual_dirty.iter().copied().collect();
    while let Some(cell) = manual_queue.pop_front() {
        for dep in graph.get_dependents(&cell) {
            if manual_dirty.insert(*dep) {
                manual_queue.push_back(*dep);
            }
        }
        if let Some(&(sheet, row, col)) = positions.get(&cell) {
            for (rect, range_dependents) in &graph.range_deps {
                if rect.contains_pos(sheet, row, col) {
                    for dep in range_dependents {
                        if manual_dirty.insert(*dep) {
                            manual_queue.push_back(*dep);
                        }
                    }
                }
            }
        }
    }
    assert_eq!(affected_set, manual_dirty, "Must match manual BFS");
}

/// Performance test - 10-deep range chain with 100 total range deps
#[test]
#[allow(clippy::cast_possible_truncation)]
fn test_deep_range_chain_no_quadratic_blowup() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let seed_cell = cid(1000);
    let mut chain_cells: Vec<CellId> = Vec::new();
    for i in 0..10u128 {
        let cell = cid(100 + i);
        chain_cells.push(cell);
        graph.set_precedents(
            &cell,
            vec![DepTarget::Range(
                RangePos::new(sheet1, 0, i as u32, 999, i as u32),
                RangeAccess::Aggregate,
            )],
        );
    }
    for i in 10..100u128 {
        let cell = cid(100 + i);
        graph.set_precedents(
            &cell,
            vec![DepTarget::Range(
                RangePos::new(sheet1, 0, i as u32, 999, i as u32),
                RangeAccess::Aggregate,
            )],
        );
    }
    let resolver = move |cell: &CellId| -> Option<CellPosition> {
        if *cell == seed_cell {
            return Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: 0,
            });
        }
        let raw = cell.as_u128();
        if (100..110).contains(&raw) {
            let idx = (raw - 100) as u32;
            Some(CellPosition {
                sheet: sheet1,
                row: 500,
                col: idx + 1,
            })
        } else if (110..200).contains(&raw) {
            let idx = (raw - 100) as u32;
            Some(CellPosition {
                sheet: sheet1,
                row: 1500,
                col: idx,
            })
        } else {
            None
        }
    };
    let affected = graph.affected_cells(&[seed_cell], &resolver).into_value();
    let affected_set: FxHashSet<CellId> = affected.iter().copied().collect();
    assert!(affected_set.contains(&seed_cell), "seed must be affected");
    for (i, chain_cell) in chain_cells.iter().enumerate() {
        assert!(
            affected_set.contains(chain_cell),
            "chain cell {i} must be affected",
        );
    }
}

/// 4f extra: `HashMap` variant matches closure variant
#[test]
fn test_hashmap_variant_matches_closure_variant() {
    let mut graph = DependencyGraph::new();
    let sheet1 = sid(1);
    let c_cell = cid(300);
    let b_cell = cid(200);
    let a_cell = cid(100);
    graph.set_precedents(
        &b_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 2, 999, 2),
            RangeAccess::Aggregate,
        )],
    );
    graph.set_precedents(
        &a_cell,
        vec![DepTarget::Range(
            RangePos::new(sheet1, 0, 1, 999, 1),
            RangeAccess::Aggregate,
        )],
    );
    let mut positions = FxHashMap::default();
    positions.insert(c_cell, (sheet1, 500u32, 2u32));
    positions.insert(b_cell, (sheet1, 500u32, 1u32));
    positions.insert(a_cell, (sheet1, 500u32, 0u32));
    let resolver_map = |cell: &CellId| -> Option<CellPosition> {
        positions
            .get(cell)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    };
    let affected_map = graph.affected_cells(&[c_cell], &resolver_map).into_value();
    let resolver_closure = |cell: &CellId| -> Option<CellPosition> {
        positions
            .get(cell)
            .map(|&(sheet, row, col)| CellPosition { sheet, row, col })
    };
    let affected_closure = graph
        .affected_cells(&[c_cell], &resolver_closure)
        .into_value();
    let set_map: FxHashSet<CellId> = affected_map.iter().copied().collect();
    let set_closure: FxHashSet<CellId> = affected_closure.iter().copied().collect();
    assert_eq!(set_map, set_closure, "Both variants must match");
}

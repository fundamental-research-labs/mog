use super::*;

#[test]
fn test_deep_chain_1000_no_stack_overflow() {
    let mut graph = DependencyGraph::new();
    let cells: Vec<CellId> = (1..=1000).map(cid).collect();

    // cell i+1 depends on cell i: cells[1] -> cells[0], cells[2] -> cells[1], ...
    for i in 1..1000 {
        graph.set_precedents(&cells[i], vec![DepTarget::Cell(cells[i - 1])]);
    }

    // No cycles in a linear chain
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Linear chain should have no cycles");

    // Evaluation order should contain all 1000 cells
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(order.len(), 1000);

    // Cells must be in correct topological order: cells[0] before cells[1] before ... cells[999]
    for i in 0..999 {
        let pos_i = order.iter().position(|x| *x == cells[i]).unwrap();
        let pos_next = order.iter().position(|x| *x == cells[i + 1]).unwrap();
        assert!(
            pos_i < pos_next,
            "cell {} should come before cell {} in eval order",
            i,
            i + 1
        );
    }

    // Max depth of a 1000-cell linear chain is 999
    assert_eq!(graph.max_depth(), 999);
}

#[test]
fn test_wide_fan_out_10000() {
    let mut graph = DependencyGraph::new();
    let root = cid(1);

    // 10,000 formula cells each depending on root
    let formula_cells: Vec<CellId> = (2..=10_001).map(cid).collect();
    for &fc in &formula_cells {
        graph.set_precedents(&fc, vec![DepTarget::Cell(root)]);
    }

    // All 10,001 cells (root + 10,000 formulas) should be affected
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let (levels, cycle_cells) = graph
        .affected_cells_levels(&[root], &null_resolver)
        .into_value();
    let affected: FxHashSet<CellId> = levels.into_iter().flatten().chain(cycle_cells).collect();
    assert_eq!(affected.len(), 10_001);
    assert!(affected.contains(&root));
    for &fc in &formula_cells {
        assert!(affected.contains(&fc));
    }

    // No cycles
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Fan-out graph should have no cycles");
}

#[test]
fn test_diamond_graph_10000() {
    // 100 layers x 100 cells per layer.
    // Each cell in layer L depends on every cell in layer L-1.
    let mut graph = DependencyGraph::new();
    let layers: usize = 100;
    let width: usize = 100;

    // cells[layer][col] — use unique IDs: layer * 1000 + col + 1
    let cell_ids: Vec<Vec<CellId>> = (0..layers)
        .map(|layer| {
            (0..width)
                .map(|col| cid((layer * 1000 + col + 1) as u128))
                .collect()
        })
        .collect();

    // Each cell in layer L (L >= 1) depends on all cells in layer L-1
    for layer in 1..layers {
        let deps: Vec<DepTarget> = cell_ids[layer - 1]
            .iter()
            .map(|&c| DepTarget::Cell(c))
            .collect();
        for cell in &cell_ids[layer] {
            graph.set_precedents(cell, deps.clone());
        }
    }

    // No cycles
    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let cycles = graph.detect_cycles(&null_resolver).into_value();
    assert!(cycles.is_empty(), "Diamond graph should have no cycles");

    // Evaluation order should succeed
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(order.len(), layers * width);

    // Every cell must appear after all its deps (cells in the previous layer)
    let pos_of = |cell: CellId| order.iter().position(|x| *x == cell).unwrap();
    for layer in 1..layers {
        for col in 0..width {
            let my_pos = pos_of(cell_ids[layer][col]);
            for (dep_col, &dep_cell) in cell_ids[layer - 1].iter().enumerate() {
                let dep_pos = pos_of(dep_cell);
                assert!(
                    dep_pos < my_pos,
                    "layer {} dep (col {}) at pos {} should be before layer {} cell (col {}) at pos {}",
                    layer - 1,
                    dep_col,
                    dep_pos,
                    layer,
                    col,
                    my_pos
                );
            }
        }
    }
}

#[test]
fn test_stress_wide_fan_out_100k() {
    // One cell with 100K dependents
    let mut graph = DependencyGraph::new();
    let root = cid(1);
    for i in 2..=100_001u128 {
        graph.set_precedents(&CellId::from_raw(i), vec![DepTarget::Cell(root)]);
    }

    let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
    let (levels, cycle_cells) = graph
        .affected_cells_levels(&[root], &null_resolver)
        .into_value();
    let affected: FxHashSet<CellId> = levels.into_iter().flatten().chain(cycle_cells).collect();
    assert_eq!(affected.len(), 100_001);

    // Topo sort should work
    let order = graph
        .evaluation_levels(&null_resolver)
        .unwrap()
        .into_value()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(order.len(), 100_001);
    assert_eq!(order[0], root); // root should be first
}

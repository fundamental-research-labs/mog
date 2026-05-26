use proptest::prelude::*;

use cell_types::CellId;
use compute_graph::positions::CellPosition;
use compute_graph::{DepTarget, DependencyGraph, RangeAccess};

proptest! {
    #[test]
    fn topo_sort_respects_deps(
        edges in prop::collection::vec((0u64..50, 0u64..50), 0..100)
    ) {
        let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
        let mut graph = DependencyGraph::new();

        // set_precedents replaces all deps for a cell, so we must accumulate
        // deps per target cell first, then call set_precedents once per cell.
        // Deduplicate deps per cell to avoid inflating in-degree counts.
        let mut deps_per_cell: std::collections::HashMap<u64, std::collections::HashSet<u64>> =
            std::collections::HashMap::new();
        for &(from, to) in &edges {
            if from != to {
                deps_per_cell.entry(to).or_default().insert(from);
            }
        }

        for (&to, froms) in &deps_per_cell {
            let to_id = CellId::from_raw(u128::from(to));
            let dep_targets: Vec<DepTarget> = froms
                .iter()
                .map(|&f| DepTarget::Cell(CellId::from_raw(u128::from(f))))
                .collect();
            graph.set_precedents(&to_id, dep_targets);
        }

        if let Ok(levels) = graph.evaluation_levels(&null_resolver) {
            let order: Vec<CellId> = levels.into_value().into_iter().flatten().collect();
            let pos: std::collections::HashMap<_, _> =
                order.iter().enumerate().map(|(i, id)| (*id, i)).collect();
            for (&to, froms) in &deps_per_cell {
                let to_id = CellId::from_raw(u128::from(to));
                for &from in froms {
                    let from_id = CellId::from_raw(u128::from(from));
                    if let (Some(&f), Some(&t)) = (pos.get(&from_id), pos.get(&to_id)) {
                        prop_assert!(
                            f < t,
                            "Dep {:?} at pos {} should appear before {:?} at pos {}",
                            from_id, f, to_id, t
                        );
                    }
                }
            }
        }
        // Err(_) => Cycle detected — acceptable for random graphs
    }

    #[test]
    fn acyclic_graph_succeeds(
        edges in prop::collection::vec((0u64..50, 0u64..50), 0..100)
    ) {
        let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
        let mut graph = DependencyGraph::new();

        // Only add edges from lower to higher IDs to guarantee acyclicity.
        // Deduplicate deps per cell to avoid inflating in-degree counts.
        let mut deps_per_cell: std::collections::HashMap<u64, std::collections::HashSet<u64>> =
            std::collections::HashMap::new();
        for &(from, to) in &edges {
            if from < to {
                deps_per_cell.entry(to).or_default().insert(from);
            }
        }

        for (&to, froms) in &deps_per_cell {
            let to_id = CellId::from_raw(u128::from(to));
            let dep_targets: Vec<DepTarget> = froms
                .iter()
                .map(|&f| DepTarget::Cell(CellId::from_raw(u128::from(f))))
                .collect();
            graph.set_precedents(&to_id, dep_targets);
        }

        prop_assert!(
            graph.evaluation_levels(&null_resolver).is_ok(),
            "Acyclic graph should never fail"
        );
    }

    #[test]
    fn self_loop_is_cycle(id in 0u64..1000) {
        let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
        let mut graph = DependencyGraph::new();
        let cell = CellId::from_raw(u128::from(id));
        graph.set_precedents(&cell, vec![DepTarget::Cell(cell)]);
        prop_assert!(
            graph.evaluation_levels(&null_resolver).is_err(),
            "Self-loop should be detected as cycle"
        );
    }

    /// Property: affected cells from range deps always include the direct
    /// range dependents when a cell inside the range changes.
    #[test]
    fn range_dep_affected_includes_formula(
        n_formulas in 1u64..20,
        changed_row in 0u32..100,
        changed_col in 0u32..5,
    ) {
        let sheet = cell_types::SheetId::from_raw(1);
        let mut graph = DependencyGraph::new();

        // Each formula depends on a range [0..99, 0..5] on the same sheet.
        let range = cell_types::RangePos::new(sheet, 0, 0, 99, 5);
        let formula_ids: Vec<CellId> = (1..=n_formulas)
            .map(|i| CellId::from_raw(1000 + u128::from(i)))
            .collect();
        for fid in &formula_ids {
            graph.set_precedents(fid, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
        }

        // A data cell inside the range changes.
        let data_cell = CellId::from_raw(42);
        let resolve = move |cell: &CellId| -> Option<CellPosition> {
            if *cell == data_cell {
                Some(CellPosition { sheet, row: changed_row, col: changed_col })
            } else {
                None
            }
        };

        let affected = graph.affected_cells(&[data_cell], &resolve).into_value();

        // All formula cells should be affected (they depend on a range
        // containing the changed cell's position).
        for fid in &formula_ids {
            prop_assert!(
                affected.contains(fid),
                "Formula {:?} should be affected when cell at ({}, {}) changes inside its range",
                fid, changed_row, changed_col,
            );
        }
    }
}

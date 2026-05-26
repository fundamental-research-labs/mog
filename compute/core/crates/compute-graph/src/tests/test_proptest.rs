use super::*;
use crate::positions::CellPosition;
use proptest::prelude::*;
use rustc_hash::FxHashSet;

// ─────────────────────────────────────────────────────────────────
// Strategies
// ─────────────────────────────────────────────────────────────────

fn cell_id_strategy() -> impl Strategy<Value = CellId> {
    (1..=5000u128).prop_map(CellId::from_raw)
}

fn dep_list_strategy() -> impl Strategy<Value = Vec<DepTarget>> {
    prop::collection::vec(cell_id_strategy().prop_map(DepTarget::Cell), 0..=10)
}

/// Generate a random graph as a Vec of (cell, deps) pairs.
/// Each formula cell gets 0..5 cell-to-cell dependencies.
fn sheet_id_strategy() -> impl Strategy<Value = SheetId> {
    (1..=10u128).prop_map(SheetId::from_raw)
}

fn range_pos_strategy() -> impl Strategy<Value = RangePos> {
    (
        sheet_id_strategy(),
        0..100u32,
        0..20u32,
        0..100u32,
        0..20u32,
    )
        .prop_map(|(sheet, r1, c1, r2, c2)| {
            let (sr, er) = if r1 <= r2 { (r1, r2) } else { (r2, r1) };
            let (sc, ec) = if c1 <= c2 { (c1, c2) } else { (c2, c1) };
            RangePos::new(sheet, sr, sc, er, ec)
        })
}

fn mixed_dep_list_strategy() -> impl Strategy<Value = Vec<DepTarget>> {
    prop::collection::vec(
        prop_oneof![
            cell_id_strategy().prop_map(DepTarget::Cell),
            range_pos_strategy().prop_map(|r| DepTarget::Range(r, RangeAccess::Aggregate)),
        ],
        0..=10,
    )
}

fn mixed_graph_strategy() -> impl Strategy<Value = Vec<(CellId, Vec<DepTarget>)>> {
    prop::collection::vec((cell_id_strategy(), mixed_dep_list_strategy()), 10..=200)
}

fn random_graph_strategy() -> impl Strategy<Value = Vec<(CellId, Vec<DepTarget>)>> {
    prop::collection::vec((cell_id_strategy(), dep_list_strategy()), 10..=200)
}

/// Generate an acyclic graph by ensuring each cell only depends on cells with
/// strictly lower raw IDs. Deduplicates both cells and deps to avoid
/// double-counting in topo sort in-degree computation.
fn acyclic_graph_strategy() -> impl Strategy<Value = Vec<(CellId, Vec<DepTarget>)>> {
    prop::collection::vec(
        (2..=5000u128).prop_flat_map(|n| {
            let cell = CellId::from_raw(n);
            // Use a hash_set strategy to get unique dep targets.
            let deps = prop::collection::hash_set(
                (1..n).prop_map(|d| DepTarget::Cell(CellId::from_raw(d))),
                0..=10usize.min((n - 1) as usize),
            );
            deps.prop_map(move |d| (cell, d.into_iter().collect::<Vec<_>>()))
        }),
        10..=100,
    )
    .prop_map(|entries| {
        // Deduplicate by cell: keep only the last entry for each CellId.
        let mut seen = std::collections::HashMap::new();
        for (cell, deps) in entries {
            seen.insert(cell.as_u128(), (cell, deps));
        }
        seen.into_values().collect::<Vec<_>>()
    })
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

fn build_graph(entries: &[(CellId, Vec<DepTarget>)]) -> DependencyGraph {
    let mut graph = DependencyGraph::new();
    for (cell, deps) in entries {
        graph.set_precedents(cell, deps.clone());
    }
    graph
}

// ─────────────────────────────────────────────────────────────────
// Property tests
// ─────────────────────────────────────────────────────────────────

proptest! {
    /// 1. Precedent/dependent consistency: every Cell edge in precedents has
    ///    a matching reverse entry in dependents, and vice versa.
    #[test]
    fn precedent_dependent_consistency(entries in random_graph_strategy()) {
        let graph = build_graph(&entries);

        // Forward check: for every Cell(target) in precedents[cell],
        // cell must appear in dependents[target].
        for (cell, _) in &entries {
            for dep in graph.get_precedents(cell) {
                if let DepTarget::Cell(target) = dep {
                    prop_assert!(
                        graph.has_dependent(target, cell),
                        "cell {:?} lists {:?} as precedent, but dependents[{:?}] does not contain {:?}",
                        cell, target, target, cell
                    );
                }
            }
        }

        // Reverse check: for every cell in dependents[target],
        // target must appear in that cell's precedents.
        // We need to check all targets that have dependents.
        // Collect all targets that appear as Cell deps.
        let mut all_targets: FxHashSet<CellId> = FxHashSet::default();
        for (_, deps) in &entries {
            for dep in deps {
                if let DepTarget::Cell(t) = dep {
                    all_targets.insert(*t);
                }
            }
        }
        // Also check cells that are formula cells (they may be depended on).
        for (cell, _) in &entries {
            all_targets.insert(*cell);
        }

        for target in &all_targets {
            for dependent_cell in graph.get_dependents(target) {
                let precs = graph.get_precedents(dependent_cell);
                prop_assert!(
                    precs.contains(&DepTarget::Cell(*target)),
                    "dependents[{:?}] contains {:?}, but precedents[{:?}] does not contain Cell({:?})",
                    target, dependent_cell, dependent_cell, target
                );
            }
        }
    }

    /// 2. Topo sort satisfies edge ordering: for any acyclic graph,
    ///    evaluation_levels returns Ok and every edge (A depends on B)
    ///    has B appearing before A (across levels).
    #[test]
    fn topo_sort_respects_edges(entries in acyclic_graph_strategy()) {
        let graph = build_graph(&entries);
        let null_resolver = |_: &CellId| -> Option<CellPosition> { None };

        let levels_result = graph.evaluation_levels(&null_resolver);
        prop_assert!(levels_result.is_ok(), "acyclic graph should produce Ok from evaluation_levels");
        let levels = levels_result.unwrap().into_value();

        // Build position map: cell -> level index
        // All cells within the same level are independent, so we only need to
        // verify that deps appear at a strictly earlier level.
        let mut level_of: std::collections::HashMap<CellId, usize> = std::collections::HashMap::new();
        for (lvl_idx, lvl) in levels.iter().enumerate() {
            for c in lvl {
                level_of.insert(*c, lvl_idx);
            }
        }

        // For every formula cell, every cell-dep must appear at an earlier level.
        for (cell, _) in &entries {
            if let Some(&cell_lvl) = level_of.get(cell) {
                for dep in graph.get_precedents(cell) {
                    if let DepTarget::Cell(target) = dep
                        && let Some(&target_lvl) = level_of.get(target)
                    {
                        prop_assert!(
                            target_lvl < cell_lvl,
                            "edge: {:?} depends on {:?}, but {:?} at level {} is not before {:?} at level {}",
                            cell, target, target, target_lvl, cell, cell_lvl
                        );
                    }
                }
            }
        }
    }

    /// 3. set_precedents idempotence: calling set_precedents twice with the
    ///    same deps produces the same state as calling it once.
    #[test]
    fn set_precedents_idempotent(
        cell in cell_id_strategy(),
        deps in dep_list_strategy(),
        // Build some background edges first so graph isn't trivial.
        background in prop::collection::vec(
            (cell_id_strategy(), dep_list_strategy()),
            0..=10,
        ),
    ) {
        // Build once
        let mut graph1 = DependencyGraph::new();
        for (c, d) in &background {
            graph1.set_precedents(c, d.clone());
        }
        graph1.set_precedents(&cell, deps.clone());

        // Build twice
        let mut graph2 = DependencyGraph::new();
        for (c, d) in &background {
            graph2.set_precedents(c, d.clone());
        }
        graph2.set_precedents(&cell, deps.clone());
        graph2.set_precedents(&cell, deps.clone());

        // Compare observable state
        prop_assert_eq!(
            graph1.get_precedents(&cell),
            graph2.get_precedents(&cell),
            "precedents differ after double set"
        );
        prop_assert_eq!(
            graph1.edge_count(),
            graph2.edge_count(),
            "edge_count differs after double set"
        );
        prop_assert_eq!(
            graph1.formula_cell_count(),
            graph2.formula_cell_count(),
            "formula_cell_count differs after double set"
        );

        // Check dependents for all cells referenced in deps
        for dep in &deps {
            if let DepTarget::Cell(target) = dep {
                let d1: FxHashSet<CellId> = graph1.get_dependents(target).copied().collect();
                let d2: FxHashSet<CellId> = graph2.get_dependents(target).copied().collect();
                prop_assert_eq!(
                    d1,
                    d2,
                    "dependents for {:?} differ after double set",
                    target
                );
            }
        }
    }

    /// 4. remove_cell completeness: after removing a cell, it must not appear
    ///    in any precedent list, any dependent set, or the volatile set.
    #[test]
    fn remove_cell_completeness(
        entries in random_graph_strategy(),
        remove_idx in 0..200usize,
    ) {
        let mut graph = build_graph(&entries);

        // Pick a cell to remove (wrap index to valid range).
        let idx = remove_idx % entries.len();
        let (cell_to_remove, _) = &entries[idx];
        let cell_to_remove = *cell_to_remove;

        // Optionally mark volatile to test volatile cleanup too.
        graph.mark_volatile(&cell_to_remove);

        graph.remove_cell(&cell_to_remove);

        // Must not appear as a formula cell (no precedents).
        prop_assert!(
            graph.get_precedents(&cell_to_remove).is_empty(),
            "removed cell {:?} still has precedents",
            cell_to_remove
        );

        // Must not appear in any other cell's precedent list.
        for (other_cell, _) in &entries {
            for dep in graph.get_precedents(other_cell) {
                if let DepTarget::Cell(target) = dep {
                    prop_assert_ne!(
                        *target, cell_to_remove,
                        "removed cell {:?} still appears in precedents of {:?}",
                        cell_to_remove, other_cell
                    );
                }
            }
        }

        // Must not appear in any dependent set.
        for (other_cell, _) in &entries {
            prop_assert!(
                !graph.has_dependent(other_cell, &cell_to_remove),
                "removed cell {:?} still in dependents of {:?}",
                cell_to_remove, other_cell
            );
        }

        // Must not be volatile.
        prop_assert!(
            !graph.is_volatile(&cell_to_remove),
            "removed cell {:?} is still volatile",
            cell_to_remove
        );
    }

    /// 5. Bulk vs individual equivalence: bulk_set_precedents_fresh produces
    ///    identical precedents and dependents as calling set_precedents_fresh
    ///    individually for each entry.
    #[test]
    fn bulk_vs_individual_equivalence(entries in random_graph_strategy()) {
        // Deduplicate by cell so each cell appears at most once (required by
        // set_precedents_fresh which asserts no prior precedents).
        let mut deduped: std::collections::HashMap<u128, (CellId, Vec<DepTarget>)> =
            std::collections::HashMap::new();
        for (cell, deps) in &entries {
            deduped.insert(cell.as_u128(), (*cell, deps.clone()));
        }
        let unique_entries: Vec<(CellId, Vec<DepTarget>)> =
            deduped.into_values().collect();

        // Individual path
        let mut individual = DependencyGraph::new();
        for (cell, deps) in &unique_entries {
            individual.set_precedents(cell, deps.clone());
        }

        // Bulk path
        let mut builder = GraphBuilder::new();
        builder.bulk_set_precedents(unique_entries.clone());
        let bulk = builder.build();

        // Compare precedents for every cell
        for (cell, _) in &unique_entries {
            prop_assert_eq!(
                individual.get_precedents(cell),
                bulk.get_precedents(cell),
                "precedents differ for cell {:?}",
                cell
            );
        }

        // Compare dependents for all referenced targets
        let mut all_targets: FxHashSet<CellId> = FxHashSet::default();
        for (cell, deps) in &unique_entries {
            all_targets.insert(*cell);
            for dep in deps {
                if let DepTarget::Cell(t) = dep {
                    all_targets.insert(*t);
                }
            }
        }

        for target in &all_targets {
            let ind_deps: FxHashSet<CellId> = individual.get_dependents(target).copied().collect();
            let bulk_deps: FxHashSet<CellId> = bulk.get_dependents(target).copied().collect();
            prop_assert_eq!(
                ind_deps, bulk_deps,
                "dependents differ for target {:?}",
                target
            );
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Range-aware property tests
    // ─────────────────────────────────────────────────────────────

    /// 6. Range dependency consistency: every Range edge in a cell's precedents
    ///    is reflected in `find_by_range_containment`, and `range_dep_count`
    ///    matches the number of distinct RangePos keys.
    #[test]
    fn range_dep_consistency(entries in mixed_graph_strategy()) {
        let graph = build_graph(&entries);

        // Collect all (RangePos, CellId) pairs from precedents.
        let mut expected_range_to_cells: std::collections::HashMap<RangePos, FxHashSet<CellId>> =
            std::collections::HashMap::new();

        for (cell, _) in &entries {
            for dep in graph.get_precedents(cell) {
                if let DepTarget::Range(rect, _) = dep {
                    expected_range_to_cells
                        .entry(*rect)
                        .or_default()
                        .insert(*cell);
                }
            }
        }

        // For every range, query a point inside it and verify the formula cell is returned.
        for (rect, cells) in &expected_range_to_cells {
            let mid_row = rect.start_row().midpoint(rect.end_row());
            let mid_col = rect.start_col().midpoint(rect.end_col());
            let found = graph.find_by_range_containment(&[(rect.sheet(), mid_row, mid_col)]);
            for cell in cells {
                prop_assert!(
                    found.contains(cell),
                    "cell {:?} has Range({:?}) as precedent, but find_by_range_containment at midpoint ({},{}) did not return it",
                    cell, rect, mid_row, mid_col
                );
            }
        }

        // range_dep_count must equal the number of distinct range keys.
        prop_assert_eq!(
            graph.range_dep_count(),
            expected_range_to_cells.len(),
            "range_dep_count mismatch: expected {} distinct ranges, got {}",
            expected_range_to_cells.len(),
            graph.range_dep_count()
        );
    }

    /// 7. Range containment query correctness: inserting range deps and querying
    ///    midpoints returns the correct formula cells; querying outside all ranges
    ///    returns empty.
    #[test]
    fn range_containment_query_correctness(
        ranges_and_cells in prop::collection::vec(
            (range_pos_strategy(), cell_id_strategy()),
            1..=10,
        ),
    ) {
        let mut graph = DependencyGraph::new();

        // Merge deps per cell so later set_precedents doesn't overwrite earlier ones.
        let mut cell_deps: std::collections::HashMap<CellId, Vec<DepTarget>> =
            std::collections::HashMap::new();
        for (range, cell) in &ranges_and_cells {
            cell_deps
                .entry(*cell)
                .or_default()
                .push(DepTarget::Range(*range, RangeAccess::Aggregate));
        }
        for (cell, deps) in &cell_deps {
            graph.set_precedents(cell, deps.clone());
        }

        // For each range's midpoint, verify the formula cell IS returned.
        for (range, cell) in &ranges_and_cells {
            let mid_row = range.start_row().midpoint(range.end_row());
            let mid_col = range.start_col().midpoint(range.end_col());
            let found = graph.find_by_range_containment(&[(range.sheet(), mid_row, mid_col)]);
            prop_assert!(
                found.contains(cell),
                "expected cell {:?} in containment result for range {:?} at midpoint ({},{}), got {:?}",
                cell, range, mid_row, mid_col, found
            );
        }

        // Query a point that is outside ALL ranges: row=200, col=200
        // (ranges use row 0..100, col 0..20, so (200, 200) is outside all).
        for sheet_raw in 1..=10u128 {
            let sheet = SheetId::from_raw(sheet_raw);
            let outside = graph.find_by_range_containment(&[(sheet, 200, 200)]);
            prop_assert!(
                outside.is_empty(),
                "expected empty result for point outside all ranges on sheet {:?}, got {:?}",
                sheet, outside
            );
        }
    }

    /// 8. Removing a cell cleans up range deps: after remove_cell, the cell
    ///    must not appear in any range containment query, and range_dep_count
    ///    must decrease appropriately.
    #[test]
    fn remove_cell_cleans_range_deps(
        entries in mixed_graph_strategy(),
        remove_idx in 0..200usize,
    ) {
        let mut graph = build_graph(&entries);

        // Pick a cell to remove.
        let idx = remove_idx % entries.len();
        let (cell_to_remove, _) = &entries[idx];
        let cell_to_remove = *cell_to_remove;

        // Collect the ranges this cell depended on before removal.
        let ranges_before: Vec<RangePos> = graph
            .get_precedents(&cell_to_remove)
            .iter()
            .filter_map(|dep| {
                if let DepTarget::Range(rect, _) = dep {
                    Some(*rect)
                } else {
                    None
                }
            })
            .collect();

        let range_count_before = graph.range_dep_count();

        graph.remove_cell(&cell_to_remove);

        // The cell must not appear in any range containment query.
        // Query every range's midpoint that the removed cell used to depend on.
        for rect in &ranges_before {
            let mid_row = rect.start_row().midpoint(rect.end_row());
            let mid_col = rect.start_col().midpoint(rect.end_col());
            let found = graph.find_by_range_containment(&[(rect.sheet(), mid_row, mid_col)]);
            prop_assert!(
                !found.contains(&cell_to_remove),
                "removed cell {:?} still returned by find_by_range_containment for range {:?}",
                cell_to_remove, rect
            );
        }

        // range_dep_count must not have increased.
        prop_assert!(
            graph.range_dep_count() <= range_count_before,
            "range_dep_count increased after remove_cell: {} -> {}",
            range_count_before,
            graph.range_dep_count()
        );

        // The cell must have no precedents left.
        prop_assert!(
            graph.get_precedents(&cell_to_remove).is_empty(),
            "removed cell {:?} still has precedents",
            cell_to_remove
        );
    }

    /// 9. `has_range_deps_for_sheet` consistency: after building any mixed graph,
    ///    every sheet that appears as a range dep key must be reported by
    ///    `has_range_deps_for_sheet`.
    #[test]
    fn sheets_with_range_deps_consistency(entries in mixed_graph_strategy()) {
        let graph = build_graph(&entries);

        // Collect the set of sheets that actually have at least one range dep.
        let mut sheets_with_ranges: FxHashSet<SheetId> = FxHashSet::default();
        for (cell, _) in &entries {
            for dep in graph.get_precedents(cell) {
                if let DepTarget::Range(rect, _) = dep {
                    sheets_with_ranges.insert(rect.sheet());
                }
            }
        }

        // Forward: every sheet with a range dep must be reported.
        for sheet in &sheets_with_ranges {
            prop_assert!(
                graph.has_range_deps_for_sheet(sheet),
                "sheet {:?} has range deps but has_range_deps_for_sheet returned false",
                sheet
            );
        }

        // Reverse: every sheet reported by has_range_deps_for_sheet must
        // actually have at least one range dep. Check all possible sheets.
        for raw in 1..=10u128 {
            let sheet = SheetId::from_raw(raw);
            if graph.has_range_deps_for_sheet(&sheet) {
                prop_assert!(
                    sheets_with_ranges.contains(&sheet),
                    "has_range_deps_for_sheet reports sheet {:?} but no range dep uses it",
                    sheet
                );
            }
        }
    }

    /// 10. Duplicate deps do not panic: setting precedents with duplicate
    ///     targets (same Cell twice) must not panic, and the graph must remain
    ///     bidirectionally consistent.
    #[test]
    fn duplicate_deps_no_panic(
        cell in cell_id_strategy(),
        base_deps in prop::collection::vec(cell_id_strategy().prop_map(DepTarget::Cell), 1..=5),
    ) {
        // Build a dep list that intentionally contains duplicates.
        let mut deps_with_dups = base_deps.clone();
        deps_with_dups.extend(base_deps.iter().cloned());

        let mut graph = DependencyGraph::new();
        graph.set_precedents(&cell, deps_with_dups);

        // Precedent/dependent bidirectional check.
        for dep in graph.get_precedents(&cell) {
            if let DepTarget::Cell(target) = dep {
                prop_assert!(
                    graph.has_dependent(target, &cell),
                    "cell {:?} lists {:?} as precedent, but dependents[{:?}] does not contain {:?}",
                    cell, target, target, cell
                );
            }
        }

        // Every dependent entry must have a matching precedent.
        let all_targets: FxHashSet<CellId> = graph
            .get_precedents(&cell)
            .iter()
            .filter_map(|d| if let DepTarget::Cell(t) = d { Some(*t) } else { None })
            .collect();

        for target in &all_targets {
            for dependent_cell in graph.get_dependents(target) {
                if *dependent_cell == cell {
                    let precs = graph.get_precedents(dependent_cell);
                    prop_assert!(
                        precs.contains(&DepTarget::Cell(*target)),
                        "dependents[{:?}] contains {:?}, but precedents missing Cell({:?})",
                        target, dependent_cell, target
                    );
                }
            }
        }
    }
}

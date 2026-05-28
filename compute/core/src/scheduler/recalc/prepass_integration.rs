use super::*;

impl ComputeCore {
    /// Collect formula cells in agg-group data columns that would cause the
    /// `data_formula_guard` to bail (in `ast_cache` but not yet evaluated).
    ///
    /// These are typically a handful of cells (e.g., ANCHORARRAY formulas at
    /// row 4) that sit in columns scanned by SUMIFS/COUNTIFS but aren't part
    /// of the topo-sort levels (orphan formulas without dependents). The caller
    /// evaluates them before the prepass so the guard passes.
    pub(super) fn collect_agg_data_column_blockers(
        &self,
        mirror: &CellMirror,
        agg_group_cell_ids: &FxHashSet<CellId>,
        already_evaluated: &FxHashSet<CellId>,
    ) -> Vec<CellId> {
        // Re-detect groups to access their data column ranges.
        let ast_cache = &self.ast_cache;
        let get_ast = |cell_id: &CellId| -> Option<&compute_parser::ASTNode> {
            ast_cache.get(cell_id).map(|entry| &entry.ast)
        };
        // Use the agg_group_cell_ids as the dirty set for group detection
        let groups = agg_prepass::detect_agg_groups(
            agg_group_cell_ids,
            get_ast,
            mirror,
            agg_prepass::AGG_MIN_GROUP_SIZE,
        );

        // Collect unique (sheet, col, start_row, end_row) ranges from all groups
        let mut seen_ranges: FxHashSet<(SheetId, u32, u32, u32)> = FxHashSet::default();
        for group in &groups {
            for pair in &group.pattern.pairs {
                seen_ranges.insert((
                    pair.data_sheet,
                    pair.data_col,
                    pair.data_start_row,
                    pair.data_end_row,
                ));
            }
            if let Some((vs, vc, vstart, vend)) = &group.pattern.value_range {
                seen_ranges.insert((*vs, *vc, *vstart, *vend));
            }
        }

        // Scan each range for formula cells not yet evaluated
        let mut blockers: Vec<CellId> = Vec::new();
        let mut blocker_set: FxHashSet<CellId> = FxHashSet::default();
        for &(sheet, col, start_row, end_row) in &seen_ranges {
            let Some(sh) = mirror.get_sheet(&sheet) else {
                continue;
            };
            let clamped_end = if end_row == u32::MAX {
                sh.rows
            } else {
                end_row.min(sh.rows)
            };
            for row in start_row..clamped_end {
                if let Some(cell_id) = mirror.resolve_cell_id(&sheet, SheetPos::new(row, col))
                    && ast_cache.contains_key(&cell_id)
                    && !already_evaluated.contains(&cell_id)
                    && !blocker_set.contains(&cell_id)
                {
                    blocker_set.insert(cell_id);
                    blockers.push(cell_id);
                }
            }
        }

        // Pass 2: Transitive upstream closure — BFS from all blockers through
        // `get_precedents` to find every unevaluated formula cell upstream. This
        // ensures that dynamic array spill sources, their own dependencies, and
        // any other upstream formulas are included so the agg prepass can
        // evaluate the full dependency chain in correct order.
        if !blockers.is_empty() {
            const MAX_CLOSURE_SIZE: usize = 10_000;
            let mut queue = std::collections::VecDeque::with_capacity(blockers.len());
            for &cid in &blockers {
                queue.push_back(cid);
            }

            while let Some(cell) = queue.pop_front() {
                if blocker_set.len() >= MAX_CLOSURE_SIZE {
                    break;
                }
                for dep in self.graph.get_precedents(&cell) {
                    match dep {
                        compute_graph::DepTarget::Cell(dep_id) => {
                            if ast_cache.contains_key(dep_id)
                                && !already_evaluated.contains(dep_id)
                                && blocker_set.insert(*dep_id)
                            {
                                blockers.push(*dep_id);
                                queue.push_back(*dep_id);
                            }
                        }
                        compute_graph::DepTarget::Range(range, _) => {
                            let Some(sh) = mirror.get_sheet(&range.sheet()) else {
                                continue;
                            };
                            let clamped_end = if range.end_row() == u32::MAX {
                                sh.rows
                            } else {
                                range.end_row().min(sh.rows)
                            };
                            for col in range.start_col()..=range.end_col() {
                                for row in range.start_row()..clamped_end {
                                    if let Some(dep_id) = mirror
                                        .resolve_cell_id(&range.sheet(), SheetPos::new(row, col))
                                        && ast_cache.contains_key(&dep_id)
                                        && !already_evaluated.contains(&dep_id)
                                        && blocker_set.insert(dep_id)
                                    {
                                        blockers.push(dep_id);
                                        queue.push_back(dep_id);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        blockers
    }
}

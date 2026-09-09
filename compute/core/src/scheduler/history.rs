//! Rebind formula dependencies after canonical native history has been swapped.
use super::*;

impl ComputeCore {
    pub(crate) fn replay_native_history(
        &mut self,
        mirror: &mut CellMirror,
        texts: &FxHashMap<CellId, Option<String>>,
        seeds: &[CellId],
        topology: bool,
        sheet_order: &[SheetId],
    ) -> Result<RecalcResult, ComputeError> {
        self.ensure_graph_built(mirror)?;
        let mut changed = seeds.to_vec();
        let mut teardowns = Vec::new();
        for cell in seeds {
            if let Some(source) = self.spill_blockers.remove(cell) {
                changed.push(source);
            }
            if let Some(sheet) = mirror.sheet_for_cell(cell)
                && let Some(pos) = mirror.resolve_position(cell)
                && let Some((source, projection)) =
                    self.invalidate_projection_at(mirror, &sheet, pos.row(), pos.col(), *cell)
            {
                changed.push(source);
                if let Some(change) =
                    super::spill::build_teardown_projection_change(source, &projection)
                {
                    teardowns.push(change);
                }
            }
        }
        let mut refresh = texts.clone();
        if topology {
            self.sheet_order = sheet_order
                .iter()
                .enumerate()
                .map(|(i, s)| (*s, i))
                .collect();
            self.rebuild_ordered_sheets_cache();
            self.workbook_cache.clear_all();
            self.regenerate_formula_strings_and_cell_formula_text(mirror);
            for cell in self.cell_formula_text.keys().copied().collect::<Vec<_>>() {
                refresh.entry(cell).or_insert_with(|| {
                    mirror
                        .sheet_for_cell(&cell)
                        .and_then(|_| self.cell_formula_text.get(&cell).cloned())
                });
            }
            for sheet in mirror.sheet_ids() {
                if let Some(source) = mirror.get_sheet(sheet) {
                    for (cell, entry) in source.cells_iter() {
                        if entry.formula.is_some() {
                            refresh
                                .entry(*cell)
                                .or_insert_with(|| self.get_formula(cell).map(str::to_owned));
                        }
                    }
                }
            }
        }
        // Preserve the already-restored native value payloads and identities.
        // Parsing refreshes derived AST/graph state; it never reimports scalar cells.
        let mut formulas = Vec::new();
        for (cell, text) in refresh {
            let identity = mirror.get_formula(&cell).cloned();
            self.clear_formula_deps(mirror, cell);
            if let Some(sheet) = mirror.sheet_for_cell(&cell)
                && let Some(text) = text
            {
                formulas.push((cell, sheet, text, identity));
            }
        }
        for (cell, sheet, text, identity) in formulas {
            self.parse_and_register_formula(mirror, cell, sheet, text, true);
            if let Some(identity) = identity {
                mirror.set_formula(&cell, Some(identity));
            }
        }
        self.mark_dirty();
        let mut result = if topology {
            self.full_recalc(mirror)?
        } else {
            self.recalc(mirror, &changed)?
        };
        super::spill::append_filtered_teardowns(&mut result, teardowns);
        Ok(result)
    }
}

impl ComputeCore {
    pub(crate) fn append_history_projection_teardowns(
        &self,
        result: &mut RecalcResult,
        projections: &[(CellId, crate::projection::Projection)],
    ) {
        let changes = projections
            .iter()
            .filter_map(|(cell, projection)| {
                super::spill::build_teardown_projection_change(*cell, projection)
            })
            .collect();
        super::spill::append_filtered_teardowns(result, changes);
    }
}

use super::{HistoryEffects, HistoryPatch};
use crate::snapshot::{MutationResult, RecalcResult};
use crate::storage::engine::{ComputeEngine, construction, services};
use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

impl HistoryPatch {
    fn swap(&mut self, engine: &mut ComputeEngine, effects: &mut HistoryEffects) {
        match self {
            Self::Cell(p) => p.swap(&mut engine.stores, &mut engine.cell_store, effects),
            Self::Relocate(p) => p.swap(&mut engine.stores, &mut engine.cell_store, effects),
            Self::Structure(p) => p.swap(&mut engine.stores, &mut engine.cell_store, effects),
            Self::Sheet(p) => p.swap(&mut engine.stores, &mut engine.cell_store, effects),
            Self::SheetExtent(p) => p.swap(&mut engine.stores, &mut engine.cell_store, effects),
            Self::Metadata(p) => {
                p.swap(&mut engine.stores.storage, &mut engine.cell_store, effects)
            }
        }
    }
}

impl ComputeEngine {
    pub(super) fn replay_history(&mut self, redo: bool) -> Result<MutationResult, ComputeError> {
        let action = if redo {
            self.history.redo.pop()
        } else {
            self.history.undo.pop()
        };
        let Some(mut action) = action else {
            return Ok(MutationResult::empty());
        };
        self.history.replaying = true;
        let mut effects = HistoryEffects::default();
        let pre_settings =
            crate::storage::workbook::settings::get_settings(&self.stores.storage.metadata);
        if redo {
            for patch in &mut action.patches {
                patch.swap(self, &mut effects);
            }
        } else {
            for patch in action.patches.iter_mut().rev() {
                patch.swap(self, &mut effects);
            }
        }
        let post_settings =
            crate::storage::workbook::settings::get_settings(&self.stores.storage.metadata);
        self.sync_runtime_workbook_settings(&pre_settings, &post_settings);
        let outcome = self.finish_history_replay(&mut effects);
        self.history.replaying = false;
        // Even a calculation error leaves the authored mutation committed and
        // reversible. Keep its inverse on the opposite stack, never lose the action.
        if redo {
            self.history.undo.push(action);
        } else {
            self.history.redo.push(action);
        }
        outcome
    }

    fn finish_history_replay(
        &mut self,
        effects: &mut HistoryEffects,
    ) -> Result<MutationResult, ComputeError> {
        for sheet in &effects.sheets {
            if let Some(meta) = self.stores.storage.sheet_metadata.get(sheet)
                && self
                    .cell_store
                    .get_sheet(sheet)
                    .is_some_and(|source| source.name != meta.name)
            {
                self.cell_store.rename_sheet(sheet, &meta.name);
                effects.topology = true;
            }
        }
        construction::sync_enable_calculation_flags(self);
        self.settings = construction::derive_settings(&self.stores.storage);
        if effects.named_ranges || effects.topology {
            let previous: Vec<_> = self
                .cell_store
                .all_named_ranges_for_diagnostics()
                .map(|(scope, name, _)| (scope.clone(), name.clone()))
                .collect();
            for (scope, name) in previous {
                self.stores
                    .compute
                    .remove_named_range_scoped(&mut self.cell_store, &scope, &name);
            }
            let definitions = construction::defined_names_to_named_range_defs(
                crate::storage::workbook::named_ranges::get_all_named_ranges(
                    &self.stores.storage.metadata,
                ),
                |identity| {
                    self.stores.compute.to_a1_display_qualified(
                        &self.cell_store,
                        &SheetId::from_raw(0),
                        identity,
                    )
                },
            );
            for def in definitions {
                self.stores
                    .compute
                    .set_named_range(&mut self.cell_store, def.name.clone(), def);
            }
        }
        for sheet in &effects.sparkline_sheets {
            if let Some(meta) = self.stores.storage.sheet_metadata.get_mut(sheet) {
                meta.sparklines.rebuild_positions();
            }
        }
        let format_sheets: rustc_hash::FxHashSet<_> =
            effects.format_rects.iter().map(|r| r.0).collect();
        for sheet in format_sheets {
            if let Some(source) = self.cell_store.get_sheet_mut(&sheet) {
                source.rebuild_format_range_spatial_index();
                source.rebuild_col_format_range_spatial_index();
            }
        }
        for sheet in &effects.sheets {
            if self.stores.grid_indexes.contains_key(sheet) {
                self.stores.invalidate_pixel_layout(sheet);
                services::mutation::rebuild_merge_index(&mut self.stores, &self.cell_store, sheet);
                services::mutation::sync_store_merge_regions(
                    &self.stores,
                    &mut self.cell_store,
                    sheet,
                );
            } else {
                self.stores.invalidate_pixel_layout(sheet);
                self.stores.merge_indexes.remove(sheet);
                self.stores.cf_cache.remove(sheet);
            }
        }
        super::metadata::emit_events(
            &self.stores.storage,
            &self.cell_store,
            &self.stores.grid_indexes,
            self.stores.layout_metrics,
            effects,
        );
        if !effects.result.pivot_changes.is_empty() {
            self.materialize_all_pivots();
            effects.recalc = true;
            effects.topology = true;
        }
        let cf_sheets: rustc_hash::FxHashSet<_> = effects
            .result
            .cf_changes
            .iter()
            .filter_map(|change| SheetId::from_uuid_str(&change.sheet_id).ok())
            .collect();
        for sheet in cf_sheets {
            self.refresh_cf_cache(&sheet);
        }
        self.restore_history_cse_selections();
        let seeds: Vec<CellId> = effects.cells.keys().copied().collect();
        let topology =
            effects.topology || effects.named_ranges || effects.tables || effects.settings;
        let mut recalc = if effects.recalc || topology {
            self.stores.compute.replay_native_history(
                &mut self.cell_store,
                &effects.formula_texts,
                &seeds,
                topology,
                &self.stores.storage.sheet_order(),
            )?
        } else {
            RecalcResult::empty()
        };
        self.restore_history_cse_selections();
        // A removed sparse entry still needs an explicit visible clear. Also
        // include direct formula edits whose restored cached result was unchanged.
        let reported_cells: rustc_hash::FxHashSet<_> = recalc
            .changed_cells
            .iter()
            .filter_map(|change| CellId::from_uuid_str(&change.cell_id).ok())
            .collect();
        for (cell, (sheet, row, col)) in &effects.cells {
            if self.cell_store.get_sheet(sheet).is_none() {
                continue;
            }
            if !reported_cells.contains(cell) {
                let value = self
                    .cell_store
                    .get_cell_value_at(sheet, SheetPos::new(*row, *col))
                    .cloned()
                    .unwrap_or(CellValue::Null);
                let mut change = crate::snapshot::CellChange {
                    cell_id: cell.to_uuid_string(),
                    sheet_id: sheet.to_uuid_string(),
                    value,
                    position: None,
                    display_text: None,
                    old_display_text: None,
                    old_formula: None,
                    new_formula: None,
                    number_format: None,
                    format_idx: None,
                    extra_flags: 0,
                    old_value: None,
                };
                change.position = Some(crate::snapshot::CellPosition {
                    row: *row,
                    col: *col,
                });
                change.new_formula = self.stores.compute.get_formula(cell).map(str::to_owned);
                recalc.changed_cells.push(change);
            }
        }
        self.stores
            .compute
            .append_history_projection_teardowns(&mut recalc, &effects.projections);
        for change in &mut recalc.changed_cells {
            if let Ok(cell) = CellId::from_uuid_str(&change.cell_id) {
                if let Some(value) = effects.old_values.get(&cell) {
                    change.old_value = Some(value.clone());
                }
                if let Some(formula) = effects.old_formulas.get(&cell) {
                    change.old_formula = Some(formula.clone().unwrap_or_default());
                    change.new_formula = self.stores.compute.get_formula(&cell).map(str::to_owned);
                }
            }
        }
        super::structure::emit_lifecycle(&self.stores, &self.cell_store, effects);
        self.append_history_format_changes(effects, &mut recalc);
        self.postprocess_mutation_recalc(&mut recalc);
        effects.result.recalc = recalc;

        Ok(std::mem::replace(
            &mut effects.result,
            MutationResult::empty(),
        ))
    }
}

impl ComputeEngine {
    fn append_history_format_changes(&self, effects: &HistoryEffects, recalc: &mut RecalcResult) {
        use rustc_hash::FxHashSet;
        let mut positions = FxHashSet::default();
        for (sheet, r0, c0, r1, c1) in &effects.format_rects {
            for (_, bounds) in self.viewport.viewports_for_sheet(sheet) {
                let a = (*r0).max(bounds.start_row);
                let b = (*r1).min(bounds.end_row);
                let c = (*c0).max(bounds.start_col);
                let d = (*c1).min(bounds.end_col);
                if a <= b && c <= d {
                    for row in a..=b {
                        for col in c..=d {
                            positions.insert((*sheet, row, col));
                        }
                    }
                }
            }
        }
        for property in &effects.result.property_changes {
            if let (Ok(sheet), Some(pos)) = (
                SheetId::from_uuid_str(&property.sheet_id),
                &property.position,
            ) {
                positions.insert((sheet, pos.row, pos.col));
            }
        }
        let reported_positions: FxHashSet<_> = recalc
            .changed_cells
            .iter()
            .filter_map(|change| {
                Some((
                    SheetId::from_uuid_str(&change.sheet_id).ok()?,
                    change.position.as_ref()?.row,
                    change.position.as_ref()?.col,
                ))
            })
            .collect();
        for (sheet, row, col) in positions {
            if reported_positions.contains(&(sheet, row, col)) {
                continue;
            }
            let pos = SheetPos::new(row, col);
            let cell = self.cell_store.resolve_cell_id(&sheet, pos);
            recalc.changed_cells.push(crate::snapshot::CellChange {
                cell_id: cell.map(|id| id.to_uuid_string()).unwrap_or_default(),
                sheet_id: sheet.to_uuid_string(),
                position: Some(crate::snapshot::CellPosition { row, col }),
                value: self
                    .cell_store
                    .get_cell_value_at(&sheet, pos)
                    .cloned()
                    .unwrap_or(CellValue::Null),
                display_text: None,
                old_display_text: None,
                old_formula: None,
                new_formula: cell
                    .and_then(|id| self.stores.compute.get_formula(&id))
                    .map(str::to_owned),
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            });
        }
    }
}

impl ComputeEngine {
    /// CSE reserves the authored selection even when its current result is a
    /// scalar or a smaller array. Recalculation may replace its derived spill.
    fn restore_history_cse_selections(&mut self) {
        let selections: Vec<_> = self
            .cell_store
            .cse_anchors
            .iter()
            .filter_map(|cell| {
                let metadata = self.stores.storage.cell_metadata.get(cell)?;
                let range = crate::range_manager::parse_range(metadata.array_ref.as_deref()?)?;
                let sheet = self.cell_store.sheet_for_cell(cell)?;
                let pos = self.cell_store.resolve_position(cell)?;
                let rows = range.end.row.checked_sub(range.start.row)?.checked_add(1)?;
                let cols = range.end.col.checked_sub(range.start.col)?.checked_add(1)?;
                Some((*cell, sheet, pos, rows, cols))
            })
            .collect();
        for (cell, sheet, pos, rows, cols) in selections {
            if rows == 1 && cols == 1 {
                self.cell_store.cse_single_cell.insert(cell);
            } else {
                self.cell_store.cse_single_cell.remove(&cell);
            }
            self.cell_store.projection_registry.register(
                cell,
                sheet,
                pos.row(),
                pos.col(),
                rows,
                cols,
            );
        }
    }
}

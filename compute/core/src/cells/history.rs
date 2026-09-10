//! Rebuild derived lookup state after replaying native inverses.

use cell_types::{SheetId, interval_tree::IntervalTree};

use super::{CellStore, SheetStore, sheet_key::normalize_sheet_key};

impl CellStore {
    pub(crate) fn history_refresh_axis_ownership(&mut self, sheet_id: SheetId) {
        self.refresh_axis_ownership(sheet_id);
    }

    pub(crate) fn history_swap_sheet(
        &mut self,
        sheet_id: SheetId,
        previous: &mut Option<SheetStore>,
        previous_cells: &mut rustc_hash::FxHashMap<cell_types::CellId, super::CellEntry>,
        previous_formulas: &mut rustc_hash::FxHashMap<
            cell_types::CellId,
            formula_types::IdentityFormula,
        >,
    ) {
        let current_payloads = self.take_sheet_payloads(sheet_id);
        let current = self.sheets.remove(&sheet_id);
        if let Some(sheet) = &current {
            self.sheet_names.remove(&normalize_sheet_key(&sheet.name));
        }
        self.cell_to_sheet.retain(|_, owner| *owner != sheet_id);
        self.row_to_sheet.retain(|_, owner| *owner != sheet_id);
        self.col_to_sheet.retain(|_, owner| *owner != sheet_id);
        self.row_run_sheets.retain(|_, owners| {
            owners.retain(|owner| *owner != sheet_id);
            !owners.is_empty()
        });
        self.col_run_sheets.retain(|_, owners| {
            owners.retain(|owner| *owner != sheet_id);
            !owners.is_empty()
        });
        self.dense_cache.remove_sheet(&sheet_id);
        self.col_versions.retain(|(owner, _), _| *owner != sheet_id);
        if let Some(mut sheet) = previous.take() {
            sheet.history = self.history.share();
            self.sheets.insert(sheet_id, sheet);
        }
        *previous = current;
        let current_payloads = {
            let restored_cells = std::mem::take(previous_cells);
            let restored_formulas = std::mem::take(previous_formulas);
            self.restore_sheet_payloads(restored_cells, restored_formulas);
            current_payloads
        };
        *previous_cells = current_payloads.0;
        *previous_formulas = current_payloads.1;
        self.history_rebuild_sheet(sheet_id);
    }

    pub(crate) fn history_rebuild_sheet(&mut self, sheet_id: SheetId) {
        self.projection_registry.clear();
        self.cell_to_sheet.retain(|_, owner| *owner != sheet_id);
        let Some(sheet) = self.sheets.get_mut(&sheet_id) else {
            return;
        };
        self.sheet_names
            .insert(normalize_sheet_key(&sheet.name), sheet_id);
        self.cell_to_sheet
            .extend(sheet.axes_by_cell.keys().map(|id| (*id, sheet_id)));
        sheet.generated_values.clear();
        sheet.projected_columns.clear();
        let rows = (sheet_id, sheet.row_axis.clone());
        let cols = (sheet_id, sheet.col_axis.clone());
        let extents: Vec<_> = sheet
            .range_views
            .values()
            .filter_map(|range| range.compute_extent(&rows, &cols))
            .collect();
        sheet.range_spatial_index = IntervalTree::build(&extents);
        sheet.rebuild_column_index(&self.cells, &self.formulas);
        let columns: Vec<_> = sheet.column_lengths.keys().copied().collect();
        self.refresh_axis_ownership(sheet_id);
        self.dense_cache.invalidate_sheet(&sheet_id);
        for col in columns {
            self.dense_cache.register_column(sheet_id, col);
            self.bump_col_version(&sheet_id, col);
        }
    }
}

impl CellStore {
    pub(crate) fn history_restore_cell(
        &mut self,
        sheet: SheetId,
        cell: cell_types::CellId,
        pos: Option<cell_types::SheetPos>,
        entry: Option<super::CellEntry>,
        formula: Option<formula_types::IdentityFormula>,
    ) {
        self.remove_cell(&cell);
        if let Some(pos) = pos {
            if let Some(entry) = entry {
                self.apply_edit(&sheet, cell, pos, entry.value, formula);
            } else if let Some(source) = self.sheets.get_mut(&sheet) {
                source.register_cell(cell, (pos).row(), (pos).col());
                self.cell_to_sheet.insert(cell, sheet);
            }
        }
    }
    pub(crate) fn history_invalidate_column(&mut self, sheet: SheetId, col: u32) {
        self.dense_cache.invalidate(&sheet, col);
        self.bump_col_version(&sheet, col);
    }
}

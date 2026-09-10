//! Canonical table updates and implicit structured-reference registration.

use super::*;

impl ComputeCore {
    /// Add or update a canonical table definition.
    pub fn set_table(
        &mut self,
        cell_store: &mut CellStore,
        table: domain_types::domain::table::Table,
    ) {
        cell_store.set_table(table);
        // CELL reads structured table formatting without a cell-value dependency.
        // Catalog changes must invalidate the clean full-recalculation fast path.
        self.mark_dirty();
    }

    /// Remove a table by name.
    pub fn remove_table(&mut self, cell_store: &mut CellStore, name: &str) {
        cell_store.remove_table(name);
        self.mark_dirty();
    }

    /// Re-parse formula cells in a given table range that contain implicit
    /// structured refs (`[@…]`), then recalc any that changed.
    ///
    /// Called after table creation to fix up formulas that were entered before
    /// the table existed (they would have been stored as `#NAME?`).
    pub fn reparse_implicit_structured_refs(
        &mut self,
        cell_store: &mut CellStore,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> RecalcResult {
        let sheet_hex = sheet_id.to_uuid_string();
        let cells_to_reparse: Vec<(CellId, String)> = self
            .cell_formula_text
            .iter()
            .filter_map(|(cell_id, formula)| {
                if !formula.contains("[@") {
                    return None;
                }
                let pos = cell_store.resolve_position(cell_id)?;
                let cell_sheet = cell_store.sheet_for_cell(cell_id)?;
                if cell_sheet.to_uuid_string() != sheet_hex {
                    return None;
                }
                if pos.row() >= start_row
                    && pos.row() <= end_row
                    && pos.col() >= start_col
                    && pos.col() <= end_col
                {
                    Some((*cell_id, formula.clone()))
                } else {
                    None
                }
            })
            .collect();

        if cells_to_reparse.is_empty() {
            return RecalcResult::empty();
        }

        let mut dirty = Vec::new();
        for (cell_id, formula) in cells_to_reparse {
            self.parse_and_register_formula(cell_store, cell_id, *sheet_id, formula, false);
            dirty.push(cell_id);
        }

        self.recalc(cell_store, &dirty)
            .unwrap_or_else(|_| RecalcResult::empty())
    }
}

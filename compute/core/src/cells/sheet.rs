//! Sheet-level CRUD operations for the cell store.

use cell_types::SheetId;

use super::cell_store::CellStore;
use super::sheet_key::normalize_sheet_key;

impl CellStore {
    /// Remove a sheet by SheetId.
    pub fn remove_sheet(&mut self, sheet: &SheetId) {
        if let Some(s) = self.sheets.remove(sheet) {
            self.dense_cache.remove_sheet(sheet);
            self.sheet_names.remove(&normalize_sheet_key(&s.name));
            let ids: Vec<_> = self
                .cell_to_sheet
                .iter()
                .filter(|(_, owner)| *owner == sheet)
                .map(|(id, _)| *id)
                .collect();
            for id in ids {
                self.cell_to_sheet.remove(&id);
                self.cells.remove(&id);
                self.formulas.remove(&id);
            }
            self.row_to_sheet.retain(|_, owner| owner != sheet);
            self.col_to_sheet.retain(|_, owner| owner != sheet);
            self.row_run_sheets.retain(|_, owners| {
                owners.retain(|owner| owner != sheet);
                !owners.is_empty()
            });
            self.col_run_sheets.retain(|_, owners| {
                owners.retain(|owner| owner != sheet);
                !owners.is_empty()
            });
            self.col_versions.retain(|(owner, _), _| owner != sheet);
        }
    }

    /// Rename a sheet.
    pub fn rename_sheet(&mut self, sheet: &SheetId, name: &str) {
        if let Some(s) = self.sheets.get_mut(sheet) {
            // Remove old name mapping
            self.sheet_names.remove(&normalize_sheet_key(&s.name));
            // Update sheet name
            s.name = name.to_string();
            // Insert new name mapping
            self.sheet_names.insert(normalize_sheet_key(name), *sheet);
        }
    }
}

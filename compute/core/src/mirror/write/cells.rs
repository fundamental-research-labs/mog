use cell_types::{CellId, SheetId, SheetPos};
use formula_types::IdentityFormula;
use value_types::CellValue;

use crate::mirror::cell_mirror::CellMirror;
use crate::mirror::types::{CellEdit, CellEntry};

impl CellMirror {
    /// Set the value of an existing cell (mutable, across all sheets).
    pub fn set_value_mut(&mut self, cell_id: &CellId, value: CellValue) -> bool {
        let sheet_id = match self.cell_to_sheet.get(cell_id).copied() {
            Some(sid) => sid,
            None => return false,
        };
        let mut updated_pos = None;
        if let Some(sheet) = self.sheets.get_mut(&sheet_id) {
            if sheet.cells.contains_key(cell_id) {
                if let Some(&pos) = sheet.id_to_pos.get(cell_id) {
                    #[cfg(feature = "journal")]
                    let (row, col) = (pos.row(), pos.col());
                    #[cfg(feature = "journal")]
                    let old_val_for_journal =
                        sheet.value_at(pos).cloned().unwrap_or(CellValue::Null);
                    sheet.note_column_position(pos);
                    sheet.consume_range_value(pos);
                    // Expand sheet dimensions so range materialisation sees the cells.
                    if pos.row() + 1 > sheet.rows {
                        sheet.rows = pos.row() + 1;
                    }
                    if pos.col() + 1 > sheet.cols {
                        sheet.cols = pos.col() + 1;
                    }
                    if pos.row() + 1 > sheet.grid_rows {
                        sheet.grid_rows = pos.row() + 1;
                    }
                    if pos.col() + 1 > sheet.grid_cols {
                        sheet.grid_cols = pos.col() + 1;
                    }
                    updated_pos = Some(pos);
                    #[cfg(feature = "journal")]
                    crate::journal_write!(
                        sheet_id,
                        row,
                        col,
                        &old_val_for_journal,
                        &value,
                        "set_value_mut",
                        Some(*cell_id)
                    );
                }
                let entry = sheet
                    .cells
                    .get_mut(cell_id)
                    .expect("cell existence checked before column write");
                entry.value = value;
            } else {
                return false;
            }
        } else {
            return false;
        }
        if let Some(pos) = updated_pos {
            let sheets = &self.sheets;
            self.dense_cache
                .update_cell(sheet_id, pos.col(), pos.row(), || {
                    sheets[&sheet_id].value_at(pos)
                });
            self.bump_col_version(&sheet_id, pos.col());
        }
        true
    }

    /// Set the formula of an existing cell (across all sheets).
    pub fn set_formula(&mut self, cell_id: &CellId, formula: Option<IdentityFormula>) -> bool {
        if let Some(sheet_id) = self.cell_to_sheet.get(cell_id)
            && let Some(sheet) = self.sheets.get_mut(sheet_id)
            && let Some(entry) = sheet.cells.get_mut(cell_id)
        {
            entry.formula = formula.map(Box::new);
            return true;
        }
        false
    }

    /// Insert or replace an identity-keyed cell, keeping both position indexes coherent.
    pub fn insert_cell(
        &mut self,
        sheet: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        entry: CellEntry,
    ) {
        if !self.sheets.contains_key(sheet) {
            return;
        }
        if let Some(old_sheet_id) = self
            .cell_to_sheet
            .get(&cell_id)
            .copied()
            .filter(|old| old != sheet)
        {
            let old_pos = if let Some(old_sheet) = self.sheets.get_mut(&old_sheet_id) {
                old_sheet.cells.remove(&cell_id);
                let old_pos = old_sheet.id_to_pos.remove(&cell_id);
                if let Some(old_pos) = old_pos {
                    if old_sheet.pos_to_id.get(&old_pos) == Some(&cell_id) {
                        old_sheet.pos_to_id.remove(&old_pos);
                    }
                    old_sheet.generated_values.remove(&old_pos);
                }
                old_pos
            } else {
                None
            };
            if let Some(old_pos) = old_pos {
                self.dense_cache.invalidate(&old_sheet_id, old_pos.col());
                self.bump_col_version(&old_sheet_id, old_pos.col());
            }
        }
        let mut previous_col = None;
        if let Some(s) = self.sheets.get_mut(sheet) {
            if let Some(old_pos) = s.id_to_pos.get(&cell_id).copied().filter(|old| *old != pos) {
                if s.pos_to_id.get(&old_pos) == Some(&cell_id) {
                    s.pos_to_id.remove(&old_pos);
                }
                s.generated_values.remove(&old_pos);
                previous_col = Some(old_pos.col());
            }
            if !entry.is_ghost() || cell_id.is_virtual() {
                s.consume_range_value(pos);
            }
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet);
            s.note_column_position(pos);
            s.expand_extent(pos);
        }
        if let Some(col) = previous_col {
            self.dense_cache.invalidate(sheet, col);
            self.dense_cache.invalidate(sheet, pos.col());
            if col != pos.col() {
                self.bump_col_version(sheet, col);
            }
        } else {
            let sheets = &self.sheets;
            self.dense_cache
                .update_cell(*sheet, pos.col(), pos.row(), || sheets[sheet].value_at(pos));
        }
        self.bump_col_version(sheet, pos.col());
    }

    /// Move a cell identity and any authored entry without cloning its value or formula.
    /// Returns false when the cell or destination sheet does not exist.
    pub fn move_cell(
        &mut self,
        cell_id: &CellId,
        destination_sheet: &SheetId,
        pos: SheetPos,
    ) -> bool {
        if !self.sheets.contains_key(destination_sheet) {
            return false;
        }
        let Some(source_sheet) = self.cell_to_sheet.get(cell_id).copied() else {
            return false;
        };
        let entry = self
            .sheets
            .get_mut(&source_sheet)
            .and_then(|sheet| sheet.cells.remove(cell_id));
        if let Some(entry) = entry {
            self.insert_cell(destination_sheet, *cell_id, pos, entry);
        } else {
            let Some(source) = self.sheets.get_mut(&source_sheet) else {
                return false;
            };
            let Some(old_pos) = source.id_to_pos.remove(cell_id) else {
                return false;
            };
            if source.pos_to_id.get(&old_pos) == Some(cell_id) {
                source.pos_to_id.remove(&old_pos);
            }
            let destination = self.sheets.get_mut(destination_sheet).unwrap();
            destination.id_to_pos.insert(*cell_id, pos);
            destination.pos_to_id.insert(pos, *cell_id);
            destination.expand_identity_extent(pos);
            self.cell_to_sheet.insert(*cell_id, *destination_sheet);
        }
        true
    }

    /// Remove an authored entry; consumed imported values stay cleared.
    pub fn remove_cell(&mut self, cell_id: &CellId) {
        let Some(sheet_id) = self.cell_to_sheet.remove(cell_id) else {
            return;
        };
        let Some(sheet) = self.sheets.get_mut(&sheet_id) else {
            return;
        };
        sheet.cells.remove(cell_id);
        let pos = sheet.id_to_pos.remove(cell_id);
        if let Some(pos) = pos {
            if sheet.pos_to_id.get(&pos) == Some(cell_id) {
                sheet.pos_to_id.remove(&pos);
            }
            sheet.generated_values.remove(&pos);
            self.dense_cache.invalidate(&sheet_id, pos.col());
            self.bump_col_version(&sheet_id, pos.col());
        }
    }

    /// Apply a single cell edit (upsert).
    ///
    /// Silently ignored if the sheet does not exist.
    pub fn apply_edit(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        value: CellValue,
        formula: Option<IdentityFormula>,
    ) {
        self.insert_cell(
            sheet_id,
            cell_id,
            pos,
            CellEntry {
                value,
                formula: formula.map(Box::new),
            },
        );
    }

    /// Apply a batch of edits.
    pub fn apply_edits(&mut self, edits: &[CellEdit]) {
        for edit in edits {
            self.apply_edit(
                &edit.sheet,
                edit.cell,
                edit.pos,
                edit.value.clone(),
                edit.formula.clone(),
            );
        }
    }
}

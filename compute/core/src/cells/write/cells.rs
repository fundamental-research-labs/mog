use cell_types::{CellId, SheetId, SheetPos};
use formula_types::IdentityFormula;
use value_types::CellValue;

use crate::cells::cell_store::CellStore;
use crate::cells::types::{CellEdit, CellEntry};

impl CellStore {
    /// Set the value of an existing cell (mutable, across all sheets).
    pub fn set_value_mut(&mut self, cell_id: &CellId, value: CellValue) -> bool {
        if !self.cells.contains_key(cell_id) {
            return false;
        }
        let sheet_id = match self.cell_to_sheet.get(cell_id).copied() {
            Some(sid) => sid,
            None => return false,
        };
        let mut updated_pos = None;
        if let Some(sheet) = self.sheets.get_mut(&sheet_id) {
            if let Some(pos) = sheet.position_of(cell_id) {
                #[cfg(feature = "journal")]
                let (row, col) = (pos.row(), pos.col());
                #[cfg(feature = "journal")]
                let old_val_for_journal = {
                    let cells = &self.cells;
                    let formulas = &self.formulas;
                    sheet
                        .value_at(pos, cells, formulas)
                        .cloned()
                        .unwrap_or(CellValue::Null)
                };
                sheet.note_column_position(pos);
                sheet.consume_range_value(pos);
                sheet.expand_extent(pos);
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
        } else {
            return false;
        }
        self.cells
            .get_mut(cell_id)
            .expect("cell existence checked before column write")
            .value = value;
        if let Some(pos) = updated_pos {
            let value_at = self.sheets[&sheet_id].value_at(pos, &self.cells, &self.formulas);
            self.dense_cache
                .update_cell(sheet_id, pos.col(), pos.row(), || value_at);
            self.bump_col_version(&sheet_id, pos.col());
        }
        true
    }

    /// Set the formula of an existing cell (across all sheets).
    pub fn set_formula(&mut self, cell_id: &CellId, formula: Option<IdentityFormula>) -> bool {
        if !self.cells.contains_key(cell_id) {
            return false;
        }
        if let Some(formula) = formula {
            self.formulas.insert(*cell_id, formula);
        } else {
            self.formulas.remove(cell_id);
        }
        true
    }

    /// Insert or replace a value and clear any previous formula.
    pub fn insert_cell(
        &mut self,
        sheet: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        entry: CellEntry,
    ) {
        self.insert_cell_with_formula(sheet, cell_id, pos, entry, None);
    }

    fn insert_cell_with_formula(
        &mut self,
        sheet: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        entry: CellEntry,
        formula: Option<IdentityFormula>,
    ) {
        if !self.sheets.contains_key(sheet) {
            return;
        }
        if let Some(displaced) = self.sheets[sheet]
            .authored_cell_id_at(pos)
            .filter(|id| *id != cell_id)
        {
            self.remove_cell(&displaced);
        }
        if let Some(old_sheet_id) = self
            .cell_to_sheet
            .get(&cell_id)
            .copied()
            .filter(|old| old != sheet)
        {
            self.cells.remove(&cell_id);
            self.formulas.remove(&cell_id);
            let old_pos = if let Some(old_sheet) = self.sheets.get_mut(&old_sheet_id) {
                let old_pos = old_sheet.remove_cell_identity(&cell_id);
                if let Some(old_pos) = old_pos {
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
        let grew = self.sheets[sheet].row_id_at(pos.row()).is_none()
            || self.sheets[sheet].col_id_at(pos.col()).is_none();
        if let Some(s) = self.sheets.get_mut(sheet) {
            if let Some(old_pos) = s.position_of(&cell_id).filter(|old| *old != pos) {
                s.remove_cell_identity(&cell_id);
                s.generated_values.remove(&old_pos);
                previous_col = Some(old_pos.col());
            }
            if !entry.value.is_null() || formula.is_some() || cell_id.is_virtual() {
                s.consume_range_value(pos);
            }
            s.register_cell(cell_id, (pos).row(), (pos).col());
            s.note_column_position(pos);
            s.expand_extent(pos);
        }
        self.cells.insert(cell_id, entry);
        if let Some(formula) = formula {
            self.formulas.insert(cell_id, formula);
        } else {
            self.formulas.remove(&cell_id);
        }
        self.cell_to_sheet.insert(cell_id, *sheet);
        if grew {
            self.refresh_axis_ownership(*sheet);
        }
        if let Some(col) = previous_col {
            self.dense_cache.invalidate(sheet, col);
            self.dense_cache.invalidate(sheet, pos.col());
            if col != pos.col() {
                self.bump_col_version(sheet, col);
            }
        } else {
            let value_at = self.sheets[sheet].value_at(pos, &self.cells, &self.formulas);
            self.dense_cache
                .update_cell(*sheet, pos.col(), pos.row(), || value_at);
        }
        self.bump_col_version(sheet, pos.col());
    }

    /// Relocate all source identities together so overlapping moves preserve values.
    pub fn move_cells(&mut self, moves: &[(CellId, SheetId, SheetPos)]) {
        let mut carried = Vec::with_capacity(moves.len());
        for &(cell_id, destination, pos) in moves {
            if !self.sheets.contains_key(&destination) {
                continue;
            }
            let Some(source_id) = self.cell_to_sheet.get(&cell_id).copied() else {
                continue;
            };
            let Some(source) = self.sheets.get(&source_id) else {
                continue;
            };
            let Some(source_pos) = source.position_of(&cell_id) else {
                continue;
            };
            // A reference-only ghost can expose an imported or generated value.
            // Capture that value before consuming its source; authored arrays and
            // formula results keep their full resident entry.
            let inherited = source
                .is_ghost(&cell_id, &self.cells, &self.formulas)
                .then(|| {
                    source
                        .value_at(source_pos, &self.cells, &self.formulas)
                        .filter(|value| !value.is_null())
                        .cloned()
                })
                .flatten();
            if let Some(source) = self.sheets.get_mut(&source_id) {
                source.consume_range_value(source_pos);
            }
            let entry = self.cells.remove(&cell_id);
            let entry = inherited.map(|value| CellEntry { value }).or(entry);
            let formula = self.formulas.remove(&cell_id);
            carried.push((cell_id, destination, pos, entry, formula));
        }
        // Clear every source before inserting a destination; permutations may overlap.
        for (cell, _, _, _, _) in &carried {
            self.remove_cell(cell);
        }
        for (cell, destination, pos, entry, formula) in carried {
            if let Some(entry) = entry {
                self.insert_cell_with_formula(&destination, cell, pos, entry, formula);
            } else {
                self.register_identity_position(destination, pos, cell);
            }
        }
    }

    /// Move an identity with its value and optional formula.
    pub fn move_cell(&mut self, cell_id: &CellId, destination: &SheetId, pos: SheetPos) -> bool {
        if !self.sheets.contains_key(destination) || self.resolve_position(cell_id).is_none() {
            return false;
        }
        self.move_cells(&[(*cell_id, *destination, pos)]);
        true
    }

    /// Remove an authored entry; consumed imported values stay cleared.
    pub fn remove_cell(&mut self, cell_id: &CellId) {
        let Some(sheet_id) = self.cell_to_sheet.remove(cell_id) else {
            return;
        };
        self.cells.remove(cell_id);
        self.formulas.remove(cell_id);
        let Some(sheet) = self.sheets.get_mut(&sheet_id) else {
            return;
        };
        let pos = sheet.remove_cell_identity(cell_id);
        if let Some(pos) = pos {
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
        self.insert_cell_with_formula(sheet_id, cell_id, pos, CellEntry { value }, formula);
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

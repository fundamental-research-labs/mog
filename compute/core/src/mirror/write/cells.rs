use cell_types::{CellId, SheetId, SheetPos};
use formula_types::IdentityFormula;
use value_types::CellValue;

use super::{clear_col_value, write_col_value};
use crate::mirror::cell_mirror::CellMirror;
use crate::mirror::types::{CellEdit, CellEntry};

impl CellMirror {
    /// Set the value of an existing cell (mutable, across all sheets).
    pub fn set_value_mut(&mut self, cell_id: &CellId, value: CellValue) -> bool {
        let sheet_id = match self.cell_to_sheet.get(cell_id).copied() {
            Some(sid) => sid,
            None => return false,
        };
        let mut invalidate_col: Option<u32> = None;
        if let Some(sheet) = self.sheets.get_mut(&sheet_id) {
            if sheet.cells.contains_key(cell_id) {
                if let Some(&pos) = sheet.id_to_pos.get(cell_id) {
                    let (row, col) = (pos.row(), pos.col());
                    #[cfg(feature = "journal")]
                    let old_val_for_journal = write_col_value(sheet, pos, value.clone());
                    #[cfg(not(feature = "journal"))]
                    write_col_value(sheet, pos, value.clone());
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
                    invalidate_col = Some(col);
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
        if let Some(col) = invalidate_col {
            self.dense_cache.invalidate(&sheet_id, col);
            self.bump_col_version(&sheet_id, col);
        }
        true
    }

    /// Set the CellEntry.value without updating col_data.
    ///
    /// Used by dynamic array spill handling to store the full `CellValue::Array` in the
    /// source cell's entry while col_data retains the top-left scalar for aggregation
    /// reads. Normal writes should use `set_value_mut` which updates both.
    pub fn set_entry_value_only(&mut self, cell_id: &CellId, value: CellValue) -> bool {
        if let Some(sheet_id) = self.cell_to_sheet.get(cell_id)
            && let Some(sheet) = self.sheets.get_mut(sheet_id)
            && let Some(entry) = sheet.cells.get_mut(cell_id)
        {
            #[cfg(feature = "journal")]
            {
                let old_val = crate::journal::journal_fmt_value(&entry.value);
                let new_val = crate::journal::journal_fmt_value(&value);
                crate::journal::record(crate::journal::JournalEvent::EntryWrite {
                    cell: *cell_id,
                    field: "value",
                    old_value: old_val,
                    new_value: new_val,
                    source: "set_entry_value_only",
                });
            }
            entry.value = value;
            return true;
        }
        false
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

    /// Insert a cell into a specific sheet at the given position.
    ///
    /// Silently ignored if the sheet does not exist.
    pub fn insert_cell(
        &mut self,
        sheet: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        entry: CellEntry,
    ) {
        if let Some(s) = self.sheets.get_mut(sheet) {
            write_col_value(s, pos, entry.value.clone());
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet);
            s.expand_extent(pos);
        }
        // Invalidate dense column cache for the affected column.
        self.dense_cache.invalidate(sheet, pos.col());
        self.bump_col_version(sheet, pos.col());
    }

    /// Remove a cell by CellId (across all sheets).
    pub fn remove_cell(&mut self, cell_id: &CellId) {
        let mut invalidate_info: Option<(SheetId, u32)> = None;
        for (sheet_id, sheet) in self.sheets.iter_mut() {
            if sheet.cells.remove(cell_id).is_some() {
                if let Some(pos) = sheet.id_to_pos.remove(cell_id) {
                    sheet.pos_to_id.remove(&pos);
                    clear_col_value(sheet, pos);
                    // If this column has Range-backed data, rebuild col_data so
                    // the payload value is restored instead of leaving Null.
                    // For non-Range columns this returns early (no-op).
                    sheet.rebuild_col_data(pos.col());
                    invalidate_info = Some((*sheet_id, pos.col()));
                }
                break;
            }
        }
        self.cell_to_sheet.remove(cell_id);
        if let Some((sheet_id, col)) = invalidate_info {
            self.dense_cache.invalidate(&sheet_id, col);
            self.bump_col_version(&sheet_id, col);
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
        let entry = CellEntry {
            value: value.clone(),
            formula: formula.map(Box::new),
        };
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet_id);
            write_col_value(s, pos, value);
            s.expand_extent(pos);

            // If this position is inside a Range, track it as an override so
            // the compaction threshold stays accurate.
            let owning_range_id = s
                .range_spatial_index
                .query(pos.row(), pos.col())
                .first()
                .map(|ext| ext.range_id);
            if let Some(range_id) = owning_range_id
                && let (Some(row_id), Some(col_id)) = (
                    s.index_to_row.get(&pos.row()).copied(),
                    s.index_to_col.get(&pos.col()).copied(),
                )
                && let Some(rv) = s.range_views.get_mut(&range_id)
            {
                rv.overrides.insert((row_id, col_id), cell_id);
                rv.override_count = rv.overrides.len() as u32;
            }
        }
        // Invalidate dense column cache for the affected column.
        self.dense_cache.invalidate(sheet_id, pos.col());
        self.bump_col_version(sheet_id, pos.col());
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

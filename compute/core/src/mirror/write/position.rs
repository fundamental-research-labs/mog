use cell_types::{CellId, SheetId, SheetPos};

use crate::mirror::cell_mirror::CellMirror;

impl CellMirror {
    /// Remove an obsolete position mapping and generated value after relocation.
    /// The identity and its current destination remain intact.
    pub fn vacate_position(&mut self, sheet_id: &SheetId, pos: SheetPos) {
        let mut invalidate_col: Option<u32> = None;
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            // Drop the position->id mapping. Don't touch id_to_pos / cells:
            // those already point at the moved cell's new position.
            if s.pos_to_id.remove(&pos).is_some() {
                invalidate_col = Some(pos.col());
            }
            if s.generated_values.remove(&pos).is_some() {
                invalidate_col = Some(pos.col());
            }
            // Rebuild only position metadata; values remain with their owners.
            s.rebuild_column_index();
        }
        if let Some(col) = invalidate_col {
            self.dense_cache.invalidate(sheet_id, col);
            self.bump_col_version(sheet_id, col);
        }
    }

    /// Update a cell's reverse position mapping during relocation.
    pub fn update_id_to_pos(&mut self, sheet_id: &SheetId, cell_id: CellId, new_pos: SheetPos) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.id_to_pos.insert(cell_id, new_pos);
        }
    }

    /// Register the current position of an existing identity and invalidate its column.
    pub fn sync_cell_position_mapping(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
    ) {
        let mut invalidate_col = false;
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet_id);

            if s.cells.contains_key(&cell_id) {
                s.note_column_position(pos);
                invalidate_col = true;
            }

            s.expand_extent(pos);
        }

        if invalidate_col {
            self.dense_cache.invalidate(sheet_id, pos.col());
            self.bump_col_version(sheet_id, pos.col());
        }
    }
}

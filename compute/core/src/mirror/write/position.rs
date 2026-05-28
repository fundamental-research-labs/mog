use cell_types::{CellId, SheetId, SheetPos};

use super::{clear_col_value, write_col_value};
use crate::mirror::cell_mirror::CellMirror;

impl CellMirror {
    /// Clear the mirror's position-keyed state at `pos` on `sheet_id` without
    /// disturbing the CellId-keyed maps. Used by same-sheet `relocate_cells`,
    /// where a moved CellId now lives at a NEW position but the OLD position
    /// still holds stale entries in `pos_to_id` / `col_data` because
    /// `apply_edit` only writes the destination side. `id_to_pos` and `cells`
    /// already reflect the new position (the move's `apply_edit` overwrote
    /// them) and must NOT be touched here - the cell hasn't been deleted,
    /// just relocated.
    ///
    /// No-op if the position holds no entry.
    pub fn vacate_position(&mut self, sheet_id: &SheetId, pos: SheetPos) {
        let mut invalidate_col: Option<u32> = None;
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            // Drop the position->id mapping. Don't touch id_to_pos / cells:
            // those already point at the moved cell's new position.
            if s.pos_to_id.remove(&pos).is_some() {
                invalidate_col = Some(pos.col());
            }
            if clear_col_value(s, pos) {
                invalidate_col = Some(pos.col());
            }
            // If this column has Range-backed data, rebuild col_data so
            // the payload value is restored instead of leaving Null.
            // For non-Range columns this returns early (no-op).
            s.rebuild_col_data(pos.col());
        }
        if let Some(col) = invalidate_col {
            self.dense_cache.invalidate(sheet_id, col);
            self.bump_col_version(sheet_id, col);
        }
    }

    /// Update the id_to_pos entry for a cell without touching pos_to_id or
    /// col_data.  Used after a yrs gridIndex change is detected (e.g. undo of
    /// same-sheet relocate_cells) to pre-warm the mirror position so that
    /// apply_cell_changes resolves the correct new position when it runs.
    ///
    /// Callers should call `vacate_position(old_pos)` first to clean up the
    /// stale pos_to_id / col_data slot at the former position.
    pub fn update_id_to_pos(&mut self, sheet_id: &SheetId, cell_id: CellId, new_pos: SheetPos) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.id_to_pos.insert(cell_id, new_pos);
        }
    }

    /// Synchronize the position-keyed mirror state for an existing CellId after
    /// a yrs gridIndex-only move. Cell payloads are keyed by CellId and may not
    /// fire a separate cell observer event, so position-only undo/redo still
    /// needs to repopulate `pos_to_id` and `col_data` from the existing entry.
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

            if let Some(value) = s.cells.get(&cell_id).map(|entry| entry.value.clone()) {
                write_col_value(s, pos, value);
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

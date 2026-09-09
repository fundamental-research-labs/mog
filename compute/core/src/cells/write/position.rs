use cell_types::{SheetId, SheetPos};

use crate::cells::cell_store::CellStore;

impl CellStore {
    /// Remove an obsolete position mapping and generated value after relocation.
    /// The identity and its current destination remain intact.
    pub fn vacate_position(&mut self, sheet_id: &SheetId, pos: SheetPos) {
        let mut invalidate_col: Option<u32> = None;
        if let Some(s) = self.sheets.get_mut(sheet_id) {
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
}

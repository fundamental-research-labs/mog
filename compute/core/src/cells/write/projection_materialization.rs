use cell_types::{SheetId, SheetPos};
use value_types::CellValue;

use crate::cells::cell_store::CellStore;

impl CellStore {
    /// Register borrowed columns of the source array for every read path.
    /// Each column shares the source Arc; no projected CellValues are copied.
    /// The origin remains owned by the source cell.
    pub fn materialize_projection(
        &mut self,
        sheet: &SheetId,
        origin_row: u32,
        origin_col: u32,
        array: &CellValue,
    ) {
        let (arr_rows, arr_cols) = match array {
            CellValue::Array(arr) => (arr.rows(), arr.cols()),
            _other => {
                return;
            }
        };

        if arr_rows == 0 || arr_cols == 0 {
            return;
        }

        // Collect columns touched so we can invalidate caches after releasing sheet borrow
        let mut cols_touched = Vec::new();

        if let Some(sheet_store) = self.sheets.get_mut(sheet) {
            if let CellValue::Array(array) = array {
                for c in 0..arr_cols {
                    let col = origin_col + c as u32;
                    let projections = sheet_store.projected_columns.entry(col).or_default();
                    projections
                        .retain(|p| p.origin_row != origin_row || p.origin_col != origin_col);
                    projections.push(crate::cells::types::ProjectionColumn {
                        origin_row,
                        origin_col,
                        array_col: c,
                        array: array.clone(),
                    });
                    sheet_store
                        .note_column_position(SheetPos::new(origin_row + arr_rows as u32 - 1, col));
                    cols_touched.push(col);
                }
            }

            // Expand sheet dimensions to encompass projection extent so that
            // range reads (get_range_values / resolve_range_to_key) don't clamp
            // cross-sheet references to the pre-spill sheet size.
            // expand_extent uses pos.row + 1, so pass max - 1 to get equivalent result
            let max_row_needed = origin_row + arr_rows as u32;
            let max_col_needed = origin_col + arr_cols as u32;
            if max_row_needed > 0 && max_col_needed > 0 {
                sheet_store.expand_extent(SheetPos::new(max_row_needed - 1, max_col_needed - 1));
            }
        }

        // Invalidate caches outside the sheet borrow
        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::CacheInvalidate {
                    tier: "dense_cache",
                    sheet: *sheet,
                    col,
                    reason: "materialize_projection",
                });
            }
        }
    }

    /// Remove borrowed projection columns when a spill changes or is cleared.
    /// Called when projection shrinks, moves, or source is cleared.
    /// The origin cell (0,0) is skipped - the source cell keeps its value.
    pub fn clear_materialization(
        &mut self,
        sheet: &SheetId,
        origin_row: u32,
        origin_col: u32,
        _rows: u32,
        cols: u32,
    ) {
        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::ProjectionClear {
                source: cell_types::CellId::from_raw(0),
                origin: (origin_row, origin_col),
                size: (_rows, cols),
            });
        }

        // Collect columns touched so we can invalidate caches after releasing sheet borrow
        let mut cols_touched = Vec::new();

        if let Some(sheet_store) = self.sheets.get_mut(sheet) {
            for c in 0..cols {
                let col = origin_col + c;
                if let Some(projections) = sheet_store.projected_columns.get_mut(&col) {
                    projections
                        .retain(|p| p.origin_row != origin_row || p.origin_col != origin_col);
                }
                cols_touched.push(col);
            }
        }

        // Invalidate caches outside the sheet borrow
        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::CacheInvalidate {
                    tier: "dense_cache",
                    sheet: *sheet,
                    col,
                    reason: "clear_materialization",
                });
            }
        }
    }
}

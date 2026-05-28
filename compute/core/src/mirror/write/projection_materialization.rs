use cell_types::{SheetId, SheetPos};
use value_types::CellValue;

use crate::mirror::cell_mirror::CellMirror;

impl CellMirror {
    /// Batch-materialize an array's projected values into col_data.
    /// This makes projected values visible to ALL read paths (DenseColumn, LookupIndex, range_store).
    /// The origin cell (0,0) is skipped - it already has its value set by the source cell.
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

        // Collect columns touched so we can invalidate caches after releasing sheet borrow
        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            for c in 0..arr_cols {
                let col = origin_col + c as u32;
                // Ensure col_data entry exists, sized to fit both sheet rows and projection extent
                let num_rows = sheet_mirror.rows as usize;
                let max_needed = (origin_row + arr_rows as u32) as usize;
                let target_len = std::cmp::max(num_rows, max_needed);
                let col_vec = sheet_mirror
                    .col_data
                    .entry(col)
                    .or_insert_with(|| vec![CellValue::Null; target_len]);
                // Extend if needed to fit projection extent
                if col_vec.len() < target_len {
                    col_vec.resize(target_len, CellValue::Null);
                }

                for r in 0..arr_rows {
                    let row = origin_row + r as u32;
                    // Skip origin cell - that's the source cell, already has its value
                    if r == 0 && c == 0 {
                        continue;
                    }
                    if (row as usize) < col_vec.len()
                        && let CellValue::Array(arr) = array
                        && let Some(val) = arr.get(r, c)
                    {
                        col_vec[row as usize] = val.clone();
                    }
                }

                cols_touched.push(col);
            }

            // Expand sheet dimensions to encompass projection extent so that
            // range reads (get_range_values / resolve_range_to_key) don't clamp
            // cross-sheet references to the pre-spill sheet size.
            // expand_extent uses pos.row + 1, so pass max - 1 to get equivalent result
            let max_row_needed = origin_row + arr_rows as u32;
            let max_col_needed = origin_col + arr_cols as u32;
            if max_row_needed > 0 && max_col_needed > 0 {
                sheet_mirror.expand_extent(SheetPos::new(max_row_needed - 1, max_col_needed - 1));
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

    /// Clear materialized projection values from col_data.
    /// Called when projection shrinks, moves, or source is cleared.
    /// The origin cell (0,0) is skipped - the source cell keeps its value.
    pub fn clear_materialization(
        &mut self,
        sheet: &SheetId,
        origin_row: u32,
        origin_col: u32,
        rows: u32,
        cols: u32,
    ) {
        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::ProjectionClear {
                source: cell_types::CellId::from_raw(0),
                origin: (origin_row, origin_col),
                size: (rows, cols),
            });
        }

        // Collect columns touched so we can invalidate caches after releasing sheet borrow
        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            for c in 0..cols {
                let col = origin_col + c;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col) {
                    for r in 0..rows {
                        let row = origin_row + r;
                        // Skip origin (source cell keeps its value)
                        if r == 0 && c == 0 {
                            continue;
                        }
                        if (row as usize) < col_vec.len() {
                            col_vec[row as usize] = CellValue::Null;
                        }
                    }
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

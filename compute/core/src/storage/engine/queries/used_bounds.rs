//! Used-range bounds include authored formatting without expanding formatted
//! rectangles into millions of blank cells.
use super::super::ComputeEngine;
use crate::engine_types::RectBounds;
use cell_types::SheetId;

impl ComputeEngine {
    pub fn used_range_bounds(
        &self,
        sheet_id: &SheetId,
        scope: (u32, u32, u32, u32),
        values_only: bool,
    ) -> Option<RectBounds> {
        let mut result: Option<RectBounds> = None;
        let mut include = |sr: u32, sc: u32, er: u32, ec: u32| {
            let (sr, sc, er, ec) = (
                sr.max(scope.0),
                sc.max(scope.1),
                er.min(scope.2),
                ec.min(scope.3),
            );
            if sr > er || sc > ec {
                return;
            }
            if let Some(bounds) = &mut result {
                bounds.start_row = bounds.start_row.min(sr);
                bounds.start_col = bounds.start_col.min(sc);
                bounds.end_row = bounds.end_row.max(er);
                bounds.end_col = bounds.end_col.max(ec);
            } else {
                result = Some(RectBounds {
                    start_row: sr,
                    start_col: sc,
                    end_row: er,
                    end_col: ec,
                });
            }
        };
        let sheet = self.cell_store.get_sheet(sheet_id)?;
        if let Some((sr, sc, er, ec)) = sheet.dense_content_bounds_in_range(
            &self.cell_store.cells,
            &self.cell_store.formulas,
            scope,
        ) {
            include(sr, sc, er, ec);
        }
        for (cell_id, row, col) in sheet.cells_in_range(scope.0, scope.1, scope.2, scope.3) {
            if !self.cell_store.is_ghost(&cell_id)
                || (!values_only
                    && !self
                        .query_range(sheet_id, row, col, row, col)
                        .cells
                        .is_empty())
            {
                include(row, col, row, col);
            }
        }
        if !values_only {
            let sheet = self.cell_store.get_sheet(sheet_id)?;
            for range in sheet.format_ranges() {
                include(
                    range.start_row,
                    range.start_col,
                    range.end_row,
                    range.end_col,
                );
            }
            for range in sheet.col_format_ranges() {
                include(0, range.start_col, 1_048_575, range.end_col);
            }
            let grid = self.stores.grid_indexes.get(sheet_id);
            for entry in crate::storage::properties::get_all_row_formats(
                &self.stores.storage,
                sheet_id,
                grid,
            ) {
                include(entry.row, 0, entry.row, 16_383);
            }
            for entry in crate::storage::properties::get_all_col_formats(
                &self.stores.storage,
                sheet_id,
                grid,
            ) {
                include(0, entry.col, 1_048_575, entry.col);
            }
            for (sr, sc, er, ec) in crate::storage::sheet::merges::iter_merge_bounds(
                &self.stores.storage,
                *sheet_id,
                sheet,
            ) {
                include(sr, sc, er, ec);
            }
        }
        result
    }
}

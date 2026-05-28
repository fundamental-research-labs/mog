use cell_types::{CellId, SheetId};

use crate::mirror::cell_mirror::CellMirror;
use crate::mirror::types::MergeRegion;

impl CellMirror {
    /// Set merge regions for a sheet (replaces all existing).
    pub fn set_merge_regions(&mut self, sheet_id: &SheetId, regions: Vec<MergeRegion>) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.merge_regions = regions;
        }
    }

    /// Add a single merge region to a sheet.
    pub fn add_merge_region(&mut self, sheet_id: &SheetId, region: MergeRegion) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.merge_regions.push(region);
        }
    }

    /// Remove a merge region from a sheet by matching bounds.
    pub fn remove_merge_region(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.merge_regions.retain(|r| {
                !(r.start_row == start_row
                    && r.start_col == start_col
                    && r.end_row == end_row
                    && r.end_col == end_col)
            });
        }
    }

    /// Set the custom height for a row.
    pub fn set_row_height(&mut self, sheet_id: &SheetId, row: u32, height: f64) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.row_heights.insert(row, height);
        }
    }

    /// Remove a custom row height (revert to default).
    pub fn remove_row_height(&mut self, sheet_id: &SheetId, row: u32) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.row_heights.remove(&row);
        }
    }

    /// Set the custom width for a column.
    pub fn set_col_width(&mut self, sheet_id: &SheetId, col: u32, width: f64) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.col_widths.insert(col, width);
        }
    }

    /// Remove a custom column width (revert to default).
    pub fn remove_col_width(&mut self, sheet_id: &SheetId, col: u32) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.col_widths.remove(&col);
        }
    }

    /// Set a row as hidden or visible.
    pub fn set_row_hidden(&mut self, sheet_id: &SheetId, row: u32, hidden: bool) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            if hidden {
                s.hidden_rows.insert(row);
            } else {
                s.hidden_rows.remove(&row);
            }
        }
    }

    /// Set a column as hidden or visible.
    pub fn set_col_hidden(&mut self, sheet_id: &SheetId, col: u32, hidden: bool) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            if hidden {
                s.hidden_cols.insert(col);
            } else {
                s.hidden_cols.remove(&col);
            }
        }
    }

    /// Mark a cell as having a comment.
    pub fn set_comment(&mut self, sheet_id: &SheetId, cell_id: CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.comment_cells.insert(cell_id);
        }
    }

    /// Remove the comment indicator for a cell.
    pub fn remove_comment(&mut self, sheet_id: &SheetId, cell_id: &CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.comment_cells.remove(cell_id);
        }
    }

    /// Mark a cell as having a sparkline.
    pub fn set_sparkline(&mut self, sheet_id: &SheetId, cell_id: CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.sparkline_cells.insert(cell_id);
        }
    }

    /// Remove the sparkline indicator for a cell.
    pub fn remove_sparkline(&mut self, sheet_id: &SheetId, cell_id: &CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.sparkline_cells.remove(cell_id);
        }
    }
}

use cell_types::{SheetId, SheetPos};
use value_types::CellValue;

use crate::mirror::cell_mirror::CellMirror;

impl CellMirror {
    /// Clear a rectangular region in col_data, setting all cells to Null.
    /// Used to wipe previously materialized pivot output before re-rendering.
    pub fn clear_pivot_region(
        &mut self,
        sheet: &SheetId,
        anchor_row: u32,
        anchor_col: u32,
        total_rows: u32,
        total_cols: u32,
    ) {
        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            for c in 0..total_cols {
                let col = anchor_col + c;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col) {
                    for r in 0..total_rows {
                        let row = (anchor_row + r) as usize;
                        if row < col_vec.len() {
                            col_vec[row] = CellValue::Null;
                        }
                    }
                    cols_touched.push(col);
                }
            }
        }

        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
        }
    }

    /// Materialize a computed pivot table result into col_data cells.
    /// Writes column headers, row headers, data values, and grand totals.
    pub fn materialize_pivot(
        &mut self,
        sheet: &SheetId,
        anchor_row: u32,
        anchor_col: u32,
        result: &compute_pivot::types::PivotTableResult,
        row_field_names: &[String],
    ) {
        let bounds = &result.rendered_bounds;
        let first_data_row = bounds.first_data_row;
        let first_data_col = bounds.first_data_col;
        let total_rows = bounds.total_rows;
        let total_cols = bounds.total_cols;

        if total_rows == 0 || total_cols == 0 {
            return;
        }

        // Derive the number of value fields from the grand totals structure.
        // Do NOT use rows[0].values.len() - that includes column-leaf expansion
        // (e.g., 3 column leaves x 2 value fields = 6), but grand_totals.column
        // and grand_totals.grand are indexed by value field only.
        let num_value_fields = result
            .grand_totals
            .grand
            .as_ref()
            .map(|g| g.len().max(1))
            .or_else(|| {
                result
                    .grand_totals
                    .column
                    .as_ref()
                    .and_then(|c| c.first().map(|row| row.len().max(1)))
            })
            .unwrap_or(1) as u32;

        let num_data_cols = result.rendered_bounds.num_data_cols;

        debug_assert!(
            row_field_names.is_empty() || first_data_row >= 1,
            "row field labels need a header row reserved (got first_data_row={}, row_field_names={:?})",
            first_data_row,
            row_field_names,
        );
        debug_assert!(
            result.grand_totals.row.is_none()
                || total_rows > first_data_row + result.rows.len() as u32,
            "GT row not reserved in total_rows (total_rows={}, first_data_row={}, rows={})",
            total_rows,
            first_data_row,
            result.rows.len(),
        );
        debug_assert!(
            result.grand_totals.column.is_none()
                || total_cols >= first_data_col + num_data_cols + num_value_fields.max(1),
            "GT column not reserved in total_cols (total_cols={}, first_data_col={}, num_data_cols={}, num_value_fields={})",
            total_cols,
            first_data_col,
            num_data_cols,
            num_value_fields,
        );

        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            let num_rows = sheet_mirror.rows as usize;
            let max_needed = (anchor_row + total_rows) as usize;
            let target_len = std::cmp::max(num_rows, max_needed);

            // Ensure all columns exist and are sized
            for c in 0..total_cols {
                let col = anchor_col + c;
                let col_vec = sheet_mirror
                    .col_data
                    .entry(col)
                    .or_insert_with(|| vec![CellValue::Null; target_len]);
                if col_vec.len() < target_len {
                    col_vec.resize(target_len, CellValue::Null);
                }
                cols_touched.push(col);
            }

            // Write row field labels in the header row. Compact layout collapses
            // multiple row fields into `first_data_col` visible header columns,
            // so only write labels that fit before the data region.
            for (h_idx, name) in row_field_names
                .iter()
                .take(first_data_col as usize)
                .enumerate()
            {
                if !name.is_empty() {
                    let row = anchor_row;
                    let col = anchor_col + h_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = CellValue::from(name.as_str());
                    }
                }
            }

            // Write column headers
            for (_level_idx, col_header) in result.column_headers.iter().enumerate() {
                let level_idx = _level_idx as u32;
                let mut data_col_offset: u32 = 0;
                for header in &col_header.headers {
                    let row = anchor_row + level_idx;
                    let col = anchor_col + first_data_col + data_col_offset;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = header.value.clone();
                    }
                    data_col_offset += header.span as u32;
                }
            }

            // Bug D - column-GT header label at the leftmost column of the GT span.
            // Aligns with the existing column-GT value writes below, which use
            // `anchor_col + total_cols - num_value_fields + val_idx`, so the leftmost
            // value column is at `total_cols - num_value_fields`. At v=0, num_value_fields
            // collapses to 1 and the label sits in the single GT column.
            if result.grand_totals.column.is_some() {
                let gt_label = result
                    .grand_totals
                    .row_label
                    .as_deref()
                    .unwrap_or("Grand Total");
                let gt_span = num_value_fields.max(1);
                let gt_label_col = anchor_col + total_cols - gt_span;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&gt_label_col)
                    && (anchor_row as usize) < col_vec.len()
                {
                    col_vec[anchor_row as usize] = CellValue::Text(gt_label.into());
                }
            }

            // Write row headers and data values
            for (row_idx, pivot_row) in result.rows.iter().enumerate() {
                let row_idx = row_idx as u32;
                // Row headers. In compact layout the engine still carries the
                // full ancestor chain, but `first_data_col` is the number of
                // visible row-header columns. Write the deepest visible headers
                // so child labels do not get overwritten by data values.
                let visible_header_count = (first_data_col as usize).min(pivot_row.headers.len());
                let hidden_prefix = pivot_row.headers.len().saturating_sub(visible_header_count);
                for (h_idx, header) in pivot_row.headers[hidden_prefix..].iter().enumerate() {
                    let row = anchor_row + first_data_row + row_idx;
                    let col = anchor_col + h_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = header.value.clone();
                    }
                }
                // Data values
                for (v_idx, value) in pivot_row.values.iter().enumerate() {
                    let row = anchor_row + first_data_row + row_idx;
                    let col = anchor_col + first_data_col + v_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = value.clone();
                    }
                }
            }

            // Grand total column (right side)
            if let Some(ref col_totals) = result.grand_totals.column {
                for (row_idx, row_totals) in col_totals.iter().enumerate() {
                    let row_idx = row_idx as u32;
                    for (val_idx, value) in row_totals.iter().enumerate() {
                        let row = anchor_row + first_data_row + row_idx;
                        let col = anchor_col + total_cols - num_value_fields + val_idx as u32;
                        if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                            && (row as usize) < col_vec.len()
                        {
                            col_vec[row as usize] = value.clone();
                        }
                    }
                }
            }

            // Grand total row (bottom)
            if let Some(ref row_totals) = result.grand_totals.row {
                // Label
                let label = result
                    .grand_totals
                    .row_label
                    .as_deref()
                    .unwrap_or("Grand Total");
                let gt_row = anchor_row + total_rows - 1;
                let label_col = anchor_col;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&label_col)
                    && (gt_row as usize) < col_vec.len()
                {
                    col_vec[gt_row as usize] = CellValue::Text(label.into());
                }
                // Values
                for (v_idx, value) in row_totals.iter().enumerate() {
                    let col = anchor_col + first_data_col + v_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (gt_row as usize) < col_vec.len()
                    {
                        col_vec[gt_row as usize] = value.clone();
                    }
                }
            }

            // Corner grand total
            if let Some(ref grand) = result.grand_totals.grand {
                let gt_row = anchor_row + total_rows - 1;
                for (val_idx, value) in grand.iter().enumerate() {
                    let col = anchor_col + total_cols - num_value_fields + val_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (gt_row as usize) < col_vec.len()
                    {
                        col_vec[gt_row as usize] = value.clone();
                    }
                }
            }

            // Expand extent to encompass pivot output
            sheet_mirror.expand_extent(SheetPos::new(
                anchor_row + total_rows - 1,
                anchor_col + total_cols - 1,
            ));
        }

        // Invalidate caches outside the sheet borrow
        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
        }
    }
}

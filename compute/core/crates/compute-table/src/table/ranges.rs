use super::super::types::{Table, TableColumn, TableRange};

/// Get the header row range, or `None` if the table has no header row.
pub fn get_header_range(table: &Table) -> Option<TableRange> {
    if !table.has_header_row {
        return None;
    }
    Some(TableRange::new(
        table.range.start_row(),
        table.range.start_col(),
        table.range.start_row(),
        table.range.end_col(),
    ))
}

/// Get the data range of a table (excludes header and totals rows).
///
/// Returns `None` if there are no data rows (e.g., a table with both header
/// and totals rows but no room for data).
///
/// **BUG FIX**: Checks for inverted range (start_row > end_row) when header
/// + totals only with no data, and returns `None` instead of an invalid range.
pub fn get_data_range(table: &Table) -> Option<TableRange> {
    let start_row = if table.has_header_row {
        table.range.start_row() + 1
    } else {
        table.range.start_row()
    };

    let end_row = if table.has_totals_row {
        // Guard against underflow for u32
        if table.range.end_row() == 0 {
            return None;
        }
        table.range.end_row() - 1
    } else {
        table.range.end_row()
    };

    // BUG FIX: Check for inverted range (no data rows)
    if start_row > end_row {
        return None;
    }

    Some(TableRange::new(
        start_row,
        table.range.start_col(),
        end_row,
        table.range.end_col(),
    ))
}

/// Get the totals row range, or `None` if the table has no totals row.
pub fn get_totals_range(table: &Table) -> Option<TableRange> {
    if !table.has_totals_row {
        return None;
    }
    Some(TableRange::new(
        table.range.end_row(),
        table.range.start_col(),
        table.range.end_row(),
        table.range.end_col(),
    ))
}

/// Get the full column range (including header and totals) for a column by ID.
///
/// Returns `None` if the column is not found.
pub fn get_column_range(table: &Table, column_id: &str) -> Option<TableRange> {
    let col = table.columns.iter().find(|c| c.id == column_id)?;
    let grid_col = table.range.start_col() + col.index;

    Some(TableRange::new(
        table.range.start_row(),
        grid_col,
        table.range.end_row(),
        grid_col,
    ))
}

/// Get the data-only range for a specific column (by column ID).
///
/// Returns `None` if the column is not found or there is no data range.
pub fn get_column_data_range(table: &Table, column_id: &str) -> Option<TableRange> {
    let col = table.columns.iter().find(|c| c.id == column_id)?;
    let grid_col = table.range.start_col() + col.index;
    let data_range = get_data_range(table)?;

    Some(TableRange::new(
        data_range.start_row(),
        grid_col,
        data_range.end_row(),
        grid_col,
    ))
}

/// Check if a cell position (row, col) is anywhere inside the table range.
pub fn is_position_in_table(table: &Table, row: u32, col: u32) -> bool {
    row >= table.range.start_row()
        && row <= table.range.end_row()
        && col >= table.range.start_col()
        && col <= table.range.end_col()
}

/// Get the column at a given grid column position.
///
/// Returns `None` if the grid column is outside the table.
pub fn get_column_at_position(table: &Table, col: u32) -> Option<&TableColumn> {
    if col < table.range.start_col() || col > table.range.end_col() {
        return None;
    }
    let table_col_index = (col - table.range.start_col()) as usize;
    table.columns.get(table_col_index)
}

/// Check if a row is the header row of the table.
///
/// Returns `true` if the table has a header row and the given row matches
/// the table's start row.
pub fn is_in_header_row(table: &Table, row: u32) -> bool {
    table.has_header_row && row == table.range.start_row()
}

/// Check if a row is the totals row of the table.
///
/// Returns `true` if the table has a totals row and the given row matches
/// the table's end row.
pub fn is_in_totals_row(table: &Table, row: u32) -> bool {
    table.has_totals_row && row == table.range.end_row()
}

/// Check if a cell (row, col) is in the data range (not header, not totals).
///
/// Returns `true` if the cell falls within the data area of the table,
/// excluding the header row and the totals row.
pub fn is_in_data_range(table: &Table, row: u32, col: u32) -> bool {
    if let Some(data_range) = get_data_range(table) {
        row >= data_range.start_row()
            && row <= data_range.end_row()
            && col >= data_range.start_col()
            && col <= data_range.end_col()
    } else {
        false
    }
}

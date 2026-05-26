//! Table Auto-Expansion Module
//!
//! Handles automatic table expansion when users type adjacent to tables.
//! Ported from `spreadsheet-model/src/tables/auto-expansion.ts`.
//!
//! When auto-expand is enabled, typing in a cell immediately below or
//! to the right of a table triggers expansion of the table range.

use super::error::TableError;
use super::queries::get_table_at_cell;
use super::table::resize_table;
use super::types::{Table, TableRange};

// ============================================================================
// Adjacency Direction
// ============================================================================

/// Direction of adjacency for auto-expansion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdjacencyDirection {
    /// Cell is immediately below the table.
    Bottom,
    /// Cell is immediately to the right of the table data area.
    Right,
}

/// Result of checking for an adjacent table.
#[derive(Debug, Clone)]
pub struct AdjacentTableResult {
    /// Index of the table in the tables slice.
    pub table_index: usize,
    /// Direction of adjacency.
    pub direction: AdjacencyDirection,
}

// ============================================================================
// Adjacency Detection
// ============================================================================

/// Check if a cell is immediately adjacent to a table (for auto-expansion).
///
/// Returns the table index and the direction of adjacency if the cell
/// is immediately below or to the right of a table with auto_expand enabled.
///
/// NOTE: The `Table` struct in the pure table-engine does not have an `auto_expand`
/// field. This function checks adjacency only; the caller is responsible for
/// checking auto-expand policy at a higher layer.
pub fn get_adjacent_table(tables: &[Table], row: u32, col: u32) -> Option<AdjacentTableResult> {
    for (i, table) in tables.iter().enumerate() {
        let range = &table.range;

        // Check if cell is immediately below the table (same column range)
        let is_immediately_below =
            row == range.end_row() + 1 && col >= range.start_col() && col <= range.end_col();

        if is_immediately_below {
            return Some(AdjacentTableResult {
                table_index: i,
                direction: AdjacencyDirection::Bottom,
            });
        }

        // Check if cell is immediately to the right (same row range for data area)
        let data_start_row = if table.has_header_row {
            range.start_row() + 1
        } else {
            range.start_row()
        };
        let data_end_row = if table.has_totals_row {
            range.end_row().saturating_sub(1)
        } else {
            range.end_row()
        };

        let is_immediately_right =
            col == range.end_col() + 1 && row >= data_start_row && row <= data_end_row;

        if is_immediately_right {
            return Some(AdjacentTableResult {
                table_index: i,
                direction: AdjacencyDirection::Right,
            });
        }
    }

    None
}

/// Check if a cell edit should trigger table auto-expansion.
///
/// Returns the adjacent table info if the cell is not already in a table
/// and is adjacent to a table.
pub fn check_auto_expansion(tables: &[Table], row: u32, col: u32) -> Option<AdjacentTableResult> {
    // First check if cell is already in a table
    if get_table_at_cell(tables, row, col).is_some() {
        return None;
    }

    // Check if adjacent to any table
    get_adjacent_table(tables, row, col)
}

// ============================================================================
// Auto-Expansion Operations
// ============================================================================

/// Auto-expand a table by one row at the bottom.
///
/// Returns the updated table, or None if the table cannot be found.
pub fn auto_expand_table_row(table: &Table) -> Result<Table, TableError> {
    let new_range = TableRange::new(
        table.range.start_row(),
        table.range.start_col(),
        table.range.end_row() + 1,
        table.range.end_col(),
    );

    resize_table(table, new_range)
}

/// Auto-expand a table by one column to the right.
///
/// The new column gets a default name like "ColumnN" where N is the
/// next available number. If `new_column_name` is provided, that name
/// is used instead.
pub fn auto_expand_table_column(
    table: &Table,
    new_column_name: Option<&str>,
) -> Result<Table, TableError> {
    let new_range = TableRange::new(
        table.range.start_row(),
        table.range.start_col(),
        table.range.end_row(),
        table.range.end_col() + 1,
    );

    let mut result = resize_table(table, new_range)?;

    // If a custom name was provided, update the last column's name
    if let Some(name) = new_column_name {
        let last_idx = result.columns.len() - 1;
        result.columns[last_idx].name = name.to_string();
    }

    Ok(result)
}

/// Get the new data row index after auto-expansion.
///
/// Returns the row index where data should be entered after expanding
/// the table by one row at the bottom.
#[cfg(test)]
pub(crate) fn get_new_data_row(table: &Table) -> u32 {
    if table.has_totals_row {
        // New data row is before the total row (which shifts down)
        table.range.end_row()
    } else {
        // New data row is at the new end
        table.range.end_row() + 1
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::super::table::create_table;
    use super::*;

    fn make_table(name: &str, sr: u32, sc: u32, er: u32, ec: u32) -> Table {
        create_table(
            name,
            "sheet1",
            TableRange::new(sr, sc, er, ec),
            &["A", "B", "C"],
            None,
        )
        .unwrap()
    }

    fn make_table_with_totals(name: &str, sr: u32, sc: u32, er: u32, ec: u32) -> Table {
        use super::super::table::CreateTableOptions;
        create_table(
            name,
            "sheet1",
            TableRange::new(sr, sc, er, ec),
            &["A", "B", "C"],
            Some(CreateTableOptions {
                has_totals_row: Some(true),
                ..Default::default()
            }),
        )
        .unwrap()
    }

    // ---- Adjacency Detection ----

    #[test]
    fn adjacent_bottom() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        let result = get_adjacent_table(&tables, 11, 1).unwrap();
        assert_eq!(result.table_index, 0);
        assert_eq!(result.direction, AdjacencyDirection::Bottom);
    }

    #[test]
    fn adjacent_bottom_left_edge() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        let result = get_adjacent_table(&tables, 11, 0).unwrap();
        assert_eq!(result.direction, AdjacencyDirection::Bottom);
    }

    #[test]
    fn adjacent_bottom_right_edge() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        let result = get_adjacent_table(&tables, 11, 2).unwrap();
        assert_eq!(result.direction, AdjacencyDirection::Bottom);
    }

    #[test]
    fn not_adjacent_bottom_outside_cols() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        assert!(get_adjacent_table(&tables, 11, 3).is_none());
    }

    #[test]
    fn not_adjacent_two_rows_below() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        assert!(get_adjacent_table(&tables, 12, 1).is_none());
    }

    #[test]
    fn adjacent_right() {
        // Table has header at row 0, data rows 1-10
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        let result = get_adjacent_table(&tables, 5, 3).unwrap();
        assert_eq!(result.table_index, 0);
        assert_eq!(result.direction, AdjacencyDirection::Right);
    }

    #[test]
    fn not_adjacent_right_header_row() {
        // Header row should not trigger right expansion
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        assert!(get_adjacent_table(&tables, 0, 3).is_none());
    }

    #[test]
    fn not_adjacent_right_two_cols() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        assert!(get_adjacent_table(&tables, 5, 4).is_none());
    }

    #[test]
    fn not_adjacent_right_total_row() {
        // Total row should not trigger right expansion
        let tables = vec![make_table_with_totals("T1", 0, 0, 11, 2)];
        // Total is at row 11
        assert!(get_adjacent_table(&tables, 11, 3).is_none());
    }

    // ---- Check Auto-Expansion ----

    #[test]
    fn check_auto_expansion_in_table() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        // Cell inside the table should not trigger expansion
        assert!(check_auto_expansion(&tables, 5, 1).is_none());
    }

    #[test]
    fn check_auto_expansion_adjacent() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        let result = check_auto_expansion(&tables, 11, 1).unwrap();
        assert_eq!(result.direction, AdjacencyDirection::Bottom);
    }

    #[test]
    fn check_auto_expansion_not_adjacent() {
        let tables = vec![make_table("T1", 0, 0, 10, 2)];
        assert!(check_auto_expansion(&tables, 20, 1).is_none());
    }

    // ---- Auto-Expand Operations ----

    #[test]
    fn auto_expand_row() {
        let t = make_table("T1", 0, 0, 10, 2);
        let expanded = auto_expand_table_row(&t).unwrap();
        assert_eq!(expanded.range.end_row(), 11);
        assert_eq!(expanded.range.start_row(), 0);
        assert_eq!(expanded.columns.len(), 3);
    }

    #[test]
    fn auto_expand_column_default_name() {
        let t = make_table("T1", 0, 0, 10, 2);
        let expanded = auto_expand_table_column(&t, None).unwrap();
        assert_eq!(expanded.range.end_col(), 3);
        assert_eq!(expanded.columns.len(), 4);
        assert_eq!(expanded.columns[3].name, "Column4");
    }

    #[test]
    fn auto_expand_column_custom_name() {
        let t = make_table("T1", 0, 0, 10, 2);
        let expanded = auto_expand_table_column(&t, Some("Score")).unwrap();
        assert_eq!(expanded.columns.len(), 4);
        assert_eq!(expanded.columns[3].name, "Score");
    }

    // ---- New Data Row ----

    #[test]
    fn new_data_row_no_totals() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert_eq!(get_new_data_row(&t), 11);
    }

    #[test]
    fn new_data_row_with_totals() {
        let t = make_table_with_totals("T1", 0, 0, 11, 2);
        // Total is at row 11, new data should go at row 11 (total shifts to 12)
        assert_eq!(get_new_data_row(&t), 11);
    }

    // ---- Multiple Tables ----

    #[test]
    fn adjacent_selects_correct_table() {
        let tables = vec![make_table("T1", 0, 0, 5, 2), make_table("T2", 10, 0, 15, 2)];
        // Below T1
        let r1 = get_adjacent_table(&tables, 6, 1).unwrap();
        assert_eq!(r1.table_index, 0);
        // Below T2
        let r2 = get_adjacent_table(&tables, 16, 1).unwrap();
        assert_eq!(r2.table_index, 1);
    }
}

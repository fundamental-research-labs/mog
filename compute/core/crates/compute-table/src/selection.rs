//! Table Selection — Range helpers for progressive table selection.
//!
//! Ported from `spreadsheet-model/src/tables/selection.ts`.
//!
//! Provides range helpers for Ctrl+Space progressive selection within table columns,
//! header click column selection, left-edge row selection, and corner table selection.
//!
//! Every function is PURE and STATELESS. Operates on Table structs directly.

use super::table::get_data_range;
use super::types::{Table, TableRange};

// ============================================================================
// Column Selection Ranges
// ============================================================================

/// Get the data-only range for a specific column within a table.
///
/// Used for Ctrl+Space stage 0: select column data only.
/// Returns None if the column is outside the table or there is no data range.
pub fn get_column_data_selection_range(table: &Table, col: u32) -> Option<TableRange> {
    let range = &table.range;

    if col < range.start_col() || col > range.end_col() {
        return None;
    }

    let data_range = get_data_range(table)?;

    Some(TableRange::new(
        data_range.start_row(),
        col,
        data_range.end_row(),
        col,
    ))
}

/// Get the data + header range for a specific column within a table.
///
/// Used for Ctrl+Space stage 1: select column data + header.
/// Returns None if the column is outside the table.
pub fn get_column_with_header_range(table: &Table, col: u32) -> Option<TableRange> {
    let range = &table.range;

    if col < range.start_col() || col > range.end_col() {
        return None;
    }

    let end_row = if table.has_totals_row {
        range.end_row().saturating_sub(1)
    } else {
        range.end_row()
    };

    Some(TableRange::new(range.start_row(), col, end_row, col))
}

/// Get the full column range (data + header + total) for a specific column.
///
/// Used for Ctrl+Space stage 2: select entire column including all rows.
/// Returns None if the column is outside the table.
pub fn get_full_column_range(table: &Table, col: u32) -> Option<TableRange> {
    let range = &table.range;

    if col < range.start_col() || col > range.end_col() {
        return None;
    }

    Some(TableRange::new(
        range.start_row(),
        col,
        range.end_row(),
        col,
    ))
}

// ============================================================================
// Row Selection Ranges
// ============================================================================

/// Get the data row range (single row across all data columns).
///
/// Used for left-edge clicks on data rows.
/// Returns None if the row is not in the data area.
pub fn get_table_row_range(table: &Table, row: u32) -> Option<TableRange> {
    let data_range = get_data_range(table)?;

    if row < data_range.start_row() || row > data_range.end_row() {
        return None;
    }

    Some(TableRange::new(
        row,
        table.range.start_col(),
        row,
        table.range.end_col(),
    ))
}

// ============================================================================
// Table-Level Selection Ranges
// ============================================================================

/// Get the table data range (all data cells, excludes header and total).
///
/// Used for corner click stage 0: select table data only.
/// Returns None if there is no data range.
pub fn get_table_data_selection_range(table: &Table) -> Option<TableRange> {
    get_data_range(table)
}

/// Get the full table range (header + data + total).
///
/// Used for corner click stage 1: select entire table.
pub fn get_full_table_range(table: &Table) -> TableRange {
    table.range
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::super::table::{CreateTableOptions, create_table};
    use super::*;

    fn make_table() -> Table {
        // header at 0, data 1-10, cols 0-2
        create_table(
            "T1",
            "sheet1",
            TableRange::new(0, 0, 10, 2),
            &["A", "B", "C"],
            None,
        )
        .unwrap()
    }

    fn make_table_with_totals() -> Table {
        // header at 0, data 1-10, totals at 11, cols 0-2
        create_table(
            "T1",
            "sheet1",
            TableRange::new(0, 0, 11, 2),
            &["A", "B", "C"],
            Some(CreateTableOptions {
                has_totals_row: Some(true),
                ..Default::default()
            }),
        )
        .unwrap()
    }

    // ---- Column Data Range ----

    #[test]
    fn column_data_range_basic() {
        let t = make_table();
        let r = get_column_data_selection_range(&t, 1).unwrap();
        assert_eq!(r.start_row(), 1);
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 1);
        assert_eq!(r.end_col(), 1);
    }

    #[test]
    fn column_data_range_with_totals() {
        let t = make_table_with_totals();
        let r = get_column_data_selection_range(&t, 1).unwrap();
        assert_eq!(r.start_row(), 1);
        assert_eq!(r.end_row(), 10);
    }

    #[test]
    fn column_data_range_outside() {
        let t = make_table();
        assert!(get_column_data_selection_range(&t, 3).is_none());
    }

    // ---- Column With Header Range ----

    #[test]
    fn column_with_header_basic() {
        let t = make_table();
        let r = get_column_with_header_range(&t, 1).unwrap();
        assert_eq!(r.start_row(), 0); // includes header
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 1);
        assert_eq!(r.end_col(), 1);
    }

    #[test]
    fn column_with_header_excludes_totals() {
        let t = make_table_with_totals();
        let r = get_column_with_header_range(&t, 0).unwrap();
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 10); // excludes total row at 11
    }

    #[test]
    fn column_with_header_outside() {
        let t = make_table();
        assert!(get_column_with_header_range(&t, 5).is_none());
    }

    // ---- Full Column Range ----

    #[test]
    fn full_column_basic() {
        let t = make_table();
        let r = get_full_column_range(&t, 2).unwrap();
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 2);
        assert_eq!(r.end_col(), 2);
    }

    #[test]
    fn full_column_with_totals() {
        let t = make_table_with_totals();
        let r = get_full_column_range(&t, 0).unwrap();
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 11); // includes total row
    }

    #[test]
    fn full_column_outside() {
        let t = make_table();
        assert!(get_full_column_range(&t, 10).is_none());
    }

    // ---- Row Range ----

    #[test]
    fn row_range_data_row() {
        let t = make_table();
        let r = get_table_row_range(&t, 5).unwrap();
        assert_eq!(r.start_row(), 5);
        assert_eq!(r.end_row(), 5);
        assert_eq!(r.start_col(), 0);
        assert_eq!(r.end_col(), 2);
    }

    #[test]
    fn row_range_header_excluded() {
        let t = make_table();
        assert!(get_table_row_range(&t, 0).is_none());
    }

    #[test]
    fn row_range_totals_excluded() {
        let t = make_table_with_totals();
        assert!(get_table_row_range(&t, 11).is_none());
    }

    #[test]
    fn row_range_outside() {
        let t = make_table();
        assert!(get_table_row_range(&t, 20).is_none());
    }

    // ---- Table Data Range ----

    #[test]
    fn table_data_range() {
        let t = make_table();
        let r = get_table_data_selection_range(&t).unwrap();
        assert_eq!(r.start_row(), 1);
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 0);
        assert_eq!(r.end_col(), 2);
    }

    #[test]
    fn table_data_range_with_totals() {
        let t = make_table_with_totals();
        let r = get_table_data_selection_range(&t).unwrap();
        assert_eq!(r.start_row(), 1);
        assert_eq!(r.end_row(), 10);
    }

    // ---- Full Table Range ----

    #[test]
    fn full_table_range() {
        let t = make_table();
        let r = get_full_table_range(&t);
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 0);
        assert_eq!(r.end_col(), 2);
    }

    #[test]
    fn full_table_range_with_totals() {
        let t = make_table_with_totals();
        let r = get_full_table_range(&t);
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 11); // includes totals
    }

    // ---- Progressive selection stages ----

    #[test]
    fn progressive_selection_column() {
        let t = make_table_with_totals();
        // Stage 0: data only
        let s0 = get_column_data_selection_range(&t, 1).unwrap();
        assert_eq!(s0.start_row(), 1);
        assert_eq!(s0.end_row(), 10);
        // Stage 1: data + header
        let s1 = get_column_with_header_range(&t, 1).unwrap();
        assert_eq!(s1.start_row(), 0);
        assert_eq!(s1.end_row(), 10);
        // Stage 2: full column
        let s2 = get_full_column_range(&t, 1).unwrap();
        assert_eq!(s2.start_row(), 0);
        assert_eq!(s2.end_row(), 11);
    }

    #[test]
    fn progressive_selection_table() {
        let t = make_table_with_totals();
        // Stage 0: data only
        let s0 = get_table_data_selection_range(&t).unwrap();
        assert_eq!(s0.start_row(), 1);
        assert_eq!(s0.end_row(), 10);
        // Stage 1: full table
        let s1 = get_full_table_range(&t);
        assert_eq!(s1.start_row(), 0);
        assert_eq!(s1.end_row(), 11);
    }
}

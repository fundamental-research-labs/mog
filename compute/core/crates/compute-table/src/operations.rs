//! Table Operations - resize, total row, rename, column add/remove.
//!
//! Ported from `spreadsheet-model/src/tables/operations.ts`.
//!
//! Higher-level operations that combine validation with pure table mutations.
//! These functions validate inputs, then delegate to the pure functions in `table.rs`.

use super::error::TableError;
use super::queries::validate_table_resize;
use super::table::{
    add_column, get_subtotal_formula, remove_column, rename_column, resize_table,
    set_totals_function,
};
use super::types::{Table, TableRange, TotalsFunction};

// ============================================================================
// Validated Resize
// ============================================================================

/// Resize a table with validation against other tables on the sheet.
///
/// Returns `Err` if:
/// - Start position changed
/// - Too few data rows
/// - Overlaps with another table
/// - Invalid range (inverted rows/cols)
pub fn resize_table_validated(
    table: &Table,
    new_range: TableRange,
    other_tables: &[Table],
) -> Result<Table, TableError> {
    let validation = validate_table_resize(table, &new_range, other_tables);
    if !validation.valid {
        return Err(TableError::InvalidRange(
            validation
                .error
                .unwrap_or_else(|| "Invalid table resize".to_string()),
        ));
    }

    resize_table(table, new_range)
}

// ============================================================================
// Total Row Operations
// ============================================================================

/// Set total row function for a column by column index.
///
/// Returns the updated table, or None if column index is out of bounds.
pub fn set_column_total_function(
    table: &Table,
    column_index: usize,
    func: TotalsFunction,
) -> Option<Table> {
    if column_index >= table.columns.len() {
        return None;
    }

    let column_id = &table.columns[column_index].id;
    Some(set_totals_function(table, column_id, func))
}

/// Get the SUBTOTAL formula for a column's total row.
///
/// Returns None if the column has no totals function or the function is None/Custom.
pub fn get_column_total_formula(table: &Table, column_index: usize) -> Option<String> {
    let col = table.columns.get(column_index)?;
    let func = col.totals_function.as_ref()?;
    get_subtotal_formula(func, &col.name)
}

// ============================================================================
// Column Operations (with validation)
// ============================================================================

/// Add a column to the table at a specific index.
///
/// If `position` is None, the column is added at the end.
/// Column name is automatically deduplicated if it conflicts.
pub fn add_table_column(table: &Table, name: &str, position: Option<usize>) -> Table {
    add_column(table, name, position)
}

/// Remove a column from the table by its index.
///
/// Returns the updated table, or the original table unchanged if:
/// - Column index is out of bounds
/// - It's the last remaining column (cannot remove)
pub fn remove_table_column_by_index(table: &Table, column_index: usize) -> Table {
    if column_index >= table.columns.len() {
        return table.clone();
    }
    let column_id = &table.columns[column_index].id;
    remove_column(table, column_id)
}

/// Rename a column by its index within the table.
///
/// Returns `Err` if the new name already exists in another column (case-insensitive).
/// Returns the table unchanged if the column index is out of bounds.
pub fn rename_table_column_by_index(
    table: &Table,
    column_index: usize,
    new_name: &str,
) -> Result<Table, TableError> {
    if column_index >= table.columns.len() {
        return Ok(table.clone());
    }
    let column_id = table.columns[column_index].id.clone();
    rename_column(table, &column_id, new_name)
}

// ============================================================================
// Table Rename (with validation)
// ============================================================================

/// Rename a table with validation.
///
/// Validates the new name is:
/// - Structurally valid (not empty, not a cell reference, etc.)
/// - Unique among other tables (case-insensitive)
///
/// Returns the updated table or an error.
pub fn rename_table_validated(
    table: &Table,
    new_name: &str,
    other_tables: &[Table],
) -> Result<Table, TableError> {
    // Validate name format
    super::table::validate_table_name(new_name)?;

    // Check uniqueness (case-insensitive, excluding self)
    let lower = new_name.to_lowercase();
    for other in other_tables {
        if other.id != table.id && other.name.to_lowercase() == lower {
            return Err(TableError::DuplicateTableName(format!(
                "Table name \"{}\" already exists",
                new_name
            )));
        }
    }

    let mut result = table.clone();
    result.name = new_name.to_string();
    Ok(result)
}

// ============================================================================
// Row Add/Remove (data row operations)
// ============================================================================

/// Result of adding a row to a table.
#[derive(Debug, Clone)]
pub struct AddRowResult {
    /// Table (range unchanged — see `needs_range_expand`).
    pub table: Table,
    /// The absolute row index where a worksheet row should be inserted.
    pub insert_row: u32,
    /// When true the insertion falls past the current table end row.
    ///
    /// `shift_table_ranges` only expands a range when the insertion point is
    /// within `[start_row..=end_row]`, so an append past the end is invisible
    /// to it.  The caller must explicitly expand the table range by 1 row
    /// **after** the structural insert so that the table absorbs the new row.
    pub needs_range_expand: bool,
}

/// Add a data row to the table at the specified position.
///
/// `relative_row` is 0-based relative to the data range start.
/// If None, appends at the end of the data range.
///
/// Returns the insertion row index and a flag indicating whether the caller
/// must manually expand the table range after the structural row insert.
///
/// Range adjustment strategy:
/// - **Insert within the table** (`insert_row <= table.end_row`):
///   `shift_table_ranges` handles expansion automatically.
/// - **Append past the table** (`insert_row > table.end_row`):
///   `needs_range_expand` is set to `true` — the caller must expand the
///   table range by 1 row after the structural change completes.
pub fn add_data_row(table: &Table, relative_row: Option<u32>) -> AddRowResult {
    let data_start = if table.has_header_row {
        table.range.start_row() + 1
    } else {
        table.range.start_row()
    };

    let data_end = if table.has_totals_row {
        table.range.end_row().saturating_sub(1)
    } else {
        table.range.end_row()
    };

    let data_row_count = if data_end >= data_start {
        data_end - data_start + 1
    } else {
        0
    };

    let insert_row = match relative_row {
        Some(rel) => {
            let clamped = rel.min(data_row_count);
            data_start + clamped
        }
        None => data_end + 1, // After last data row
    };

    let needs_range_expand = insert_row > table.range.end_row();

    AddRowResult {
        table: table.clone(),
        insert_row,
        needs_range_expand,
    }
}

/// Result of removing a row from a table.
#[derive(Debug, Clone)]
pub struct RemoveRowResult {
    /// Table (range unchanged — `shift_table_ranges` contracts it).
    pub table: Table,
    /// The absolute row index that was removed.
    pub removed_row: u32,
}

/// Remove a data row from the table.
///
/// `relative_row` is 0-based relative to the data range start.
/// Returns None if:
/// - There are no data rows to remove
/// - The relative_row is out of bounds
/// - Removing would leave 0 data rows
///
/// The table range is NOT contracted here.  The removed row is always
/// within the table range, so `shift_table_ranges` (triggered by
/// `deleteRows`) will contract the end row automatically.
pub fn remove_data_row(table: &Table, relative_row: u32) -> Option<RemoveRowResult> {
    let data_start = if table.has_header_row {
        table.range.start_row() + 1
    } else {
        table.range.start_row()
    };

    let data_end = if table.has_totals_row {
        table.range.end_row().saturating_sub(1)
    } else {
        table.range.end_row()
    };

    // Must have data rows
    if data_start > data_end {
        return None;
    }

    let data_row_count = data_end - data_start + 1;

    // Cannot remove if only 1 data row
    if data_row_count <= 1 {
        return None;
    }

    // Bounds check
    if relative_row >= data_row_count {
        return None;
    }

    let removed_row = data_start + relative_row;
    let result = table.clone();

    Some(RemoveRowResult {
        table: result,
        removed_row,
    })
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

    // ---- Validated Resize ----

    #[test]
    fn resize_validated_ok() {
        let t = make_table("T1", 0, 0, 10, 2);
        let nr = TableRange::new(0, 0, 15, 2);
        let result = resize_table_validated(&t, nr, &[]).unwrap();
        assert_eq!(result.range.end_row(), 15);
    }

    #[test]
    fn resize_validated_overlap_err() {
        let t = make_table("T1", 0, 0, 10, 2);
        let other = make_table("T2", 12, 0, 20, 2);
        let nr = TableRange::new(0, 0, 15, 2);
        let result = resize_table_validated(&t, nr, &[other]);
        assert!(result.is_err());
    }

    // ---- Total Row ----

    #[test]
    fn set_column_total_sum() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = set_column_total_function(&t, 1, TotalsFunction::Sum).unwrap();
        assert_eq!(t2.columns[1].totals_function, Some(TotalsFunction::Sum));
    }

    #[test]
    fn set_column_total_out_of_bounds() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(set_column_total_function(&t, 99, TotalsFunction::Sum).is_none());
    }

    #[test]
    fn get_column_total_formula_sum() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = set_column_total_function(&t, 0, TotalsFunction::Sum).unwrap();
        let formula = get_column_total_formula(&t2, 0).unwrap();
        assert_eq!(formula, "=SUBTOTAL(109,[A])");
    }

    #[test]
    fn get_column_total_formula_none() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(get_column_total_formula(&t, 0).is_none());
    }

    // ---- Column Operations ----

    #[test]
    fn add_column_at_end() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = add_table_column(&t, "D", None);
        assert_eq!(t2.columns.len(), 4);
        assert_eq!(t2.columns[3].name, "D");
    }

    #[test]
    fn add_column_at_start() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = add_table_column(&t, "Z", Some(0));
        assert_eq!(t2.columns[0].name, "Z");
        assert_eq!(t2.columns[1].name, "A");
    }

    #[test]
    fn remove_column_by_index() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = remove_table_column_by_index(&t, 1);
        assert_eq!(t2.columns.len(), 2);
        assert_eq!(t2.columns[0].name, "A");
        assert_eq!(t2.columns[1].name, "C");
    }

    #[test]
    fn remove_column_out_of_bounds() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = remove_table_column_by_index(&t, 99);
        assert_eq!(t2.columns.len(), 3); // unchanged
    }

    #[test]
    fn rename_column_by_index_ok() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = rename_table_column_by_index(&t, 0, "NewName").unwrap();
        assert_eq!(t2.columns[0].name, "NewName");
    }

    #[test]
    fn rename_column_by_index_duplicate() {
        let t = make_table("T1", 0, 0, 10, 2);
        let result = rename_table_column_by_index(&t, 0, "B");
        assert!(result.is_err());
    }

    // ---- Table Rename ----

    #[test]
    fn rename_table_ok() {
        let t = make_table("T1", 0, 0, 10, 2);
        let t2 = rename_table_validated(&t, "NewName", &[]).unwrap();
        assert_eq!(t2.name, "NewName");
    }

    #[test]
    fn rename_table_duplicate() {
        let t = make_table("T1", 0, 0, 10, 2);
        let other = make_table("T2", 12, 0, 20, 2);
        let result = rename_table_validated(&t, "T2", &[other]);
        assert!(result.is_err());
    }

    #[test]
    fn rename_table_invalid_name() {
        let t = make_table("T1", 0, 0, 10, 2);
        let result = rename_table_validated(&t, "A1", &[]);
        assert!(result.is_err());
    }

    // ---- Add Data Row ----

    #[test]
    fn add_row_append() {
        let t = make_table("T1", 0, 0, 10, 2); // header at 0, data 1-10
        let result = add_data_row(&t, None);
        // Append inserts past end_row — needs_range_expand is true so
        // the caller will resize the table after the structural change.
        assert_eq!(result.table.range.end_row(), 10); // unchanged
        assert!(result.needs_range_expand);
        assert_eq!(result.insert_row, 11); // after row 10
    }

    #[test]
    fn add_row_at_beginning() {
        let t = make_table("T1", 0, 0, 10, 2);
        let result = add_data_row(&t, Some(0));
        // Insert within table — shift_table_ranges handles expansion.
        assert_eq!(result.table.range.end_row(), 10);
        assert!(!result.needs_range_expand);
        assert_eq!(result.insert_row, 1); // data starts at row 1
    }

    #[test]
    fn add_row_with_totals() {
        let t = make_table_with_totals("T1", 0, 0, 11, 2); // header at 0, data 1-10, totals at 11
        let result = add_data_row(&t, None);
        // Insert at row 11 (before totals) is within the table, so no
        // manual expansion needed — shift_table_ranges handles it.
        assert_eq!(result.table.range.end_row(), 11);
        assert!(!result.needs_range_expand);
        assert_eq!(result.insert_row, 11); // after row 10, before totals
    }

    // ---- Remove Data Row ----

    #[test]
    fn remove_row_middle() {
        let t = make_table("T1", 0, 0, 10, 2); // data rows 1-10
        let result = remove_data_row(&t, 5).unwrap();
        // Removed row is within the table, so shift_table_ranges contracts.
        assert_eq!(result.table.range.end_row(), 10);
        assert_eq!(result.removed_row, 6); // data_start(1) + 5
    }

    #[test]
    fn remove_row_only_one_data_row() {
        let t = make_table("T1", 0, 0, 1, 2); // header at 0, data at 1
        assert!(remove_data_row(&t, 0).is_none());
    }

    #[test]
    fn remove_row_out_of_bounds() {
        let t = make_table("T1", 0, 0, 10, 2);
        assert!(remove_data_row(&t, 99).is_none());
    }

    #[test]
    fn remove_row_with_totals() {
        let t = make_table_with_totals("T1", 0, 0, 11, 2); // header 0, data 1-10, totals 11
        let result = remove_data_row(&t, 0).unwrap();
        assert_eq!(result.table.range.end_row(), 11);
        assert_eq!(result.removed_row, 1);
    }
}

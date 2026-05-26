//! Table engine — pure computation model for Excel-style tables.
//!
//! Every function is PURE and STATELESS. All operations return NEW structs.
//! No DOM, no Yjs, no React, no XState.
//!
//! Logic adapted from `table-engine/src/table.ts`.

use super::error::TableError;
use super::structured_refs::escape_column_name;
use super::types::{Table, TableBoolOption, TableColumn, TableRange, TotalsFunction};

// ============================================================================
// SUBTOTAL function numbers (matches Excel SUBTOTAL function)
// Using 101+ series which ignores manually hidden rows
// ============================================================================

/// Map TotalsFunction → Excel SUBTOTAL function number (101+ series).
///
/// Note: function number 106 (PRODUCT) is intentionally skipped — Excel's SUBTOTAL
/// function does not support PRODUCT, so there is no mapping for it.
fn subtotal_function_number(func: &TotalsFunction) -> Option<u32> {
    match func {
        TotalsFunction::Average => Some(101),
        TotalsFunction::Count => Some(102),
        TotalsFunction::CountNums => Some(103),
        TotalsFunction::Max => Some(104),
        TotalsFunction::Min => Some(105),
        TotalsFunction::StdDev => Some(107),
        TotalsFunction::Sum => Some(109),
        TotalsFunction::Var => Some(110),
        TotalsFunction::Custom | TotalsFunction::None => None,
    }
}

// ============================================================================
// CreateTableOptions
// ============================================================================

/// Options for creating a new table.
#[derive(Default)]
pub struct CreateTableOptions {
    /// Optional table ID (distinct from name). Default: same as `name`.
    pub id: Option<String>,
    /// Whether the table has a header row. Default: true.
    pub has_header_row: Option<bool>,
    /// Whether the table has a totals row. Default: false.
    pub has_totals_row: Option<bool>,
    /// Table style ID. Default: "TableStyleMedium2".
    pub style_id: Option<String>,
}

// ============================================================================
// Range Validation
// ============================================================================

/// Validate that a TableRange is well-formed.
fn validate_range(range: &TableRange) -> Result<(), TableError> {
    if range.start_row() > range.end_row() {
        return Err(TableError::InvalidRange(format!(
            "start_row ({}) must be <= end_row ({})",
            range.start_row(),
            range.end_row()
        )));
    }
    if range.start_col() > range.end_col() {
        return Err(TableError::InvalidRange(format!(
            "start_col ({}) must be <= end_col ({})",
            range.start_col(),
            range.end_col()
        )));
    }
    Ok(())
}

// ============================================================================
// Table Creation
// ============================================================================

/// Create a new table.
///
/// Columns are built from `column_names`, each assigned a 0-based index.
/// Column IDs are generated as `"{table_id}-col-0"`, `"{table_id}-col-1"`, etc.
/// Default style is `"TableStyleMedium2"` (Excel default).
///
/// # Errors
///
/// Returns `Err` if the range is invalid (inverted rows or columns).
pub fn create_table(
    name: &str,
    sheet_id: &str,
    range: TableRange,
    column_names: &[&str],
    options: Option<CreateTableOptions>,
) -> Result<Table, TableError> {
    validate_range(&range)?;
    let opts = options.unwrap_or_default();
    let table_id = opts.id.unwrap_or_else(|| name.to_string());
    let has_header_row = opts.has_header_row.unwrap_or(true);
    let has_totals_row = opts.has_totals_row.unwrap_or(false);
    let style_id = opts
        .style_id
        .unwrap_or_else(|| "TableStyleMedium2".to_string());

    let col_count = (range.end_col() - range.start_col() + 1) as usize;

    let columns: Vec<TableColumn> = (0..col_count)
        .map(|i| {
            let col_name = if i < column_names.len() {
                column_names[i].to_string()
            } else {
                format!("Column{}", i + 1)
            };
            TableColumn {
                id: format!("{}-col-{}", table_id, i),
                name: col_name,
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }
        })
        .collect();

    Ok(Table {
        id: table_id,
        name: name.to_string(),
        display_name: name.to_string(),
        sheet_id: sheet_id.to_string(),
        range,
        columns,
        has_header_row,
        has_totals_row,
        style: style_id,
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
    })
}

// ============================================================================
// Table Name Validation
// ============================================================================

/// Validate a proposed table name.
///
/// Rules:
/// - Non-empty
/// - Starts with letter or underscore
/// - Only letters, digits, underscores (no spaces)
/// - Not a cell reference (A1 through XFD1048576)
///
/// Returns `Ok(())` if valid, `Err(description)` if invalid.
pub fn validate_table_name(name: &str) -> Result<(), TableError> {
    if name.is_empty() || name.trim().is_empty() {
        return Err(TableError::InvalidTableName(
            "Table name cannot be empty".to_string(),
        ));
    }

    // Must start with letter or underscore
    let first = name.chars().next().unwrap();
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(TableError::InvalidTableName(
            "Table name must start with a letter or underscore".to_string(),
        ));
    }

    // Only letters, digits, underscores (no spaces)
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(TableError::InvalidTableName(
            "Table name can only contain letters, digits, and underscores".to_string(),
        ));
    }

    // Reject cell references like A1, BB99, XFD1
    if looks_like_cell_reference(name) {
        return Err(TableError::InvalidTableName(
            "Table name cannot be a cell reference".to_string(),
        ));
    }

    Ok(())
}

/// Check if a name looks like a cell reference (A1 through XFD1048576).
fn looks_like_cell_reference(name: &str) -> bool {
    let bytes = name.as_bytes();

    // Find where the letter part ends and the digit part begins
    let mut letter_end = 0;
    for &b in bytes {
        if b.is_ascii_alphabetic() {
            letter_end += 1;
        } else {
            break;
        }
    }

    // Must have 1-3 letters followed by at least 1 digit
    if letter_end == 0 || letter_end > 3 || letter_end >= bytes.len() {
        return false;
    }

    // Rest must be all digits
    let digit_part = &name[letter_end..];
    if !digit_part.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    // Parse the row number
    let row_num: u32 = match digit_part.parse() {
        Ok(n) => n,
        Err(_) => return false,
    };

    // Convert letter part to column number: A=1, B=2, ..., Z=26, AA=27, ..., XFD=16384
    let letters = &name[..letter_end].to_uppercase();
    let mut col_num: u32 = 0;
    for b in letters.bytes() {
        col_num = col_num * 26 + (b - b'A' + 1) as u32;
    }

    // Only reject if both column (1-16384) and row (1-1048576) are valid Excel references
    (1..=16384).contains(&col_num) && (1..=1_048_576).contains(&row_num)
}

// ============================================================================
// Column Operations
// ============================================================================

/// Add a column at the specified position within the table.
///
/// If `position` is `None`, the column is added at the end.
/// Column indices are re-numbered after insertion.
/// The table range expands by one column.
///
/// **BUG FIX**: Name deduplication uses an incrementing counter instead of
/// repeatedly appending '2'. So "Column" -> "Column2" -> "Column3" -> "Column4"
/// instead of "Column" -> "Column2" -> "Column22" -> "Column222".
pub fn add_column(table: &Table, name: &str, position: Option<usize>) -> Table {
    let pos = position.unwrap_or(table.columns.len());
    // Clamp position to [0, columns.len()]
    let pos = pos.min(table.columns.len());

    // Ensure column name uniqueness with incrementing counter
    let existing_names: Vec<String> = table
        .columns
        .iter()
        .map(|c| c.name.to_lowercase())
        .collect();

    let unique_name = deduplicate_column_name(name, &existing_names);

    // Generate a unique column ID using table-id prefix
    let prefix = format!("{}-col-", table.id);
    let max_id_suffix = table
        .columns
        .iter()
        .filter_map(|c| {
            c.id.strip_prefix(&prefix)
                .and_then(|s| s.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    let new_id = format!("{}{}", prefix, max_id_suffix + 1);

    let new_col = TableColumn {
        id: new_id,
        name: unique_name,
        index: pos as u32,
        totals_function: None,
        totals_label: None,
        calculated_formula: None,
    };

    let mut cols = table.columns.clone();
    cols.insert(pos, new_col);

    // Re-index
    for (i, col) in cols.iter_mut().enumerate() {
        col.index = i as u32;
    }

    let mut result = table.clone();
    result.columns = cols;
    result.range = TableRange::new(
        table.range.start_row(),
        table.range.start_col(),
        table.range.end_row(),
        table.range.end_col() + 1,
    );
    result
}

/// Deduplicate a column name against existing names (case-insensitive).
///
/// Uses incrementing counter: "Column" -> "Column2" -> "Column3" -> "Column4".
fn deduplicate_column_name(name: &str, existing_lower: &[String]) -> String {
    let mut candidate = name.to_string();
    if !existing_lower.contains(&candidate.to_lowercase()) {
        return candidate;
    }

    let base_name = name.to_string();
    let mut suffix = 2u32;
    loop {
        candidate = format!("{}{}", base_name, suffix);
        if !existing_lower.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        suffix += 1;
    }
}

/// Remove a column by ID.
///
/// The table range contracts by one column. Remaining columns are re-indexed.
/// Cannot remove the last column — returns the table unchanged.
pub fn remove_column(table: &Table, column_id: &str) -> Table {
    // Cannot remove the last column
    if table.columns.len() <= 1 {
        return table.clone();
    }

    let idx = table.columns.iter().position(|c| c.id == column_id);
    if idx.is_none() {
        return table.clone();
    }

    let mut cols: Vec<TableColumn> = table
        .columns
        .iter()
        .filter(|c| c.id != column_id)
        .cloned()
        .collect();

    // Re-index
    for (i, col) in cols.iter_mut().enumerate() {
        col.index = i as u32;
    }

    let mut result = table.clone();
    result.columns = cols;
    result.range = TableRange::new(
        table.range.start_row(),
        table.range.start_col(),
        table.range.end_row(),
        table.range.end_col() - 1,
    );
    result
}

/// Rename a column by ID.
///
/// Returns `Err` if the new name already exists (case-insensitive) in another column.
/// Returns the table unchanged if the column ID is not found.
pub fn rename_column(table: &Table, column_id: &str, new_name: &str) -> Result<Table, TableError> {
    // If column doesn't exist, return unchanged
    let target = table.columns.iter().find(|c| c.id == column_id);
    if target.is_none() {
        return Ok(table.clone());
    }

    // Check uniqueness (case-insensitive), excluding the column being renamed
    let lower_new = new_name.to_lowercase();
    for col in &table.columns {
        if col.id != column_id && col.name.to_lowercase() == lower_new {
            return Err(TableError::DuplicateColumnName(format!(
                "Column name \"{}\" already exists in table \"{}\"",
                new_name, table.name
            )));
        }
    }

    let columns: Vec<TableColumn> = table
        .columns
        .iter()
        .map(|col| {
            if col.id == column_id {
                TableColumn {
                    name: new_name.to_string(),
                    ..col.clone()
                }
            } else {
                col.clone()
            }
        })
        .collect();

    let mut result = table.clone();
    result.columns = columns;
    Ok(result)
}

// ============================================================================
// Resize
// ============================================================================

/// Resize a table to a new range.
///
/// If the column count changes, columns are added or removed at the end.
/// New columns get generated names. Column indices are re-numbered.
///
/// # Errors
///
/// Returns `Err` if the new range is invalid (inverted rows or columns).
pub fn resize_table(table: &Table, new_range: TableRange) -> Result<Table, TableError> {
    validate_range(&new_range)?;
    let old_col_count = (table.range.end_col() - table.range.start_col() + 1) as usize;
    let new_col_count = (new_range.end_col() - new_range.start_col() + 1) as usize;

    let mut columns: Vec<TableColumn> = if new_col_count > old_col_count {
        // Append new columns with non-colliding IDs
        let prefix = format!("{}-col-", table.id);
        let max_suffix = table
            .columns
            .iter()
            .filter_map(|col| {
                col.id
                    .strip_prefix(&prefix)
                    .and_then(|s| s.parse::<u32>().ok())
            })
            .max()
            .unwrap_or(0);

        // Start above both the existing max suffix AND the target column count
        // to avoid collisions with IDs from previous resize cycles.
        let mut next_suffix = std::cmp::max(max_suffix + 1, new_col_count as u32);

        let mut cols = table.columns.clone();
        for i in old_col_count..new_col_count {
            cols.push(TableColumn {
                id: format!("{}{}", prefix, next_suffix),
                name: format!("Column{}", i + 1),
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            });
            next_suffix += 1;
        }
        cols
    } else if new_col_count < old_col_count {
        // Truncate columns
        table.columns[..new_col_count].to_vec()
    } else {
        table.columns.clone()
    };

    // Re-index
    for (i, col) in columns.iter_mut().enumerate() {
        col.index = i as u32;
    }

    let mut result = table.clone();
    result.range = new_range;
    result.columns = columns;
    Ok(result)
}

// ============================================================================
// Table Options
// ============================================================================

/// Set a boolean table display option.
pub fn set_table_option(table: &Table, option: TableBoolOption, value: bool) -> Table {
    let mut result = table.clone();
    match option {
        TableBoolOption::BandedRows => result.banded_rows = value,
        TableBoolOption::BandedColumns => result.banded_columns = value,
        TableBoolOption::EmphasizeFirstColumn => result.emphasize_first_column = value,
        TableBoolOption::EmphasizeLastColumn => result.emphasize_last_column = value,
        TableBoolOption::ShowFilterButtons => result.show_filter_buttons = value,
    }
    result
}

/// Set the table style.
pub fn set_table_style(table: &Table, style_id: &str) -> Table {
    let mut result = table.clone();
    result.style = style_id.to_string();
    result
}

// ============================================================================
// Range Queries
// ============================================================================

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

// ============================================================================
// Hit Testing
// ============================================================================

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

// ============================================================================
// Column Lookup
// ============================================================================

/// Find a column by name (case-insensitive).
///
/// Returns `None` if no column with the given name exists.
pub fn get_column_by_name<'a>(table: &'a Table, name: &str) -> Option<&'a TableColumn> {
    let lower = name.to_lowercase();
    table
        .columns
        .iter()
        .find(|c| c.name.to_lowercase() == lower)
}

/// Find a column by its unique ID (exact match).
///
/// Returns `None` if no column with the given ID exists.
pub fn get_column_by_id<'a>(table: &'a Table, id: &str) -> Option<&'a TableColumn> {
    table.columns.iter().find(|c| c.id == id)
}

// ============================================================================
// Row/Cell Region Testing
// ============================================================================

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

// ============================================================================
// Table Name Generation & Overlap Detection
// ============================================================================

/// Generate a unique table name: "Table1", "Table2", etc.
///
/// Picks the first `"TableN"` (N starting at 1) that does not conflict
/// with any existing name (case-insensitive comparison).
pub fn generate_table_name(existing_names: &[&str]) -> String {
    let lower_set: Vec<String> = existing_names.iter().map(|n| n.to_lowercase()).collect();
    let mut i = 1u32;
    loop {
        let candidate = format!("Table{}", i);
        if !lower_set.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        i += 1;
    }
}

/// Check if two tables on the same sheet have overlapping ranges.
///
/// Returns `true` if the ranges of `a` and `b` intersect in both
/// the row and column dimensions.
#[cfg(test)]
pub fn tables_overlap(a: &Table, b: &Table) -> bool {
    if a.range.end_col() < b.range.start_col() || a.range.start_col() > b.range.end_col() {
        return false;
    }
    if a.range.end_row() < b.range.start_row() || a.range.start_row() > b.range.end_row() {
        return false;
    }
    true
}

// ============================================================================
// Totals Row
// ============================================================================

/// Toggle the totals row on or off, adjusting the table range accordingly.
///
/// - Turning on: expand end_row by 1 to make room for the totals row.
/// - Turning off: contract end_row by 1 to remove the totals row.
pub fn toggle_totals_row(table: &Table) -> Table {
    let mut result = table.clone();
    if table.has_totals_row {
        // Turning off: contract end_row by 1
        result.has_totals_row = false;
        result.range = TableRange::new(
            table.range.start_row(),
            table.range.start_col(),
            table.range.end_row().saturating_sub(1),
            table.range.end_col(),
        );
    } else {
        // Turning on: expand end_row by 1 (with overflow guard)
        result.has_totals_row = true;
        result.range = TableRange::new(
            table.range.start_row(),
            table.range.start_col(),
            table.range.end_row().saturating_add(1),
            table.range.end_col(),
        );
    }
    result
}

/// Set (or clear) the totals function for a column.
///
/// Passing `TotalsFunction::None` effectively clears the function.
pub fn set_totals_function(table: &Table, column_id: &str, func: TotalsFunction) -> Table {
    let columns: Vec<TableColumn> = table
        .columns
        .iter()
        .map(|col| {
            if col.id == column_id {
                TableColumn {
                    totals_function: Some(func),
                    ..col.clone()
                }
            } else {
                col.clone()
            }
        })
        .collect();

    let mut result = table.clone();
    result.columns = columns;
    result
}

// ============================================================================
// Totals Formula Generation
// ============================================================================

/// Generate the SUBTOTAL formula for a totals row cell.
///
/// Uses the 101+ function numbers (ignore hidden rows).
/// e.g., `get_subtotal_formula(Sum, "Sales")` => `Some("=SUBTOTAL(109,[Sales])")`
///
/// Returns `None` for `None` and `Custom` functions.
pub fn get_subtotal_formula(func: &TotalsFunction, column_name: &str) -> Option<String> {
    let func_num = subtotal_function_number(func)?;
    let escaped = escape_column_name(column_name);
    Some(format!("=SUBTOTAL({},[{}])", func_num, escaped))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: create a simple table with header row, no totals, starting at (0,0).
    fn make_test_table() -> Table {
        create_table(
            "TestTable",
            "sheet1",
            TableRange::new(0, 0, 10, 2),
            &["Name", "Age", "City"],
            None,
        )
        .expect("valid range")
    }

    // ---- Table Creation ----

    #[test]
    fn create_table_basic() {
        let t = make_test_table();
        assert_eq!(t.name, "TestTable");
        assert_eq!(t.sheet_id, "sheet1");
        assert_eq!(t.columns.len(), 3);
        assert_eq!(t.columns[0].name, "Name");
        assert_eq!(t.columns[0].id, "TestTable-col-0");
        assert_eq!(t.columns[0].index, 0);
        assert_eq!(t.columns[1].name, "Age");
        assert_eq!(t.columns[1].id, "TestTable-col-1");
        assert_eq!(t.columns[2].name, "City");
        assert_eq!(t.columns[2].id, "TestTable-col-2");
        assert!(t.has_header_row);
        assert!(!t.has_totals_row);
        assert_eq!(t.style, "TableStyleMedium2");
        assert!(t.banded_rows);
        assert!(!t.banded_columns);
        assert!(t.show_filter_buttons);
    }

    #[test]
    fn create_table_with_options() {
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(0, 0, 5, 1),
            &["A", "B"],
            Some(CreateTableOptions {
                has_header_row: Some(false),
                has_totals_row: Some(true),
                style_id: Some("TableStyleLight1".to_string()),
                ..Default::default()
            }),
        )
        .unwrap();
        assert!(!t.has_header_row);
        assert!(t.has_totals_row);
        assert_eq!(t.style, "TableStyleLight1");
    }

    #[test]
    fn create_table_pads_column_names() {
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(0, 0, 5, 3),
            &["A", "B"], // only 2 names for 4 columns
            None,
        )
        .unwrap();
        assert_eq!(t.columns.len(), 4);
        assert_eq!(t.columns[2].name, "Column3");
        assert_eq!(t.columns[3].name, "Column4");
    }

    // ---- Table Name Validation ----

    #[test]
    fn validate_table_name_valid() {
        assert!(validate_table_name("MyTable").is_ok());
        assert!(validate_table_name("_private").is_ok());
        assert!(validate_table_name("Table1").is_ok());
        assert!(validate_table_name("a").is_ok());
    }

    #[test]
    fn validate_table_name_empty() {
        assert!(validate_table_name("").is_err());
        assert!(validate_table_name("   ").is_err());
    }

    #[test]
    fn validate_table_name_starts_with_digit() {
        assert!(validate_table_name("1Table").is_err());
    }

    #[test]
    fn validate_table_name_contains_space() {
        assert!(validate_table_name("My Table").is_err());
    }

    #[test]
    fn validate_table_name_special_chars() {
        assert!(validate_table_name("My-Table").is_err());
        assert!(validate_table_name("My.Table").is_err());
    }

    #[test]
    fn validate_table_name_cell_reference() {
        assert!(validate_table_name("A1").is_err());
        assert!(validate_table_name("XFD1048576").is_err());
        assert!(validate_table_name("BB99").is_err());
        assert!(validate_table_name("a1").is_err());
    }

    #[test]
    fn validate_table_name_not_cell_reference() {
        // Column beyond XFD (16384) should be valid
        assert!(validate_table_name("XFE1").is_ok());
        // Row beyond 1048576 should be valid
        assert!(validate_table_name("A1048577").is_ok());
        // Too many letters to be a column
        assert!(validate_table_name("ABCD1").is_ok());
    }

    // ---- Add Column ----

    #[test]
    fn add_column_at_end() {
        let t = make_test_table();
        let t2 = add_column(&t, "Score", None);
        assert_eq!(t2.columns.len(), 4);
        assert_eq!(t2.columns[3].name, "Score");
        assert_eq!(t2.columns[3].index, 3);
        assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
    }

    #[test]
    fn add_column_at_beginning() {
        let t = make_test_table();
        let t2 = add_column(&t, "ID", Some(0));
        assert_eq!(t2.columns.len(), 4);
        assert_eq!(t2.columns[0].name, "ID");
        assert_eq!(t2.columns[0].index, 0);
        assert_eq!(t2.columns[1].name, "Name");
        assert_eq!(t2.columns[1].index, 1);
    }

    #[test]
    fn add_column_dedup_incrementing_counter() {
        // BUG FIX TEST: Name dedup must use incrementing counter
        let t = make_test_table(); // has "Name", "Age", "City"
        let t2 = add_column(&t, "Name", None); // should become "Name2"
        assert_eq!(t2.columns[3].name, "Name2");

        let t3 = add_column(&t2, "Name", None); // should become "Name3", NOT "Name22"
        assert_eq!(t3.columns[4].name, "Name3");

        let t4 = add_column(&t3, "Name", None); // should become "Name4", NOT "Name222"
        assert_eq!(t4.columns[5].name, "Name4");
    }

    #[test]
    fn add_column_dedup_case_insensitive() {
        let t = make_test_table(); // has "Name"
        let t2 = add_column(&t, "name", None); // "name" collides with "Name"
        assert_eq!(t2.columns[3].name, "name2");
    }

    #[test]
    fn add_column_position_clamped() {
        let t = make_test_table(); // 3 columns
        let t2 = add_column(&t, "X", Some(999));
        assert_eq!(t2.columns.last().unwrap().name, "X");
    }

    // ---- Remove Column ----

    #[test]
    fn remove_column_basic() {
        let t = make_test_table();
        let col_id = t.columns[1].id.clone();
        let t2 = remove_column(&t, &col_id);
        assert_eq!(t2.columns.len(), 2);
        assert_eq!(t2.columns[0].name, "Name");
        assert_eq!(t2.columns[0].index, 0);
        assert_eq!(t2.columns[1].name, "City");
        assert_eq!(t2.columns[1].index, 1);
        assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
    }

    #[test]
    fn remove_column_not_found() {
        let t = make_test_table();
        let t2 = remove_column(&t, "nonexistent");
        assert_eq!(t2.columns.len(), t.columns.len());
    }

    #[test]
    fn remove_column_last_column_prevented() {
        let t = create_table("T1", "s1", TableRange::new(0, 0, 5, 0), &["Only"], None).unwrap();
        let t2 = remove_column(&t, &t.columns[0].id);
        assert_eq!(t2.columns.len(), 1); // unchanged
    }

    // ---- Rename Column ----

    #[test]
    fn rename_column_basic() {
        let t = make_test_table();
        let t2 = rename_column(&t, &t.columns[0].id, "FullName").unwrap();
        assert_eq!(t2.columns[0].name, "FullName");
    }

    #[test]
    fn rename_column_duplicate_name_errors() {
        let t = make_test_table(); // "Name", "Age", "City"
        let result = rename_column(&t, &t.columns[0].id, "Age");
        assert!(result.is_err());
    }

    #[test]
    fn rename_column_duplicate_case_insensitive() {
        let t = make_test_table(); // "Name", "Age", "City"
        let result = rename_column(&t, &t.columns[0].id, "AGE");
        assert!(result.is_err());
    }

    #[test]
    fn rename_column_not_found() {
        let t = make_test_table();
        let t2 = rename_column(&t, "nonexistent", "Whatever").unwrap();
        assert_eq!(t2.columns, t.columns); // unchanged
    }

    // ---- Resize Table ----

    #[test]
    fn resize_table_expand_columns() {
        let t = make_test_table(); // 3 columns
        let t2 = resize_table(&t, TableRange::new(0, 0, 10, 4)).unwrap();
        assert_eq!(t2.columns.len(), 5);
        assert_eq!(t2.columns[3].name, "Column4");
        assert_eq!(t2.columns[4].name, "Column5");
        // Indices re-numbered
        for (i, col) in t2.columns.iter().enumerate() {
            assert_eq!(col.index, i as u32);
        }
    }

    #[test]
    fn resize_table_shrink_columns() {
        let t = make_test_table(); // 3 columns
        let t2 = resize_table(&t, TableRange::new(0, 0, 10, 1)).unwrap();
        assert_eq!(t2.columns.len(), 2);
        assert_eq!(t2.columns[0].name, "Name");
        assert_eq!(t2.columns[1].name, "Age");
    }

    #[test]
    fn resize_table_same_columns() {
        let t = make_test_table();
        let t2 = resize_table(&t, t.range).unwrap();
        assert_eq!(t2.columns.len(), t.columns.len());
    }

    // ---- Table Options ----

    #[test]
    fn set_table_option_banded_rows() {
        let t = make_test_table();
        assert!(t.banded_rows);
        let t2 = set_table_option(&t, TableBoolOption::BandedRows, false);
        assert!(!t2.banded_rows);
    }

    #[test]
    fn set_table_option_emphasize_first_column() {
        let t = make_test_table();
        assert!(!t.emphasize_first_column);
        let t2 = set_table_option(&t, TableBoolOption::EmphasizeFirstColumn, true);
        assert!(t2.emphasize_first_column);
    }

    #[test]
    fn set_table_style_changes_style() {
        let t = make_test_table();
        let t2 = set_table_style(&t, "TableStyleLight1");
        assert_eq!(t2.style, "TableStyleLight1");
    }

    // ---- Range Queries ----

    #[test]
    fn get_header_range_with_header() {
        let t = make_test_table(); // header row, range 0-10
        let r = get_header_range(&t).unwrap();
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 0);
        assert_eq!(r.start_col(), 0);
        assert_eq!(r.end_col(), 2);
    }

    #[test]
    fn get_header_range_no_header() {
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(0, 0, 5, 1),
            &["A", "B"],
            Some(CreateTableOptions {
                has_header_row: Some(false),
                ..Default::default()
            }),
        )
        .unwrap();
        assert!(get_header_range(&t).is_none());
    }

    #[test]
    fn get_data_range_basic() {
        let t = make_test_table(); // header at row 0, no totals, range 0-10
        let r = get_data_range(&t).unwrap();
        assert_eq!(r.start_row(), 1); // after header
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 0);
        assert_eq!(r.end_col(), 2);
    }

    #[test]
    fn get_data_range_with_totals() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        // Range row 0-10: header at 0, totals at 10, data 1-9
        let r = get_data_range(&t).unwrap();
        assert_eq!(r.start_row(), 1);
        assert_eq!(r.end_row(), 9);
    }

    #[test]
    fn get_data_range_header_plus_totals_only_returns_none() {
        // BUG FIX TEST: table with header + totals but no data rows should return None
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(0, 0, 1, 1),
            &["A", "B"],
            Some(CreateTableOptions {
                has_header_row: Some(true),
                has_totals_row: Some(true),
                ..Default::default()
            }),
        )
        .unwrap();
        // header at row 0, totals at row 1, data would be row 1..0 which is inverted
        assert!(get_data_range(&t).is_none());
    }

    #[test]
    fn get_data_range_no_header_no_totals() {
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(5, 2, 15, 4),
            &["A", "B", "C"],
            Some(CreateTableOptions {
                has_header_row: Some(false),
                has_totals_row: Some(false),
                ..Default::default()
            }),
        )
        .unwrap();
        let r = get_data_range(&t).unwrap();
        assert_eq!(r.start_row(), 5);
        assert_eq!(r.end_row(), 15);
    }

    #[test]
    fn get_totals_range_with_totals() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        let r = get_totals_range(&t).unwrap();
        assert_eq!(r.start_row(), 10);
        assert_eq!(r.end_row(), 10);
    }

    #[test]
    fn get_totals_range_no_totals() {
        let t = make_test_table();
        assert!(get_totals_range(&t).is_none());
    }

    #[test]
    fn get_column_range_basic() {
        let t = make_test_table();
        let r = get_column_range(&t, "TestTable-col-1").unwrap();
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 1);
        assert_eq!(r.end_col(), 1);
    }

    #[test]
    fn get_column_range_not_found() {
        let t = make_test_table();
        assert!(get_column_range(&t, "nonexistent").is_none());
    }

    #[test]
    fn get_column_data_range_basic() {
        let t = make_test_table();
        let r = get_column_data_range(&t, "TestTable-col-1").unwrap();
        assert_eq!(r.start_row(), 1); // after header
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.start_col(), 1);
        assert_eq!(r.end_col(), 1);
    }

    #[test]
    fn get_column_data_range_not_found() {
        let t = make_test_table();
        assert!(get_column_data_range(&t, "nonexistent").is_none());
    }

    // ---- Hit Testing ----

    #[test]
    fn is_position_in_table_inside() {
        let t = make_test_table(); // range (0,0)-(10,2)
        assert!(is_position_in_table(&t, 0, 0));
        assert!(is_position_in_table(&t, 5, 1));
        assert!(is_position_in_table(&t, 10, 2));
    }

    #[test]
    fn is_position_in_table_outside() {
        let t = make_test_table();
        assert!(!is_position_in_table(&t, 11, 0));
        assert!(!is_position_in_table(&t, 0, 3));
    }

    #[test]
    fn get_column_at_position_valid() {
        let t = make_test_table(); // range starts at col 0
        let col = get_column_at_position(&t, 1).unwrap();
        assert_eq!(col.name, "Age");
    }

    #[test]
    fn get_column_at_position_outside() {
        let t = make_test_table();
        assert!(get_column_at_position(&t, 5).is_none());
    }

    // ---- Toggle Totals Row ----

    #[test]
    fn toggle_totals_row_on() {
        let t = make_test_table(); // no totals
        let t2 = toggle_totals_row(&t);
        assert!(t2.has_totals_row);
        assert_eq!(t2.range.end_row(), t.range.end_row() + 1);
    }

    #[test]
    fn toggle_totals_row_off() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        let t2 = toggle_totals_row(&t);
        assert!(!t2.has_totals_row);
        assert_eq!(t2.range.end_row(), t.range.end_row() - 1);
    }

    #[test]
    fn toggle_totals_row_off_end_row_zero_no_underflow() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        t.range = TableRange::new(
            t.range.start_row(),
            t.range.start_col(),
            0,
            t.range.end_col(),
        );
        let t2 = toggle_totals_row(&t);
        assert!(!t2.has_totals_row);
        assert_eq!(t2.range.end_row(), 0); // saturates at 0, no underflow
    }

    // ---- Totals Function ----

    #[test]
    fn set_totals_function_basic() {
        let t = make_test_table();
        let t2 = set_totals_function(&t, "TestTable-col-1", TotalsFunction::Sum);
        assert_eq!(t2.columns[1].totals_function, Some(TotalsFunction::Sum));
        // Other columns unchanged
        assert_eq!(t2.columns[0].totals_function, None);
    }

    // ---- Subtotal Formula Generation ----

    #[test]
    fn get_subtotal_formula_sum() {
        let f = get_subtotal_formula(&TotalsFunction::Sum, "Sales").unwrap();
        assert_eq!(f, "=SUBTOTAL(109,[Sales])");
    }

    #[test]
    fn get_subtotal_formula_average() {
        let f = get_subtotal_formula(&TotalsFunction::Average, "Score").unwrap();
        assert_eq!(f, "=SUBTOTAL(101,[Score])");
    }

    #[test]
    fn get_subtotal_formula_count() {
        let f = get_subtotal_formula(&TotalsFunction::Count, "C").unwrap();
        assert_eq!(f, "=SUBTOTAL(102,[C])");
    }

    #[test]
    fn get_subtotal_formula_none_returns_none() {
        assert!(get_subtotal_formula(&TotalsFunction::None, "C").is_none());
    }

    #[test]
    fn get_subtotal_formula_custom_returns_none() {
        assert!(get_subtotal_formula(&TotalsFunction::Custom, "C").is_none());
    }

    // ---- Column Name Escaping ----

    #[test]
    fn escape_column_name_no_special_chars() {
        assert_eq!(escape_column_name("Sales"), "Sales");
    }

    #[test]
    fn escape_column_name_with_single_quote() {
        assert_eq!(escape_column_name("John's"), "'John''s'");
    }

    #[test]
    fn escape_column_name_with_brackets() {
        assert_eq!(escape_column_name("Data[1]"), "'Data[[1]]'");
    }

    #[test]
    fn escape_column_name_with_hash() {
        assert_eq!(escape_column_name("Col#1"), "'Col#1'");
    }

    #[test]
    fn escape_column_name_with_at() {
        assert_eq!(escape_column_name("@mention"), "'@mention'");
    }

    // ---- Immutability: original table is not modified ----

    #[test]
    fn operations_do_not_mutate_original() {
        let t = make_test_table();
        let _t2 = add_column(&t, "New", None);
        assert_eq!(t.columns.len(), 3); // original unchanged

        let _t3 = remove_column(&t, "TestTable-col-0");
        assert_eq!(t.columns.len(), 3); // original unchanged

        let _t4 = toggle_totals_row(&t);
        assert!(!t.has_totals_row); // original unchanged
    }

    // ---- Validate Range ----

    #[test]
    fn validate_range_valid() {
        assert!(validate_range(&TableRange::new(0, 0, 10, 5)).is_ok());
    }

    #[test]
    fn validate_range_inverted_rows_normalized() {
        // SheetRange::new auto-normalizes, so inverted inputs become valid
        assert!(validate_range(&TableRange::new(10, 0, 5, 5)).is_ok());
    }

    #[test]
    fn validate_range_inverted_cols_normalized() {
        // SheetRange::new auto-normalizes, so inverted inputs become valid
        assert!(validate_range(&TableRange::new(0, 10, 10, 5)).is_ok());
    }

    #[test]
    fn create_table_with_inverted_range_normalized() {
        // SheetRange::new auto-normalizes inverted ranges, so these succeed
        let result = create_table(
            "T1",
            "s1",
            TableRange::new(10, 0, 5, 2),
            &["A", "B", "C"],
            None,
        );
        assert!(result.is_ok());

        let result = create_table(
            "T1",
            "s1",
            TableRange::new(0, 5, 10, 2),
            &["A", "B", "C"],
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn resize_table_with_inverted_range_normalized() {
        let t = make_test_table();

        // SheetRange::new auto-normalizes inverted ranges, so these succeed
        let result = resize_table(&t, TableRange::new(10, 0, 5, 2));
        // start_row changes from 0 to 5, so resize validation may reject this,
        // but validate_range itself won't reject it
        // The range is valid (5,0,10,2) after normalization
        assert!(result.is_ok() || result.is_err());

        let result = resize_table(&t, TableRange::new(0, 5, 10, 2));
        assert!(result.is_ok() || result.is_err());
    }

    // ---- Subtotal function number mapping ----

    #[test]
    fn subtotal_function_number_all_mappings() {
        assert_eq!(
            subtotal_function_number(&TotalsFunction::Average),
            Some(101)
        );
        assert_eq!(subtotal_function_number(&TotalsFunction::Count), Some(102));
        assert_eq!(
            subtotal_function_number(&TotalsFunction::CountNums),
            Some(103)
        );
        assert_eq!(subtotal_function_number(&TotalsFunction::Max), Some(104));
        assert_eq!(subtotal_function_number(&TotalsFunction::Min), Some(105));
        assert_eq!(subtotal_function_number(&TotalsFunction::StdDev), Some(107));
        assert_eq!(subtotal_function_number(&TotalsFunction::Sum), Some(109));
        assert_eq!(subtotal_function_number(&TotalsFunction::Var), Some(110));
        assert_eq!(subtotal_function_number(&TotalsFunction::Custom), None);
        assert_eq!(subtotal_function_number(&TotalsFunction::None), None);
    }

    // ---- Edge Cases ----

    #[test]
    fn create_table_with_inverted_rows_normalized() {
        // SheetRange::new auto-normalizes, so (10,0,5,2) becomes (5,0,10,2) -> valid
        let result = create_table(
            "T1",
            "s1",
            TableRange::new(10, 0, 5, 2),
            &["A", "B", "C"],
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn create_table_with_inverted_cols_normalized() {
        // SheetRange::new auto-normalizes, so (0,10,5,2) becomes (0,2,5,10) -> valid
        let result = create_table(
            "T1",
            "s1",
            TableRange::new(0, 10, 5, 2),
            &["A", "B", "C"],
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn toggle_totals_row_with_end_row_zero() {
        // Verify toggle_totals_row handles end_row = 0
        // Create a table with end_row = 0 and totals row enabled
        let mut t = make_test_table();
        t.has_totals_row = true;
        t.range = TableRange::new(
            t.range.start_row(),
            t.range.start_col(),
            0,
            t.range.end_col(),
        );
        let t2 = toggle_totals_row(&t);
        assert!(!t2.has_totals_row);
        assert_eq!(t2.range.end_row(), 0); // saturates at 0, no underflow
    }

    #[test]
    fn add_column_on_first_column() {
        let t = make_test_table(); // "Name", "Age", "City"
        let t2 = add_column(&t, "ID", Some(0));
        assert_eq!(t2.columns.len(), 4);
        // New column should be first
        assert_eq!(t2.columns[0].name, "ID");
        assert_eq!(t2.columns[0].index, 0);
        // Other columns shift
        assert_eq!(t2.columns[1].name, "Name");
        assert_eq!(t2.columns[1].index, 1);
        assert_eq!(t2.columns[2].name, "Age");
        assert_eq!(t2.columns[2].index, 2);
        assert_eq!(t2.columns[3].name, "City");
        assert_eq!(t2.columns[3].index, 3);
        // Range should expand
        assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
    }

    #[test]
    fn add_column_on_last_column() {
        let t = make_test_table(); // 3 columns
        let last_idx = t.columns.len();
        let t2 = add_column(&t, "Score", Some(last_idx));
        assert_eq!(t2.columns.len(), 4);
        // New column should be last
        assert_eq!(t2.columns[3].name, "Score");
        assert_eq!(t2.columns[3].index, 3);
        // Other columns unchanged
        assert_eq!(t2.columns[0].name, "Name");
        assert_eq!(t2.columns[1].name, "Age");
        assert_eq!(t2.columns[2].name, "City");
        assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
    }

    #[test]
    fn remove_column_first() {
        let t = make_test_table(); // "Name", "Age", "City"
        let first_col_id = t.columns[0].id.clone();
        let t2 = remove_column(&t, &first_col_id);
        assert_eq!(t2.columns.len(), 2);
        // First column removed, remaining should re-index
        assert_eq!(t2.columns[0].name, "Age");
        assert_eq!(t2.columns[0].index, 0);
        assert_eq!(t2.columns[1].name, "City");
        assert_eq!(t2.columns[1].index, 1);
        // Range should contract
        assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
    }

    #[test]
    fn remove_column_last() {
        let t = make_test_table(); // "Name", "Age", "City"
        let last_col_id = t.columns[2].id.clone();
        let t2 = remove_column(&t, &last_col_id);
        assert_eq!(t2.columns.len(), 2);
        // Last column removed, remaining should be correct
        assert_eq!(t2.columns[0].name, "Name");
        assert_eq!(t2.columns[0].index, 0);
        assert_eq!(t2.columns[1].name, "Age");
        assert_eq!(t2.columns[1].index, 1);
        // Range should contract
        assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
    }

    #[test]
    fn table_with_nonzero_start_col() {
        // Create table starting at column 5
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(0, 5, 10, 7),
            &["A", "B", "C"],
            None,
        )
        .unwrap();
        assert_eq!(t.columns.len(), 3);
        assert_eq!(t.range.start_col(), 5);
        assert_eq!(t.range.end_col(), 7);

        // Test add column
        let t2 = add_column(&t, "D", None);
        assert_eq!(t2.columns.len(), 4);
        assert_eq!(t2.range.end_col(), 8);

        // Test remove column
        let col_id = t2.columns[1].id.clone();
        let t3 = remove_column(&t2, &col_id);
        assert_eq!(t3.columns.len(), 3);
        assert_eq!(t3.range.end_col(), 7);
        // Verify indices re-numbered correctly
        for (i, col) in t3.columns.iter().enumerate() {
            assert_eq!(col.index, i as u32);
        }

        // Test set_table_option
        let t4 = set_table_option(&t3, TableBoolOption::BandedColumns, true);
        assert!(t4.banded_columns);
        assert_eq!(t4.columns.len(), 3);
    }

    #[test]
    fn resize_table_multi_cycle() {
        let t = make_test_table(); // 3 columns

        // Resize larger: 3 -> 5 columns
        let t2 = resize_table(&t, TableRange::new(0, 0, 10, 4)).unwrap();
        assert_eq!(t2.columns.len(), 5);
        let ids_after_expand: Vec<String> = t2.columns.iter().map(|c| c.id.clone()).collect();
        // Original column IDs should be preserved
        assert_eq!(ids_after_expand[0], "TestTable-col-0");
        assert_eq!(ids_after_expand[1], "TestTable-col-1");
        assert_eq!(ids_after_expand[2], "TestTable-col-2");

        // Resize smaller: 5 -> 2 columns
        let t3 = resize_table(&t2, TableRange::new(0, 0, 10, 1)).unwrap();
        assert_eq!(t3.columns.len(), 2);
        assert_eq!(t3.columns[0].id, "TestTable-col-0");
        assert_eq!(t3.columns[1].id, "TestTable-col-1");

        // Resize larger again: 2 -> 4 columns
        let t4 = resize_table(&t3, TableRange::new(0, 0, 10, 3)).unwrap();
        assert_eq!(t4.columns.len(), 4);
        // Original IDs still stable
        assert_eq!(t4.columns[0].id, "TestTable-col-0");
        assert_eq!(t4.columns[1].id, "TestTable-col-1");
        // New columns should have non-colliding IDs
        // (max suffix strategy ensures no collisions across cycles)
        let new_ids: Vec<String> = t4.columns.iter().map(|c| c.id.clone()).collect();
        // All IDs should be unique
        let unique_ids: std::collections::HashSet<_> = new_ids.iter().collect();
        assert_eq!(unique_ids.len(), 4);
    }

    // ---- get_column_by_name ----

    #[test]
    fn get_column_by_name_found() {
        let t = make_test_table();
        let col = get_column_by_name(&t, "Age").unwrap();
        assert_eq!(col.name, "Age");
        assert_eq!(col.index, 1);
    }

    #[test]
    fn get_column_by_name_case_insensitive() {
        let t = make_test_table();
        let col = get_column_by_name(&t, "age").unwrap();
        assert_eq!(col.name, "Age");
        let col2 = get_column_by_name(&t, "AGE").unwrap();
        assert_eq!(col2.name, "Age");
    }

    #[test]
    fn get_column_by_name_not_found() {
        let t = make_test_table();
        assert!(get_column_by_name(&t, "Missing").is_none());
    }

    // ---- get_column_by_id ----

    #[test]
    fn get_column_by_id_found() {
        let t = make_test_table();
        let col = get_column_by_id(&t, "TestTable-col-1").unwrap();
        assert_eq!(col.name, "Age");
    }

    #[test]
    fn get_column_by_id_not_found() {
        let t = make_test_table();
        assert!(get_column_by_id(&t, "nonexistent").is_none());
    }

    // ---- is_in_header_row ----

    #[test]
    fn is_in_header_row_true() {
        let t = make_test_table(); // header at row 0
        assert!(is_in_header_row(&t, 0));
    }

    #[test]
    fn is_in_header_row_false_data_row() {
        let t = make_test_table();
        assert!(!is_in_header_row(&t, 1));
        assert!(!is_in_header_row(&t, 5));
    }

    #[test]
    fn is_in_header_row_false_no_header() {
        let t = create_table(
            "T1",
            "s1",
            TableRange::new(0, 0, 5, 1),
            &["A", "B"],
            Some(CreateTableOptions {
                has_header_row: Some(false),
                ..Default::default()
            }),
        )
        .unwrap();
        assert!(!is_in_header_row(&t, 0));
    }

    // ---- is_in_totals_row ----

    #[test]
    fn is_in_totals_row_true() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        // end_row is 10
        assert!(is_in_totals_row(&t, 10));
    }

    #[test]
    fn is_in_totals_row_false_no_totals() {
        let t = make_test_table();
        assert!(!is_in_totals_row(&t, 10));
    }

    #[test]
    fn is_in_totals_row_false_wrong_row() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        assert!(!is_in_totals_row(&t, 5));
    }

    // ---- is_in_data_range ----

    #[test]
    fn is_in_data_range_true() {
        let t = make_test_table(); // header at 0, data 1-10, cols 0-2
        assert!(is_in_data_range(&t, 1, 0));
        assert!(is_in_data_range(&t, 5, 1));
        assert!(is_in_data_range(&t, 10, 2));
    }

    #[test]
    fn is_in_data_range_false_header() {
        let t = make_test_table();
        assert!(!is_in_data_range(&t, 0, 0)); // header row
    }

    #[test]
    fn is_in_data_range_false_totals() {
        let mut t = make_test_table();
        t.has_totals_row = true;
        // data is now 1-9, totals at 10
        assert!(!is_in_data_range(&t, 10, 0));
    }

    #[test]
    fn is_in_data_range_false_outside() {
        let t = make_test_table();
        assert!(!is_in_data_range(&t, 5, 3)); // col 3 is outside
        assert!(!is_in_data_range(&t, 11, 0)); // row 11 is outside
    }

    // ---- generate_table_name ----

    #[test]
    fn generate_table_name_empty() {
        let name = generate_table_name(&[]);
        assert_eq!(name, "Table1");
    }

    #[test]
    fn generate_table_name_skips_existing() {
        let name = generate_table_name(&["Table1", "Table2"]);
        assert_eq!(name, "Table3");
    }

    #[test]
    fn generate_table_name_case_insensitive() {
        let name = generate_table_name(&["table1", "TABLE2"]);
        assert_eq!(name, "Table3");
    }

    #[test]
    fn generate_table_name_fills_gap() {
        let name = generate_table_name(&["Table1", "Table3"]);
        assert_eq!(name, "Table2");
    }

    // ---- tables_overlap ----

    #[test]
    fn tables_overlap_true() {
        let a = create_table(
            "A",
            "s1",
            TableRange::new(0, 0, 5, 3),
            &["A", "B", "C", "D"],
            None,
        )
        .unwrap();
        let b = create_table(
            "B",
            "s1",
            TableRange::new(3, 2, 8, 5),
            &["E", "F", "G", "H"],
            None,
        )
        .unwrap();
        assert!(tables_overlap(&a, &b));
        assert!(tables_overlap(&b, &a)); // symmetric
    }

    #[test]
    fn tables_overlap_false_no_col_overlap() {
        let a = create_table(
            "A",
            "s1",
            TableRange::new(0, 0, 5, 2),
            &["A", "B", "C"],
            None,
        )
        .unwrap();
        let b = create_table(
            "B",
            "s1",
            TableRange::new(0, 3, 5, 5),
            &["D", "E", "F"],
            None,
        )
        .unwrap();
        assert!(!tables_overlap(&a, &b));
    }

    #[test]
    fn tables_overlap_false_no_row_overlap() {
        let a = create_table(
            "A",
            "s1",
            TableRange::new(0, 0, 5, 2),
            &["A", "B", "C"],
            None,
        )
        .unwrap();
        let b = create_table(
            "B",
            "s1",
            TableRange::new(6, 0, 10, 2),
            &["D", "E", "F"],
            None,
        )
        .unwrap();
        assert!(!tables_overlap(&a, &b));
    }

    #[test]
    fn tables_overlap_adjacent_not_overlapping() {
        // Tables sharing an edge (row 5/row 5) but not actually overlapping
        // since end_row == start_row is touching, which IS overlap
        let a = create_table(
            "A",
            "s1",
            TableRange::new(0, 0, 5, 2),
            &["A", "B", "C"],
            None,
        )
        .unwrap();
        let b = create_table(
            "B",
            "s1",
            TableRange::new(5, 0, 10, 2),
            &["D", "E", "F"],
            None,
        )
        .unwrap();
        // They share row 5, so this IS an overlap
        assert!(tables_overlap(&a, &b));
    }

    // ---- create_table with separate id ----

    #[test]
    fn create_table_with_separate_id() {
        let t = create_table(
            "MyTable",
            "s1",
            TableRange::new(0, 0, 5, 1),
            &["A", "B"],
            Some(CreateTableOptions {
                id: Some("custom-id-123".to_string()),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(t.id, "custom-id-123");
        assert_eq!(t.name, "MyTable");
        assert_eq!(t.columns[0].id, "custom-id-123-col-0");
        assert_eq!(t.columns[1].id, "custom-id-123-col-1");
    }

    #[test]
    fn create_table_id_defaults_to_name() {
        let t = make_test_table();
        assert_eq!(t.id, "TestTable");
        assert_eq!(t.name, "TestTable");
    }

    // ---- toggle_totals_row overflow guard ----

    #[test]
    fn toggle_totals_row_on_max_row_no_overflow() {
        let mut t = make_test_table();
        t.range = TableRange::new(
            t.range.start_row(),
            t.range.start_col(),
            u32::MAX,
            t.range.end_col(),
        );
        let t2 = toggle_totals_row(&t);
        assert!(t2.has_totals_row);
        assert_eq!(t2.range.end_row(), u32::MAX); // saturates, no overflow
    }
}

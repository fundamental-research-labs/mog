use super::super::error::TableError;
use super::super::types::{Table, TableColumn, TableRange};
use super::create::validate_range;

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

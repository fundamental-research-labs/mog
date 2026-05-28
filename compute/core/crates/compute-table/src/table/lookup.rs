use super::super::types::{Table, TableColumn};

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

//! Table Core - CRUD operations and validation for Excel-style tables.
//!
//! Ported from `spreadsheet-model/src/tables/core.ts`.
//!
//! This module provides higher-level table management that operates on
//! collections of tables (overlap detection, name uniqueness, resize validation).
//! The lower-level pure table operations live in `table.rs`.

use super::table::{generate_table_name, is_position_in_table, validate_table_name};
use super::types::{Table, TableRange};

// ============================================================================
// Table Resize Validation
// ============================================================================

/// Result of table resize validation.
#[derive(Debug, Clone, PartialEq)]
pub struct TableResizeValidation {
    /// Whether the resize is valid.
    pub valid: bool,
    /// Error message if invalid.
    pub error: Option<String>,
    /// Name of overlapping table if any.
    pub overlapping_table: Option<String>,
}

impl TableResizeValidation {
    /// Create a valid result.
    pub fn ok() -> Self {
        Self {
            valid: true,
            error: None,
            overlapping_table: None,
        }
    }

    /// Create an invalid result with an error message.
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            valid: false,
            error: Some(msg.into()),
            overlapping_table: None,
        }
    }

    /// Create an invalid result due to table overlap.
    pub fn overlap(table_name: impl Into<String>) -> Self {
        let name = table_name.into();
        Self {
            valid: false,
            error: Some(format!("Resize would overlap with table \"{}\"", name)),
            overlapping_table: Some(name),
        }
    }
}

/// Validate a proposed table resize.
///
/// Checks:
/// - Minimum 1 data row (header row + at least 1 data row)
/// - No overlap with other tables on the same sheet
/// - Start position must not change (only bottom-right can move)
pub fn validate_table_resize(
    table: &Table,
    new_range: &TableRange,
    other_tables: &[Table],
) -> TableResizeValidation {
    if new_range.start_row() != table.range.start_row()
        || new_range.start_col() != table.range.start_col()
    {
        return TableResizeValidation::err("Table start position cannot change during resize");
    }

    let header_rows: u32 = if table.has_header_row { 1 } else { 0 };
    let total_rows: u32 = if table.has_totals_row { 1 } else { 0 };
    let new_row_count = new_range.end_row().saturating_sub(new_range.start_row()) + 1;
    let data_rows = new_row_count.saturating_sub(header_rows + total_rows);

    if data_rows < 1 {
        return TableResizeValidation::err("Table must have at least 1 data row");
    }

    let col_count = new_range.end_col().saturating_sub(new_range.start_col()) + 1;
    if col_count < 1 {
        return TableResizeValidation::err("Table must have at least 1 column");
    }

    if let Some(name) = find_overlapping_table(new_range, other_tables, Some(&table.id)) {
        return TableResizeValidation::overlap(name);
    }

    TableResizeValidation::ok()
}

// ============================================================================
// Overlap Detection
// ============================================================================

/// Check if two ranges overlap.
pub fn ranges_overlap(a: &TableRange, b: &TableRange) -> bool {
    if a.end_col() < b.start_col() || a.start_col() > b.end_col() {
        return false;
    }
    if a.end_row() < b.start_row() || a.start_row() > b.end_row() {
        return false;
    }
    true
}

/// Find a table whose range overlaps with the given range.
pub fn find_overlapping_table(
    range: &TableRange,
    tables: &[Table],
    exclude_table_id: Option<&str>,
) -> Option<String> {
    for table in tables {
        if let Some(exclude_id) = exclude_table_id
            && table.id == exclude_id
        {
            continue;
        }
        if ranges_overlap(range, &table.range) {
            return Some(table.name.clone());
        }
    }
    None
}

// ============================================================================
// Name Validation (with collection context)
// ============================================================================

/// Check if a table name is valid and unique within a collection.
pub fn is_valid_table_name(
    name: &str,
    existing_tables: &[Table],
    exclude_table_id: Option<&str>,
) -> bool {
    if validate_table_name(name).is_err() {
        return false;
    }

    let lower_name = name.to_lowercase();
    for table in existing_tables {
        if let Some(exclude_id) = exclude_table_id
            && table.id == exclude_id
        {
            continue;
        }
        if table.name.to_lowercase() == lower_name {
            return false;
        }
    }

    true
}

/// Generate a unique table name within a collection.
pub fn generate_unique_table_name(existing_tables: &[Table]) -> String {
    let names: Vec<&str> = existing_tables.iter().map(|t| t.name.as_str()).collect();
    generate_table_name(&names)
}

// ============================================================================
// Cell-in-Table Queries
// ============================================================================

/// Get the table containing a specific cell position.
pub fn get_table_at_cell(tables: &[Table], row: u32, col: u32) -> Option<&Table> {
    tables.iter().find(|t| is_position_in_table(t, row, col))
}

/// Check if a cell position is inside any table.
pub fn is_cell_in_any_table(tables: &[Table], row: u32, col: u32) -> bool {
    get_table_at_cell(tables, row, col).is_some()
}

// ============================================================================
// Table Lookup
// ============================================================================

/// Find a table by ID.
pub fn find_table_by_id<'a>(tables: &'a [Table], table_id: &str) -> Option<&'a Table> {
    tables.iter().find(|t| t.id == table_id)
}

/// Find a table by name (case-insensitive).
pub fn find_table_by_name<'a>(tables: &'a [Table], name: &str) -> Option<&'a Table> {
    let lower = name.to_lowercase();
    tables.iter().find(|t| t.name.to_lowercase() == lower)
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

    #[test]
    fn validate_resize_valid() {
        let t = make_table("T1", 0, 0, 10, 2);
        let nr = TableRange::new(0, 0, 15, 2);
        assert!(validate_table_resize(&t, &nr, &[]).valid);
    }

    #[test]
    fn validate_resize_start_position_changed() {
        let t = make_table("T1", 0, 0, 10, 2);
        let nr = TableRange::new(1, 0, 15, 2);
        let r = validate_table_resize(&t, &nr, &[]);
        assert!(!r.valid);
        assert!(r.error.unwrap().contains("start position"));
    }

    #[test]
    fn validate_resize_too_few_data_rows() {
        let t = make_table("T1", 0, 0, 10, 2);
        let nr = TableRange::new(0, 0, 0, 2);
        let r = validate_table_resize(&t, &nr, &[]);
        assert!(!r.valid);
        assert!(r.error.unwrap().contains("data row"));
    }

    #[test]
    fn validate_resize_overlap_detected() {
        let t = make_table("T1", 0, 0, 10, 2);
        let other = make_table("T2", 12, 0, 20, 2);
        let nr = TableRange::new(0, 0, 15, 2);
        let r = validate_table_resize(&t, &nr, &[other]);
        assert!(!r.valid);
        assert_eq!(r.overlapping_table.as_deref(), Some("T2"));
    }

    #[test]
    fn validate_resize_excludes_self() {
        let t = make_table("T1", 0, 0, 10, 2);
        let nr = TableRange::new(0, 0, 15, 2);
        assert!(validate_table_resize(&t, &nr, &[t.clone()]).valid);
    }

    #[test]
    fn ranges_overlap_true() {
        let a = TableRange::new(0, 0, 5, 3);
        let b = TableRange::new(3, 2, 8, 5);
        assert!(ranges_overlap(&a, &b));
        assert!(ranges_overlap(&b, &a));
    }

    #[test]
    fn ranges_overlap_false() {
        let a = TableRange::new(0, 0, 5, 2);
        let b = TableRange::new(0, 3, 5, 5);
        assert!(!ranges_overlap(&a, &b));
    }

    #[test]
    fn ranges_overlap_adjacent_touching() {
        let a = TableRange::new(0, 0, 5, 2);
        let b = TableRange::new(5, 0, 10, 2);
        assert!(ranges_overlap(&a, &b));
    }

    #[test]
    fn valid_name_unique() {
        let tables = vec![make_table("Table1", 0, 0, 5, 2)];
        assert!(is_valid_table_name("Table2", &tables, None));
    }

    #[test]
    fn invalid_name_duplicate() {
        let tables = vec![make_table("Table1", 0, 0, 5, 2)];
        assert!(!is_valid_table_name("Table1", &tables, None));
    }

    #[test]
    fn invalid_name_duplicate_case_insensitive() {
        let tables = vec![make_table("Table1", 0, 0, 5, 2)];
        assert!(!is_valid_table_name("table1", &tables, None));
    }

    #[test]
    fn valid_name_exclude_self() {
        let t = make_table("Table1", 0, 0, 5, 2);
        assert!(is_valid_table_name("Table1", &[t.clone()], Some(&t.id)));
    }

    #[test]
    fn invalid_name_cell_ref() {
        assert!(!is_valid_table_name("A1", &[], None));
    }

    #[test]
    fn invalid_name_empty() {
        assert!(!is_valid_table_name("", &[], None));
    }

    #[test]
    fn generate_name_empty() {
        assert_eq!(generate_unique_table_name(&[]), "Table1");
    }

    #[test]
    fn generate_name_skips_existing() {
        let tables = vec![
            make_table("Table1", 0, 0, 5, 2),
            make_table("Table2", 7, 0, 12, 2),
        ];
        assert_eq!(generate_unique_table_name(&tables), "Table3");
    }

    #[test]
    fn generate_name_fills_gap() {
        let tables = vec![
            make_table("Table1", 0, 0, 5, 2),
            make_table("Table3", 7, 0, 12, 2),
        ];
        assert_eq!(generate_unique_table_name(&tables), "Table2");
    }

    #[test]
    fn get_table_at_cell_found() {
        let tables = vec![
            make_table("T1", 0, 0, 10, 2),
            make_table("T2", 12, 0, 20, 2),
        ];
        assert_eq!(get_table_at_cell(&tables, 5, 1).unwrap().name, "T1");
    }

    #[test]
    fn get_table_at_cell_not_found() {
        assert!(get_table_at_cell(&[make_table("T1", 0, 0, 10, 2)], 11, 0).is_none());
    }

    #[test]
    fn find_by_id() {
        let t = make_table("T1", 0, 0, 5, 2);
        assert_eq!(find_table_by_id(&[t.clone()], &t.id).unwrap().name, "T1");
    }

    #[test]
    fn find_by_id_not_found() {
        assert!(find_table_by_id(&[make_table("T1", 0, 0, 5, 2)], "nope").is_none());
    }

    #[test]
    fn find_by_name_case_insensitive() {
        let tables = vec![make_table("MyTable", 0, 0, 5, 2)];
        assert_eq!(
            find_table_by_name(&tables, "mytable").unwrap().name,
            "MyTable"
        );
    }

    #[test]
    fn find_by_name_not_found() {
        assert!(find_table_by_name(&[make_table("T1", 0, 0, 5, 2)], "Missing").is_none());
    }
}

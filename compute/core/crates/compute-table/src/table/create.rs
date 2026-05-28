use super::super::error::TableError;
use super::super::types::{Table, TableColumn, TableRange};

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
pub(crate) fn validate_range(range: &TableRange) -> Result<(), TableError> {
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

#![allow(unused_imports, unused_variables)]
use super::*;

// -------------------------------------------------------------------
// Table Queries (read-only)
// -------------------------------------------------------------------

/// Get all tables in a specific sheet.
pub(in crate::storage::engine) fn get_all_tables_in_sheet(
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<CanonicalTable> {
    let sheet_hex = sheet_id.to_uuid_string();
    mirror
        .all_tables()
        .iter()
        .filter(|t| t.sheet_id == sheet_hex)
        .cloned()
        .collect()
}

/// Get the table containing a specific cell, if any.
pub(in crate::storage::engine) fn get_table_at_cell(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CanonicalTable> {
    let sheet_hex = sheet_id.to_uuid_string();
    mirror
        .all_tables()
        .iter()
        .find(|t| {
            t.sheet_id == sheet_hex
                && row >= t.range.start_row()
                && row <= t.range.end_row()
                && col >= t.range.start_col()
                && col <= t.range.end_col()
        })
        .cloned()
}

/// Look up a table definition by name (case-insensitive).
pub(in crate::storage::engine) fn get_table_by_name(
    mirror: &CellMirror,
    table_name: &str,
) -> Option<CanonicalTable> {
    mirror.get_table(table_name).cloned()
}

/// Get which table region a cell falls in (header, data, or totals).
pub(in crate::storage::engine) fn get_table_hit_region(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<TableHitRegion> {
    let sheet_hex = sheet_id.to_uuid_string();
    let t = mirror.all_tables().iter().find(|t| {
        t.sheet_id == sheet_hex
            && row >= t.range.start_row()
            && row <= t.range.end_row()
            && col >= t.range.start_col()
            && col <= t.range.end_col()
    })?;

    let region = if row == t.range.start_row() && t.has_header_row {
        "header"
    } else if t.has_totals_row && row == t.range.end_row() {
        "totals"
    } else {
        "data"
    };
    let column_index = col - t.range.start_col();
    let column_name = t
        .columns
        .get(column_index as usize)
        .map(|c| c.name.clone())
        .unwrap_or_default();

    Some(TableHitRegion {
        table_name: t.name.clone(),
        region: region.to_string(),
        column_index,
        start_row: t.range.start_row(),
        start_col: t.range.start_col(),
        end_row: t.range.end_row(),
        end_col: t.range.end_col(),
        has_headers: t.has_header_row,
        has_totals: t.has_totals_row,
        column_name,
    })
}

/// Detect if a table should auto-expand based on adjacent data.
pub(in crate::storage::engine) fn detect_auto_expansion(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table_name: &str,
) -> Result<AutoExpansionResult, ComputeError> {
    let sheet_hex = sheet_id.to_uuid_string();
    let table = &mirror
        .all_tables()
        .iter()
        .find(|t| t.name == table_name && t.sheet_id == sheet_hex)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {} in sheet", table_name),
        })?;
    // TODO: Implement actual auto-expansion detection.
    Ok(AutoExpansionResult {
        should_expand: false,
        new_end_row: table.range.end_row(),
        new_end_col: table.range.end_col(),
    })
}

/// Resolve the table-derived CellFormat for a cell, if it is inside a table.
pub(in crate::storage::engine) fn resolve_table_format_at_cell(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellFormat> {
    let sheet_hex = sheet_id.to_uuid_string();
    let table = &mirror.all_tables().iter().find(|t| {
        t.sheet_id == sheet_hex
            && row >= t.range.start_row()
            && row <= t.range.end_row()
            && col >= t.range.start_col()
            && col <= t.range.end_col()
    })?;

    let ct_table = crate::storage::table_format::build_table_for_style_resolution(table);
    let tcf = compute_table::styles::resolve_table_cell_format(&ct_table, row, col)?;
    Some(crate::storage::table_format::table_cell_format_to_cell_format(&tcf))
}

/// Get all custom table styles.
pub(in crate::storage::engine) fn get_all_custom_table_styles(
    stores: &EngineStores,
) -> Vec<compute_table::custom_styles::CustomTableStyleConfig> {
    let mut result: Vec<_> = stores.custom_table_styles.values().cloned().collect();
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

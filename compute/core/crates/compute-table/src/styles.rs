//! Table Styles - pure computation for table cell format resolution.
//!
//! Every function is pure and stateless. No DOM, no Yjs, no React.

mod borders;
mod builtins;
mod resolver;

use crate::types::{Table, TableCellFormat, TableStyleDef};

/// Default style used when the table's style ID is not found.
pub const DEFAULT_STYLE_ID: &str = "TableStyleMedium2";

/// Look up a built-in table style by ID.
pub fn get_built_in_style(id: &str) -> Option<&'static TableStyleDef> {
    builtins::get(id)
}

/// Return all built-in Excel table style definitions.
pub fn get_all_built_in_styles() -> Vec<&'static TableStyleDef> {
    builtins::all()
}

/// Resolve the cell format for a given grid position within a table.
pub fn resolve_table_cell_format(table: &Table, row: u32, col: u32) -> Option<TableCellFormat> {
    resolver::resolve_table_cell_format(table, row, col)
}

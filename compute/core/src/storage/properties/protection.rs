use super::cell::get_cell_format;
use cell_types::SheetId;
use yrs::{Doc, MapRef};

/// Check if a cell is locked (for protection purposes).
///
/// Defaults to `true` per Excel convention -- all cells are locked
/// unless explicitly set to `false`.
pub fn is_cell_locked(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> bool {
    get_cell_format(doc, workbook, sheets, sheet_id, cell_id)
        .and_then(|f| f.locked)
        .unwrap_or(true)
}

/// Check if a cell's formula should be hidden in the formula bar.
///
/// Defaults to `false` -- formulas are visible unless explicitly hidden.
pub fn is_formula_hidden(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> bool {
    get_cell_format(doc, workbook, sheets, sheet_id, cell_id)
        .and_then(|f| f.hidden)
        .unwrap_or(false)
}

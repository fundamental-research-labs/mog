use super::super::structured_refs::escape_column_name;
use super::super::types::{Table, TableColumn, TableRange, TotalsFunction};

/// Map TotalsFunction → Excel SUBTOTAL function number (101+ series).
///
/// Note: function number 106 (PRODUCT) is intentionally skipped — Excel's SUBTOTAL
/// function does not support PRODUCT, so there is no mapping for it.
pub(super) fn subtotal_function_number(func: &TotalsFunction) -> Option<u32> {
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

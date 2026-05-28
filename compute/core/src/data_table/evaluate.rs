use rustc_hash::FxHashMap;

use cell_types::CellId;
use value_types::CellValue;

use super::types::DataTableResult;

/// Calculate a data table by evaluating a formula with each combination of input values.
///
/// `evaluate` takes a map of CellId -> CellValue overrides and returns the formula result.
/// The overrides temporarily replace cell values during evaluation without modifying the
/// underlying CellMirror.
///
/// # Arguments
///
/// * `row_input_cell` - CellId of the row input cell (None for column-only tables)
/// * `col_input_cell` - CellId of the column input cell (None for row-only tables)
/// * `row_values` - Input values to substitute for the row input cell
/// * `col_values` - Input values to substitute for the column input cell
/// * `evaluate` - Closure that evaluates the formula with the given overrides
///
/// # Returns
///
/// A `DataTableResult` containing the 2D grid of results and metadata.
pub fn calculate_data_table<F>(
    row_input_cell: Option<CellId>,
    col_input_cell: Option<CellId>,
    row_values: &[CellValue],
    col_values: &[CellValue],
    mut evaluate: F,
) -> DataTableResult
where
    F: FnMut(&FxHashMap<CellId, CellValue>) -> CellValue,
{
    let mut results = Vec::new();
    let mut cell_count = 0u32;

    let is_one_var_row = row_input_cell.is_some() && col_input_cell.is_none();
    let is_one_var_col = row_input_cell.is_none() && col_input_cell.is_some();
    let is_two_var = row_input_cell.is_some() && col_input_cell.is_some();

    // Must have at least one input cell specified
    if !is_one_var_row && !is_one_var_col && !is_two_var {
        return DataTableResult {
            results,
            cell_count,
            cancelled: false,
        };
    }

    if is_one_var_row {
        // One-variable row table: substitute each row value into the row input cell
        let input_id = row_input_cell.unwrap();
        for value in row_values {
            let mut overrides = FxHashMap::default();
            overrides.insert(input_id, value.clone());
            let result = evaluate(&overrides);
            results.push(vec![result]);
            cell_count += 1;
        }
    } else if is_one_var_col {
        // One-variable column table: substitute each column value into the column input cell
        let input_id = col_input_cell.unwrap();
        let mut row = Vec::with_capacity(col_values.len());
        for value in col_values {
            let mut overrides = FxHashMap::default();
            overrides.insert(input_id, value.clone());
            let result = evaluate(&overrides);
            row.push(result);
            cell_count += 1;
        }
        results.push(row);
    } else {
        // Two-variable table: substitute both row and column values.
        //
        // row_input_cell receives row_values (one per row in the output grid),
        // col_input_cell receives col_values (one per column in the output grid).
        //
        // NOTE: Callers that map from the Excel TABLE(row_input, col_input)
        // convention — where row_input gets top-row headers and col_input gets
        // left-column headers — must swap the value arrays before calling this
        // function (see data_table_prepass.rs).
        let row_id = row_input_cell.unwrap();
        let col_id = col_input_cell.unwrap();
        for row_val in row_values {
            let mut row = Vec::with_capacity(col_values.len());
            for col_val in col_values {
                let mut overrides = FxHashMap::default();
                overrides.insert(row_id, row_val.clone());
                overrides.insert(col_id, col_val.clone());
                let result = evaluate(&overrides);
                row.push(result);
                cell_count += 1;
            }
            results.push(row);
        }
    }

    DataTableResult {
        results,
        cell_count,
        cancelled: false,
    }
}

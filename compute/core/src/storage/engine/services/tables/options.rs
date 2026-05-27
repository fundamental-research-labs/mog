#![allow(unused_imports, unused_variables)]
use super::*;

// -------------------------------------------------------------------
// Table Bool Options & Row Add/Remove
// -------------------------------------------------------------------

/// Set a boolean option on a table (proper set semantics, not toggle).
pub(in crate::storage::engine) fn set_table_bool_option(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    option: &str,
    value: bool,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let opt = match option {
        "bandedRows" => compute_table::types::TableBoolOption::BandedRows,
        "bandedColumns" => compute_table::types::TableBoolOption::BandedColumns,
        "emphasizeFirstColumn" => compute_table::types::TableBoolOption::EmphasizeFirstColumn,
        "emphasizeLastColumn" => compute_table::types::TableBoolOption::EmphasizeLastColumn,
        "showFilterButtons" => compute_table::types::TableBoolOption::ShowFilterButtons,
        _ => {
            return Err(ComputeError::Eval {
                message: format!("Unknown table option: {}", option),
            });
        }
    };

    let updated = compute_table::table::set_table_option(&table, opt, value);
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Set table auto-expansion policy.
pub(in crate::storage::engine) fn set_table_auto_expand(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    enabled: bool,
) -> Result<MutationResult, ComputeError> {
    let mut table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    if table.auto_expand == enabled {
        return Ok(MutationResult::empty());
    }

    table.auto_expand = enabled;
    stores.compute.set_table(mirror, table.clone());
    persist_table_to_yrs(stores, &table);
    Ok(MutationResult::empty())
}

/// Set table automatic calculated-column policy.
pub(in crate::storage::engine) fn set_table_auto_calculated_columns(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    enabled: bool,
) -> Result<MutationResult, ComputeError> {
    let mut table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    if table.auto_calculated_columns == enabled {
        return Ok(MutationResult::empty());
    }

    table.auto_calculated_columns = enabled;
    stores.compute.set_table(mirror, table.clone());
    persist_table_to_yrs(stores, &table);
    Ok(MutationResult::empty())
}

/// Add a data row to a table at the given relative position.
pub(in crate::storage::engine) fn add_table_data_row(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    relative_row: Option<u32>,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let result = compute_table::operations::add_data_row(&table, relative_row);
    stores.compute.set_table(mirror, result.table.clone());
    persist_table_to_yrs(stores, &result.table);

    // Return both the insert row and whether the caller needs to expand
    // the table range post-structural-change (see add_data_row docs).
    let data = serde_json::json!({
        "insertRow": result.insert_row,
        "needsRangeExpand": result.needs_range_expand,
    });
    Ok(MutationResult::empty().with_data(&data)?)
}

/// Remove a data row from a table by relative index.
pub(in crate::storage::engine) fn remove_table_data_row(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    relative_row: u32,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let result =
        compute_table::operations::remove_data_row(&table, relative_row).ok_or_else(|| {
            ComputeError::Eval {
                message: format!(
                    "Cannot remove row {} from table {}: out of bounds or would leave 0 data rows",
                    relative_row, table_name
                ),
            }
        })?;
    stores.compute.set_table(mirror, result.table.clone());
    persist_table_to_yrs(stores, &result.table);
    Ok(MutationResult::empty().with_data(&result.removed_row)?)
}

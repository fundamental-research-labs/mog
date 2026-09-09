use super::*;

pub(super) fn get_column_schema(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    col_index: u32,
) -> Option<ColumnSchema> {
    services::formatting::get_column_schema(&engine.stores, sheet_id, col_index)
}

pub(super) fn set_column_schema(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
) -> Result<MutationResult, ComputeError> {
    let result =
        services::formatting::set_column_schema(&mut engine.stores, sheet_id, col_index, schema)?;
    Ok(result)
}

pub(super) fn clear_column_schema(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    col_index: u32,
) -> Result<MutationResult, ComputeError> {
    let result =
        services::formatting::clear_column_schema(&mut engine.stores, sheet_id, col_index)?;
    Ok(result)
}

pub(super) fn get_all_column_schemas(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<(u32, ColumnSchema)> {
    services::formatting::get_all_column_schemas(&engine.stores, sheet_id)
}

pub(super) fn get_range_schema(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    services::formatting::get_range_schema(&engine.stores, sheet_id, schema_id)
}

pub(super) fn get_range_schemas_for_sheet(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    services::formatting::get_range_schemas_for_sheet(&engine.stores, sheet_id)
}

pub(super) fn set_range_schema(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::set_range_schema(&mut engine.stores, sheet_id, schema)?;
    Ok(result)
}

pub(super) fn update_range_schema(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::update_range_schema(
        &mut engine.stores,
        sheet_id,
        schema_id,
        updates,
    )?;
    Ok(result)
}

pub(super) fn delete_range_schema(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result =
        services::formatting::delete_range_schema(&mut engine.stores, sheet_id, schema_id)?;
    Ok(result)
}

pub(super) fn validate_cell_value(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
) -> CellValidationResult {
    services::formatting::validate_cell_value(
        &engine.stores,
        &engine.cell_store,
        sheet_id,
        row,
        col,
        value,
    )
}

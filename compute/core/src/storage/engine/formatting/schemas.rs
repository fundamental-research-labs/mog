use super::*;

pub(super) fn get_column_schema(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    col_index: u32,
) -> Option<ColumnSchema> {
    services::formatting::get_column_schema(&engine.stores, sheet_id, col_index)
}

pub(super) fn set_column_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result =
        services::formatting::set_column_schema(&mut engine.stores, sheet_id, col_index, schema)?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(super) fn clear_column_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col_index: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result =
        services::formatting::clear_column_schema(&mut engine.stores, sheet_id, col_index)?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(super) fn get_all_column_schemas(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<(u32, ColumnSchema)> {
    services::formatting::get_all_column_schemas(&engine.stores, sheet_id)
}

pub(super) fn get_range_schema(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    services::formatting::get_range_schema(&engine.stores, sheet_id, schema_id)
}

pub(super) fn get_range_schemas_for_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    services::formatting::get_range_schemas_for_sheet(&engine.stores, sheet_id)
}

pub(super) fn set_range_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::set_range_schema(&mut engine.stores, sheet_id, schema)?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(super) fn update_range_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::update_range_schema(
        &mut engine.stores,
        sheet_id,
        schema_id,
        updates,
    )?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(super) fn delete_range_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result =
        services::formatting::delete_range_schema(&mut engine.stores, sheet_id, schema_id)?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(super) fn validate_cell_value(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
) -> CellValidationResult {
    services::formatting::validate_cell_value(
        &engine.stores,
        &engine.mirror,
        sheet_id,
        row,
        col,
        value,
    )
}

use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::schemas;
use crate::storage::sheet::schemas::{CellValidationResult, ColumnSchema, RangeSchema};
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_column_schema(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col_index: u32,
) -> Option<ColumnSchema> {
    schemas::get_column_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col_index,
        stores.grid_indexes.get(sheet_id),
    )
}

pub(in crate::storage::engine) fn set_column_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
) -> Result<MutationResult, ComputeError> {
    schemas::set_column_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col_index,
        schema,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn clear_column_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col_index: u32,
) -> Result<MutationResult, ComputeError> {
    schemas::clear_column_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col_index,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_column_schemas(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<(u32, ColumnSchema)> {
    schemas::get_all_column_schemas(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        stores.grid_indexes.get(sheet_id),
    )
}

pub(in crate::storage::engine) fn get_range_schema(
    stores: &EngineStores,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    schemas::get_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema_id,
    )
}

pub(in crate::storage::engine) fn get_range_schemas_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    schemas::get_range_schemas_for_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_range_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<MutationResult, ComputeError> {
    schemas::set_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema,
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn update_range_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
) -> Result<MutationResult, ComputeError> {
    schemas::update_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema_id,
        updates,
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn delete_range_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Result<MutationResult, ComputeError> {
    schemas::delete_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema_id,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn validate_cell_value(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
) -> CellValidationResult {
    schemas::validate_cell_value(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        value,
        stores.grid_indexes.get(sheet_id),
        mirror,
    )
}

pub(in crate::storage::engine) fn validate_cell_against_data_validations(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &value_types::CellValue,
) -> schemas::DataValidationOutcome {
    schemas::validate_cell_value_against_data_validations(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        value,
        stores.grid_indexes.get(sheet_id),
        mirror,
    )
}

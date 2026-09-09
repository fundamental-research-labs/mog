use super::ColumnSchema;
use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::ComputeError;

pub fn get_column_schema(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col_index: u32,
    grid: Option<&GridIndex>,
) -> Option<ColumnSchema> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .column_schemas
        .get(&grid?.col_id(col_index)?)
        .cloned()
}
pub fn set_column_schema(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col = grid
        .and_then(|grid| grid.col_id(col_index))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    crate::storage::engine::history::metadata::capture_column_schema(storage, *sheet_id, col);
    let metadata =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    metadata.column_schemas.insert(col, schema.clone());
    Ok(())
}
pub fn clear_column_schema(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col_index: u32,
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    if let Some(col) = grid.and_then(|grid| grid.col_id(col_index)) {
        crate::storage::engine::history::metadata::capture_column_schema(storage, *sheet_id, col);
    }
    if let Some(col) = grid.and_then(|grid| grid.col_id(col_index))
        && let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id)
    {
        metadata.column_schemas.remove(&col);
    }
    Ok(())
}
pub fn get_all_column_schemas(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<(u32, ColumnSchema)> {
    let (Some(metadata), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return Vec::new();
    };
    let mut schemas: Vec<_> = metadata
        .column_schemas
        .iter()
        .filter_map(|(id, schema)| {
            grid.col_index(id)
                .map(|position| (position, schema.clone()))
        })
        .collect();
    schemas.sort_by_key(|(position, _)| *position);
    schemas
}

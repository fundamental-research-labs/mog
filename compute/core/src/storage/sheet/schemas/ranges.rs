use super::{RangeSchema, range_view};
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::ComputeError;

pub fn get_range_schema(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    let entry = storage
        .sheet_metadata
        .get(sheet_id)?
        .validations
        .rules
        .iter()
        .find(|entry| entry.id == schema_id)?;
    range_view::spec_to_range_schema(&entry.spec, entry.id.clone())
}
pub fn get_range_schemas_for_sheet(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|metadata| {
            metadata
                .validations
                .rules
                .iter()
                .filter_map(|entry| range_view::spec_to_range_schema(&entry.spec, entry.id.clone()))
                .collect()
        })
        .unwrap_or_default()
}
pub fn set_range_schema(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<(), ComputeError> {
    update_range_schema(storage, sheet_id, &schema.id, schema)
}
pub fn update_range_schema(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    schema_id: &str,
    schema: &RangeSchema,
) -> Result<(), ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet_id, validations.rules, schema_id, entry => entry.id);
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        validations.declared_count
    );
    let Some(spec) = schema.to_validation_spec() else {
        return Ok(());
    };
    let metadata =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    metadata.validations.declared_count = None;
    metadata.validations.upsert(schema_id.to_owned(), spec);
    Ok(())
}
pub fn delete_range_schema(storage: &mut WorkbookStorage, sheet_id: &SheetId, schema_id: &str) {
    crate::storage::engine::history::metadata::capture_sheet_vector_entry!(storage, *sheet_id, validations.rules, schema_id, entry => entry.id);
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        validations.declared_count
    );
    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) {
        metadata.validations.declared_count = None;
        metadata
            .validations
            .rules
            .retain(|entry| entry.id != schema_id);
    }
}

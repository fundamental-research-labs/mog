use super::*;

pub(super) fn set_schema_map(
    engine: &mut YrsComputeEngine,
    entries: Vec<crate::bridge_types::SchemaMapEntryWire>,
    version: f64,
) {
    services::formatting::set_schema_map(&mut engine.stores, entries, version);
}

pub(super) fn update_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: String,
    column: u32,
    schema: crate::schema::types::ColumnSchema,
    version: f64,
) -> bool {
    services::formatting::update_schema(&mut engine.stores, &sheet_id, column, schema, version)
}

pub(super) fn remove_schema(
    engine: &mut YrsComputeEngine,
    sheet_id: String,
    column: u32,
    version: f64,
) -> bool {
    services::formatting::remove_schema(&mut engine.stores, &sheet_id, column, version)
}

pub(super) fn clear_schemas(
    engine: &mut YrsComputeEngine,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::clear_schemas(&mut engine.stores)?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}

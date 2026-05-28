use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_schema_map(
    stores: &mut EngineStores,
    entries: Vec<crate::bridge_types::SchemaMapEntryWire>,
    version: f64,
) {
    let version = version as u64;
    let mut schemas = std::collections::HashMap::new();
    for entry in entries {
        let Ok(sheet_id) = SheetId::from_uuid_str(&entry.sheet_id) else {
            continue;
        };
        let key = crate::schema::schema_map::SchemaKey {
            sheet_id,
            column: entry.column,
        };
        schemas.insert(key, entry.schema);
    }
    stores.compute.load_schema_map(schemas, version);
}

pub(in crate::storage::engine) fn update_schema(
    stores: &mut EngineStores,
    sheet_id: &str,
    column: u32,
    schema: crate::schema::types::ColumnSchema,
    version: f64,
) -> bool {
    let version = version as u64;
    let Ok(sid) = SheetId::from_uuid_str(sheet_id) else {
        return false;
    };
    let key = crate::schema::schema_map::SchemaKey {
        sheet_id: sid,
        column,
    };
    stores.compute.update_schema(key, schema, version)
}

pub(in crate::storage::engine) fn remove_schema(
    stores: &mut EngineStores,
    sheet_id: &str,
    column: u32,
    version: f64,
) -> bool {
    let version = version as u64;
    let Ok(sid) = SheetId::from_uuid_str(sheet_id) else {
        return false;
    };
    let key = crate::schema::schema_map::SchemaKey {
        sheet_id: sid,
        column,
    };
    stores.compute.remove_schema(&key, version)
}

pub(in crate::storage::engine) fn clear_schemas(
    stores: &mut EngineStores,
) -> Result<MutationResult, ComputeError> {
    stores.compute.clear_schemas();
    Ok(MutationResult::empty())
}

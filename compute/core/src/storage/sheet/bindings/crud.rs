//! Native data-binding mutations.
use super::ids;
use crate::engine_types::bindings::{
    ColumnMapping, CreateBindingOptions, SheetDataBinding, UpdateBindingFields,
};
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::ComputeError;
pub(super) fn parse_sheet_id(text: &str) -> Option<SheetId> {
    SheetId::from_uuid_str(text).ok()
}
pub fn create_binding(
    storage: &mut WorkbookStorage,
    sheet_id: &str,
    connection_id: &str,
    column_mappings: Vec<ColumnMapping>,
    options: CreateBindingOptions,
    allocator: &cell_types::IdAllocator,
) -> Result<SheetDataBinding, ComputeError> {
    let new_id = ids::generate_binding_id(allocator);
    if let Some(sid) = parse_sheet_id(sheet_id) {
        crate::storage::engine::history::metadata::capture_sheet_entry!(
            storage,
            sid,
            data_bindings,
            new_id
        );
    }
    let sheet = parse_sheet_id(sheet_id)
        .and_then(|id| storage.sheet_metadata.get_mut(&id))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.into(),
        })?;
    let binding = SheetDataBinding {
        id: new_id,
        sheet_id: sheet_id.into(),
        connection_id: connection_id.into(),
        column_mappings,
        auto_generate_rows: options.auto_generate_rows.unwrap_or(true),
        header_row: options.header_row.unwrap_or(0),
        data_start_row: options.data_start_row.unwrap_or(1),
        preserve_header_formatting: options.preserve_header_formatting.unwrap_or(true),
        last_refresh: None,
        last_row_count: None,
    };
    sheet
        .data_bindings
        .insert(binding.id.clone(), binding.clone());
    Ok(binding)
}
pub fn get_all_bindings(storage: &WorkbookStorage, sheet_id: &str) -> Vec<SheetDataBinding> {
    parse_sheet_id(sheet_id)
        .and_then(|id| storage.sheet_metadata.get(&id))
        .map(|sheet| sheet.data_bindings.values().cloned().collect())
        .unwrap_or_default()
}
pub fn get_binding(
    storage: &WorkbookStorage,
    sheet_id: &str,
    binding_id: &str,
) -> Option<SheetDataBinding> {
    storage
        .sheet_metadata
        .get(&parse_sheet_id(sheet_id)?)?
        .data_bindings
        .get(binding_id)
        .cloned()
}
pub fn update_binding(
    storage: &mut WorkbookStorage,
    sheet_id: &str,
    binding_id: &str,
    updates: UpdateBindingFields,
) -> Option<SheetDataBinding> {
    if let Some(sid) = parse_sheet_id(sheet_id) {
        crate::storage::engine::history::metadata::capture_sheet_entry!(
            storage,
            sid,
            data_bindings,
            binding_id
        );
    }

    let binding = storage
        .sheet_metadata
        .get_mut(&parse_sheet_id(sheet_id)?)?
        .data_bindings
        .get_mut(binding_id)?;
    // Apply updates
    if let Some(conn) = updates.connection_id {
        binding.connection_id = conn;
    }
    if let Some(mappings) = updates.column_mappings {
        binding.column_mappings = mappings;
    }
    if let Some(v) = updates.auto_generate_rows {
        binding.auto_generate_rows = v;
    }
    if let Some(v) = updates.header_row {
        binding.header_row = v;
    }
    if let Some(v) = updates.data_start_row {
        binding.data_start_row = v;
    }
    if let Some(v) = updates.preserve_header_formatting {
        binding.preserve_header_formatting = v;
    }

    Some(binding.clone())
}
pub fn update_refresh_metadata(
    storage: &mut WorkbookStorage,
    sheet_id: &str,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) {
    if let Some(sid) = parse_sheet_id(sheet_id) {
        crate::storage::engine::history::metadata::capture_sheet_entry!(
            storage,
            sid,
            data_bindings,
            binding_id
        );
    }

    let Some(binding) = parse_sheet_id(sheet_id)
        .and_then(|id| storage.sheet_metadata.get_mut(&id))
        .and_then(|sheet| sheet.data_bindings.get_mut(binding_id))
    else {
        return;
    };
    binding.last_refresh = Some(last_refresh);
    binding.last_row_count = Some(last_row_count);
}
pub fn remove_binding(storage: &mut WorkbookStorage, sheet_id: &str, binding_id: &str) -> bool {
    if let Some(sid) = parse_sheet_id(sheet_id) {
        crate::storage::engine::history::metadata::capture_sheet_entry!(
            storage,
            sid,
            data_bindings,
            binding_id
        );
    }

    parse_sheet_id(sheet_id)
        .and_then(|id| storage.sheet_metadata.get_mut(&id))
        .is_some_and(|sheet| sheet.data_bindings.remove(binding_id).is_some())
}

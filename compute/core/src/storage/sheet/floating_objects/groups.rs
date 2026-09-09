use super::ids::generate_group_id;
use super::state::{merge_json_fields, required_state_mut, state, state_mut};
use crate::engine_types::floating_objects::SerializedFloatingObjectGroup;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::ComputeError;

fn decode_group(
    sheet: &SheetId,
    id: &str,
    json: &serde_json::Value,
) -> Result<SerializedFloatingObjectGroup, ComputeError> {
    let mut json = json.clone();
    let object = json
        .as_object_mut()
        .ok_or_else(|| ComputeError::InvalidInput {
            message: "floating object group must be an object".into(),
        })?;
    object.insert("id".into(), id.into());
    object.insert("sheetId".into(), sheet.to_uuid_string().into());
    serde_json::from_value(json).map_err(|error| ComputeError::InvalidInput {
        message: error.to_string(),
    })
}
pub fn set_floating_object_group(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    json: &serde_json::Value,
) -> Result<(), ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.groups,
        id
    );

    let group = decode_group(sheet, id, json)?;
    required_state_mut(storage, sheet)?
        .groups
        .insert(id.into(), group);
    Ok(())
}
pub fn get_floating_object_group(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    id: &str,
) -> Option<serde_json::Value> {
    serde_json::to_value(state(storage, sheet)?.groups.get(id)?).ok()
}
pub fn get_all_floating_object_groups(
    storage: &WorkbookStorage,
    sheet: &SheetId,
) -> Vec<(String, serde_json::Value)> {
    state(storage, sheet)
        .map(|state| {
            state
                .groups
                .iter()
                .filter_map(|(id, group)| Some((id.clone(), serde_json::to_value(group).ok()?)))
                .collect()
        })
        .unwrap_or_default()
}
pub fn delete_floating_object_group(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.groups,
        id
    );
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet) {
            for (id, value) in &meta.floating_objects.objects {
                if value.common.group_id.as_deref() == Some(id) {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet,
                        floating_objects.objects,
                        id
                    );
                }
            }
        }
    }

    let Some(state) = state_mut(storage, sheet) else {
        return false;
    };
    if state.groups.remove(id).is_none() {
        return false;
    }
    for object in state.objects.values_mut() {
        if object.common.group_id.as_deref() == Some(id) {
            object.common.group_id = None;
        }
    }
    true
}
pub fn create_floating_object_group(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    config: &serde_json::Value,
    allocator: &cell_types::IdAllocator,
) -> Result<String, ComputeError> {
    let id = generate_group_id(allocator);
    set_floating_object_group(storage, sheet, &id, config)?;
    Ok(id)
}
pub fn update_floating_object_group(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    updates: &serde_json::Value,
) -> bool {
    let Some(mut group) = get_floating_object_group(storage, sheet, id) else {
        return false;
    };
    if !merge_json_fields(&mut group, updates) {
        return false;
    }
    set_floating_object_group(storage, sheet, id, &group).is_ok()
}
pub fn get_floating_object_group_typed(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    id: &str,
) -> Option<SerializedFloatingObjectGroup> {
    state(storage, sheet)?.groups.get(id).cloned()
}
pub fn get_all_floating_object_groups_typed(
    storage: &WorkbookStorage,
    sheet: &SheetId,
) -> Vec<SerializedFloatingObjectGroup> {
    state(storage, sheet)
        .map(|state| state.groups.values().cloned().collect())
        .unwrap_or_default()
}

use super::ids::{generate_object_id, now_millis};
use super::state::{
    merge_json_fields, normalize_object_json, object_from_json, required_state_mut, state,
    state_mut,
};
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use value_types::ComputeError;

pub fn set_floating_object(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    object_id: &str,
    json: &serde_json::Value,
) -> Result<(), ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        floating_objects.objects,
        object_id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        floating_objects.order
    );

    let object = object_from_json(sheet_id, object_id, json)?;
    required_state_mut(storage, sheet_id)?.insert(object);
    Ok(())
}
pub fn get_floating_object(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    object_id: &str,
) -> Option<serde_json::Value> {
    serde_json::to_value(state(storage, sheet_id)?.objects.get(object_id)?.as_ref()).ok()
}
pub fn get_all_floating_objects(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<(String, serde_json::Value)> {
    state(storage, sheet_id)
        .map(|state| {
            state
                .objects
                .iter()
                .filter_map(|(id, object)| {
                    Some((id.clone(), serde_json::to_value(object.as_ref()).ok()?))
                })
                .collect()
        })
        .unwrap_or_default()
}
pub fn delete_floating_object(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    object_id: &str,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        floating_objects.objects,
        object_id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        floating_objects.order
    );
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, value) in &meta.floating_objects.groups {
                if value.children.iter().any(|child| child == object_id) {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet_id,
                        floating_objects.groups,
                        id
                    );
                }
            }
        }
    }

    state_mut(storage, sheet_id).is_some_and(|state| state.remove(object_id))
}
pub fn create_floating_object(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    config: &serde_json::Value,
    id_alloc: &cell_types::IdAllocator,
) -> Result<String, ComputeError> {
    let id = generate_object_id(id_alloc);
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        floating_objects.objects,
        id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        floating_objects.order
    );

    let mut object = object_from_json(sheet_id, &id, config)?;
    let state = required_state_mut(storage, sheet_id)?;
    object.common.created_at = now_millis();
    object.common.updated_at = object.common.created_at;
    object.common.z_index = state
        .objects
        .values()
        .map(|object| object.common.z_index)
        .max()
        .unwrap_or(-1)
        .saturating_add(1);
    state.insert(object);
    Ok(id)
}
pub fn update_floating_object(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    object_id: &str,
    updates: &serde_json::Value,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        floating_objects.objects,
        object_id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        floating_objects.order
    );

    let Some(mut json) = get_floating_object(storage, sheet_id, object_id) else {
        return false;
    };
    let mut updates = updates.clone();
    normalize_object_json(&mut updates);
    if !merge_json_fields(&mut json, &updates) {
        return false;
    }
    let Ok(mut object) = object_from_json(sheet_id, object_id, &json) else {
        return false;
    };
    object.common.updated_at = now_millis();
    let Some(state) = state_mut(storage, sheet_id) else {
        return false;
    };
    state.insert(object);
    true
}
pub fn get_floating_object_typed(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    object_id: &str,
) -> Option<FloatingObject> {
    state(storage, sheet_id)?
        .objects
        .get(object_id)
        .map(|object| object.as_ref().clone())
}
pub fn get_all_floating_objects_typed(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    state(storage, sheet_id)
        .map(|state| {
            state
                .objects
                .values()
                .map(|object| object.as_ref().clone())
                .collect()
        })
        .unwrap_or_default()
}

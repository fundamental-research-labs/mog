use crate::engine_types::SerializedFloatingObjectGroup;
use crate::snapshot::{FloatingObjectChange, FloatingObjectChangeKind, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects;
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
    json: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::set_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
        &json,
    )?;
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.to_string(),
            kind: FloatingObjectChangeKind::Updated {
                changed_fields: vec![],
            },
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_object_group(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<Option<serde_json::Value>, ComputeError> {
    Ok(floating_objects::get_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    ))
}

pub(in crate::storage::engine) fn get_floating_object_groups_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
    Ok(floating_objects::get_all_floating_object_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    ))
}

pub(in crate::storage::engine) fn delete_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::delete_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    );
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.to_string(),
            kind: FloatingObjectChangeKind::Removed,
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result)
}

// -------------------------------------------------------------------
// Typed Floating Objects (new API)

pub(in crate::storage::engine) fn create_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let group_id = floating_objects::create_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.clone(),
            kind: FloatingObjectChangeKind::Created,
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result.with_data(&group_id)?)
}

pub(in crate::storage::engine) fn update_floating_object_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::update_floating_object_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
        updates,
    );
    let mut result = MutationResult::empty();
    result
        .floating_object_group_changes
        .push(FloatingObjectChange {
            sheet_id: sheet_id.to_uuid_string(),
            object_id: group_id.to_string(),
            kind: FloatingObjectChangeKind::Updated {
                changed_fields: vec![],
            },
            object_type: None,
            data: None,
            bounds: None,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_object_group_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<SerializedFloatingObjectGroup> {
    floating_objects::get_floating_object_group_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
}

pub(in crate::storage::engine) fn get_all_floating_object_groups_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<SerializedFloatingObjectGroup> {
    floating_objects::get_all_floating_object_groups_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

// -------------------------------------------------------------------
// Unified Z-Order

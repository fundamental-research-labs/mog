use crate::engine_types::ZOrderEntry;
use crate::snapshot::{FloatingObjectChange, FloatingObjectChangeKind, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use value_types::ComputeError;

pub(in crate::storage::engine) fn bring_floating_object_to_front(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_to_front(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_floating_object_to_back(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_to_back(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn bring_floating_object_forward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_forward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_floating_object_backward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_backward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".into()],
        },
        object_type: None,
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_objects_in_z_order(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_floating_objects_in_z_order(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_floating_object_max_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_max_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_floating_object_min_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_min_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

// -------------------------------------------------------------------
// Typed Floating Object Groups (new API)

pub(in crate::storage::engine) fn get_max_z_index_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_max_z_index_all(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_min_z_index_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_min_z_index_all(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_all_in_z_order(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ZOrderEntry> {
    floating_objects::get_all_in_z_order(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

// -------------------------------------------------------------------
// Hyperlinks

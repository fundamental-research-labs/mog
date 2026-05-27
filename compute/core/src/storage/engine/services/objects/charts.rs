use crate::snapshot::{FloatingObjectChange, FloatingObjectChangeKind, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects;
use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;
use cell_types::SheetId;
use domain_types::domain::floating_object::{
    FloatingObject, FloatingObjectData, FloatingObjectKind,
};
use value_types::ComputeError;

pub(in crate::storage::engine) fn create_chart(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let object_json = floating_objects::create_chart_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        stores.grid_indexes.get_mut(sheet_id),
        &stores.id_alloc,
    )?;
    let object_id = object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        stores.grid_indexes.get(sheet_id),
        stores.layout_indexes.get(sheet_id),
        &object_json,
    );
    let data: Option<FloatingObject> = serde_json::from_value(object_json).ok();
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.clone(),
        kind: FloatingObjectChangeKind::Created,
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds,
    });
    Ok(result.with_data(&object_id)?)
}

pub(in crate::storage::engine) fn update_chart(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
        updates,
    );
    let data: Option<FloatingObject> = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let obj_json = floating_objects::get_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let bounds = obj_json.and_then(|json| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            &json,
        )
    });
    let changed = updates
        .as_object()
        .map(|m| m.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: changed,
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn delete_chart(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    let pre_delete = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    floating_objects::delete_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Removed,
        object_type: Some(FloatingObjectKind::Chart),
        data: pre_delete,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_chart(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Option<FloatingObject> {
    let obj = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    )?;
    if obj.object_type() != "chart" {
        return None;
    }
    Some(obj)
}

pub(in crate::storage::engine) fn get_all_charts(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .filter(|obj| obj.object_type() == "chart")
    .collect()
}

pub(in crate::storage::engine) fn bring_chart_to_front(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_to_front(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_chart_to_back(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_to_back(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn bring_chart_forward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::bring_floating_object_forward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn send_chart_backward(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    floating_objects::send_floating_object_backward(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["zIndex".to_string()],
        },
        object_type: Some(FloatingObjectKind::Chart),
        data,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_charts_in_z_order(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    let mut charts: Vec<FloatingObject> = floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .filter(|obj| obj.object_type() == "chart")
    .collect();
    charts.sort_by_key(|obj| obj.common.z_index);
    charts
}

pub(in crate::storage::engine) fn link_chart_to_table(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
    table_id: &str,
) -> Result<MutationResult, ComputeError> {
    let updates = serde_json::json!({ "sourceTableId": table_id });
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
        &updates,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn unlink_chart_from_table(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    let updates = serde_json::json!({ "sourceTableId": null });
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
        &updates,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn is_chart_linked_to_table(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> bool {
    floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        chart_id,
    )
    .and_then(|obj| {
        if let FloatingObjectData::Chart(ref c) = obj.data {
            c.source_table_id.as_ref().map(|_| true)
        } else {
            None
        }
    })
    .unwrap_or(false)
}

pub(in crate::storage::engine) fn get_charts_linked_to_table(
    stores: &EngineStores,
    sheet_id: &SheetId,
    table_id: &str,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .filter(|obj| {
        if let FloatingObjectData::Chart(ref c) = obj.data {
            c.source_table_id.as_deref() == Some(table_id)
        } else {
            false
        }
    })
    .collect()
}

pub(in crate::storage::engine) fn get_max_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_max_z_index(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_min_z_index(
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
// Floating Objects

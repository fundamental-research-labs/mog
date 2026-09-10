use crate::snapshot::{FloatingObjectChange, FloatingObjectChangeKind, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects;
use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;
use cell_types::SheetId;
use domain_types::domain::floating_object::{
    FloatingObject, FloatingObjectData, FloatingObjectKind,
};
use value_types::ComputeError;

fn chart_not_found(sheet_id: &SheetId, chart_id: &str) -> ComputeError {
    ComputeError::ChartNotFound {
        sheet_id: sheet_id.to_uuid_string(),
        chart_id: chart_id.to_string(),
    }
}

fn require_chart(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<FloatingObject, ComputeError> {
    get_chart(stores, sheet_id, chart_id).ok_or_else(|| chart_not_found(sheet_id, chart_id))
}

/// A literal chart-title edit supersedes an imported formula unless the caller
/// supplies an explicit `titleFormula` update as well. Generic floating-object
/// updates merge fields, so leaving the imported formula in place would make
/// XLSX reconstruction prefer that formula over the edited title text.
fn normalize_chart_title_update(updates: &serde_json::Value) -> serde_json::Value {
    let Some(updates_object) = updates.as_object() else {
        return updates.clone();
    };
    if !updates_object.contains_key("title") || updates_object.contains_key("titleFormula") {
        return updates.clone();
    }

    let mut normalized = updates_object.clone();
    normalized.insert("titleFormula".to_string(), serde_json::Value::Null);
    serde_json::Value::Object(normalized)
}

pub(in crate::storage::engine) fn create_chart(
    stores: &mut EngineStores,
    cell_store: &mut crate::cells::CellStore,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let object_json = floating_objects::create_chart_object(
        &mut stores.storage,
        sheet_id,
        config,
        Some(&mut *cell_store),
        &stores.id_alloc,
    )?;
    let object_id = object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        cell_store.get_sheet(sheet_id),
        stores.pixel_layout(sheet_id).as_deref(),
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
    cell_store: &crate::cells::CellStore,
    sheet_id: &SheetId,
    chart_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    require_chart(stores, sheet_id, chart_id)?;
    let normalized_updates = normalize_chart_title_update(updates);
    floating_objects::update_floating_object(
        &mut stores.storage,
        sheet_id,
        chart_id,
        &normalized_updates,
    );
    let data: Option<FloatingObject> =
        floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id);
    let obj_json = floating_objects::get_floating_object(&stores.storage, sheet_id, chart_id);
    let bounds = obj_json.and_then(|json| {
        compute_object_pixel_bounds(
            cell_store.get_sheet(sheet_id),
            stores.pixel_layout(sheet_id).as_deref(),
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
    let pre_delete = require_chart(stores, sheet_id, chart_id)?;
    let deleted = floating_objects::delete_floating_object(&mut stores.storage, sheet_id, chart_id);
    if !deleted {
        return Err(chart_not_found(sheet_id, chart_id));
    }
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: chart_id.to_string(),
        kind: FloatingObjectChangeKind::Removed,
        object_type: Some(FloatingObjectKind::Chart),
        data: Some(pre_delete),
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_chart(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Option<FloatingObject> {
    let obj = floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id)?;
    if obj.object_type() != "chart" {
        return None;
    }
    Some(obj)
}

pub(in crate::storage::engine) fn get_all_charts(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(&stores.storage, sheet_id)
        .into_iter()
        .filter(|obj| obj.object_type() == "chart")
        .collect()
}

pub(in crate::storage::engine) fn bring_chart_to_front(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    require_chart(stores, sheet_id, chart_id)?;
    floating_objects::bring_floating_object_to_front(&mut stores.storage, sheet_id, chart_id);
    let data = floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id);
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
    require_chart(stores, sheet_id, chart_id)?;
    floating_objects::send_floating_object_to_back(&mut stores.storage, sheet_id, chart_id);
    let data = floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id);
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
    require_chart(stores, sheet_id, chart_id)?;
    floating_objects::bring_floating_object_forward(&mut stores.storage, sheet_id, chart_id);
    let data = floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id);
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
    require_chart(stores, sheet_id, chart_id)?;
    floating_objects::send_floating_object_backward(&mut stores.storage, sheet_id, chart_id);
    let data = floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id);
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
    let mut charts = floating_objects::get_chart_objects(&stores.storage, sheet_id);
    charts.sort_by_key(|obj| obj.common.z_index);
    charts
}

pub(in crate::storage::engine) fn link_chart_to_table(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
    table_id: &str,
) -> Result<MutationResult, ComputeError> {
    require_chart(stores, sheet_id, chart_id)?;
    let updates = serde_json::json!({ "sourceTableId": table_id });
    floating_objects::update_floating_object(&mut stores.storage, sheet_id, chart_id, &updates);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn unlink_chart_from_table(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> Result<MutationResult, ComputeError> {
    require_chart(stores, sheet_id, chart_id)?;
    let updates = serde_json::json!({ "sourceTableId": null });
    floating_objects::update_floating_object(&mut stores.storage, sheet_id, chart_id, &updates);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn is_chart_linked_to_table(
    stores: &EngineStores,
    sheet_id: &SheetId,
    chart_id: &str,
) -> bool {
    floating_objects::get_floating_object_typed(&stores.storage, sheet_id, chart_id)
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
    floating_objects::get_charts_linked_to_table(&stores.storage, sheet_id, table_id)
}

pub(in crate::storage::engine) fn get_max_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_max_z_index(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn get_min_z_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> i32 {
    floating_objects::get_floating_object_min_z_index(&stores.storage, sheet_id)
}

// -------------------------------------------------------------------
// Floating Objects

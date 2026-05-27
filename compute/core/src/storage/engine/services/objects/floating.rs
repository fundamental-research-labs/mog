use crate::engine_types::floating_objects::{
    CreateShapeConfig, FlipAxis, MoveTarget, ResizeConfig, ShapeStyleUpdate,
};
use crate::snapshot::{
    FloatingObjectBounds, FloatingObjectChange, FloatingObjectChangeKind, MutationResult,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::floating_objects;
use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    json: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::set_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &json,
    )?;
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec![],
        },
        object_type: None,
        data: None,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_floating_object(
    stores: &EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<Option<serde_json::Value>, ComputeError> {
    Ok(floating_objects::get_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    ))
}

pub(in crate::storage::engine) fn get_floating_objects_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
    Ok(floating_objects::get_all_floating_objects(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    ))
}

pub(in crate::storage::engine) fn delete_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Result<MutationResult, ComputeError> {
    let pre_delete = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    floating_objects::delete_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    );
    let object_type = pre_delete.as_ref().map(|d| d.kind());
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Removed,
        object_type,
        data: pre_delete,
        bounds: None,
    });
    Ok(result)
}

// -------------------------------------------------------------------
// Floating Object Groups

pub(in crate::storage::engine) fn create_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let object_id = floating_objects::create_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let data = floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &object_id,
    );
    // Bounds must travel with the create patch — the renderer skips objects
    // whose `FloatingObjectPatch.bounds` is None (parity with create_shape /
    // move/resize paths). Without this the typed-API picture/textbox flows
    // (paste-image, ws.pictures.add, ws.textboxes.add, etc.) would render
    // nothing on first paint.
    let bounds = data.as_ref().and_then(|obj| {
        serde_json::to_value(obj).ok().and_then(|json| {
            compute_object_pixel_bounds(
                stores.grid_indexes.get(sheet_id),
                stores.layout_indexes.get(sheet_id),
                &json,
            )
        })
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.clone(),
        kind: FloatingObjectChangeKind::Created,
        object_type: None,
        data,
        bounds,
    });
    Ok(result.with_data(&object_id)?)
}

pub(in crate::storage::engine) fn update_floating_object(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    floating_objects::update_floating_object(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        updates,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec![],
        },
        object_type: None,
        data: None,
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn create_shape(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    mut config: CreateShapeConfig,
) -> Result<MutationResult, ComputeError> {
    // Resolve absolute pixel coordinates to cell-anchor + offset when provided.
    if let (Some(px_f), Some(py_f)) = (config.pixel_x, config.pixel_y) {
        let px = px_f.get();
        let py = py_f.get();
        let li = stores.layout_indexes.get(sheet_id);
        let row = li.map_or(
            (py / compute_layout_index::DEFAULT_ROW_HEIGHT.0).max(0.0) as u32,
            |l| l.get_row_at_pixel(domain_types::units::Pixels(py)) as u32,
        );
        let col = li.map_or(
            (px / compute_layout_index::platform_default_col_width().0).max(0.0) as u32,
            |l| l.get_col_at_pixel(domain_types::units::Pixels(px)) as u32,
        );
        let row_pos = li.map_or(
            row as f64 * compute_layout_index::DEFAULT_ROW_HEIGHT.0,
            |l| l.get_row_position(row as usize).0,
        );
        let col_pos = li.map_or(
            col as f64 * compute_layout_index::platform_default_col_width().0,
            |l| l.get_col_position(col as usize).0,
        );
        config.anchor_row = row;
        config.anchor_col = col;
        // px/py and row_pos/col_pos are all finite-derived pixel coordinates;
        // their differences stay finite (no overflow possible at these scales).
        config.x_offset = value_types::FiniteF64::must(px - col_pos);
        config.y_offset = value_types::FiniteF64::must(py - row_pos);
    }
    let object_json = floating_objects::create_shape_from_config(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &config,
        stores.grid_indexes.get_mut(sheet_id),
        &stores.id_alloc,
    )?;
    let object_id = object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        stores.grid_indexes.get(sheet_id),
        stores.layout_indexes.get(sheet_id),
        &object_json,
    );
    let data: Option<FloatingObject> = serde_json::from_value(object_json.clone()).ok();
    let object_type = data.as_ref().map(|d| d.kind());
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id,
        kind: FloatingObjectChangeKind::Created,
        object_type,
        data,
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn move_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    target: MoveTarget,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::move_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &target,
        stores.grid_indexes.get_mut(sheet_id),
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec![
                "anchorRow".into(),
                "anchorCol".into(),
                "xOffset".into(),
                "yOffset".into(),
            ],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn resize_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    config: ResizeConfig,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::resize_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &config,
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["width".into(), "height".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn rotate_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    rotation: f64,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::rotate_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        rotation,
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["rotation".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn update_shape_style(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    style: ShapeStyleUpdate,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::update_shape_style(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &style,
    );
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["fill".into(), "outline".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn flip_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    axis: FlipAxis,
) -> Result<MutationResult, ComputeError> {
    let updated = floating_objects::flip_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        &axis,
    );
    let bounds = updated.as_ref().and_then(|v| {
        compute_object_pixel_bounds(
            stores.grid_indexes.get(sheet_id),
            stores.layout_indexes.get(sheet_id),
            v,
        )
    });
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: object_id.to_string(),
        kind: FloatingObjectChangeKind::Updated {
            changed_fields: vec!["flipH".into(), "flipV".into()],
        },
        object_type: None,
        data: updated.and_then(|v| serde_json::from_value::<FloatingObject>(v).ok()),
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn duplicate_floating_object_typed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
    offset_x: f64,
    offset_y: f64,
) -> Result<MutationResult, ComputeError> {
    let new_object_json = floating_objects::duplicate_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
        offset_x,
        offset_y,
        &stores.id_alloc,
    )
    .ok_or_else(|| ComputeError::Eval {
        message: format!("Failed to duplicate floating object {object_id}"),
    })?;
    let new_object_id = new_object_json["id"].as_str().unwrap_or("").to_string();
    let bounds = compute_object_pixel_bounds(
        stores.grid_indexes.get(sheet_id),
        stores.layout_indexes.get(sheet_id),
        &new_object_json,
    );
    let data: Option<FloatingObject> = serde_json::from_value(new_object_json).ok();
    let object_type = data.as_ref().map(|d| d.kind());
    let mut result = MutationResult::empty();
    result.floating_object_changes.push(FloatingObjectChange {
        sheet_id: sheet_id.to_uuid_string(),
        object_id: new_object_id,
        kind: FloatingObjectChangeKind::Created,
        object_type,
        data,
        bounds,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn find_connectors_for_shape(
    stores: &EngineStores,
    sheet_id: &SheetId,
    shape_id: &str,
) -> Vec<FloatingObject> {
    let pairs = floating_objects::find_connectors_for_shape(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        shape_id,
    );
    pairs
        .into_iter()
        .filter_map(|(_key, json)| serde_json::from_value(json).ok())
        .collect()
}

pub(in crate::storage::engine) fn get_floating_object_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
    object_id: &str,
) -> Option<FloatingObject> {
    floating_objects::get_floating_object_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        object_id,
    )
}

pub(in crate::storage::engine) fn get_all_floating_objects_typed(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    floating_objects::get_all_floating_objects_typed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn compute_all_object_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<(String, FloatingObjectBounds)> {
    let grid = stores.grid_indexes.get(sheet_id);
    let layout = stores.layout_indexes.get(sheet_id);
    let all_objects = floating_objects::get_all_floating_objects(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    let mut results = Vec::with_capacity(all_objects.len());
    for (object_id, obj_json) in &all_objects {
        if let Some(bounds) = compute_object_pixel_bounds(grid, layout, obj_json) {
            results.push((object_id.clone(), bounds));
        }
    }
    results
}

// -------------------------------------------------------------------
// Floating Object Z-Order

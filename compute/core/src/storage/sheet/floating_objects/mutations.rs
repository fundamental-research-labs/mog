use super::ids::{generate_object_id, now_millis};
use super::state::state_mut;
use super::units::px_to_emu;
use crate::cells::CellStore;
use crate::engine_types::floating_objects::{
    FlipAxis, MoveTarget, ResizeAnchor, ResizeConfig, ShapeStyleUpdate,
};
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::domain::floating_object::FloatingObjectData;

pub fn move_floating_object_typed(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    target: &MoveTarget,
    grid: Option<&mut CellStore>,
) -> Option<serde_json::Value> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.objects,
        id
    );
    let object = state_mut(storage, sheet)?.objects.get_mut(id)?;
    match target {
        MoveTarget::Absolute {
            anchor_row,
            anchor_col,
            x_offset,
            y_offset,
        } => {
            object.common.anchor.anchor_row = *anchor_row;
            object.common.anchor.anchor_col = *anchor_col;
            object.common.anchor.anchor_col_offset = px_to_emu(x_offset.get());
            object.common.anchor.anchor_row_offset = px_to_emu(y_offset.get());
            if let Some(grid) = grid {
                object.common.anchor_cell_id = grid
                    .ensure_identity_at(sheet, cell_types::SheetPos::new(*anchor_row, *anchor_col))
                    .map(|id| id_to_hex(id.as_u128()).to_string());
            }
        }
        MoveTarget::Delta { dx, dy } => {
            object.common.anchor.anchor_col_offset += px_to_emu(dx.get());
            object.common.anchor.anchor_row_offset += px_to_emu(dy.get());
        }
    }
    object.common.updated_at = now_millis();
    serde_json::to_value(object.as_ref()).ok()
}
pub fn resize_floating_object_typed(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    config: &ResizeConfig,
) -> Option<serde_json::Value> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.objects,
        id
    );
    let object = state_mut(storage, sheet)?.objects.get_mut(id)?;
    let dw = config.width.get() - object.common.width;
    let dh = config.height.get() - object.common.height;
    if let Some(anchor) = &config.anchor_corner {
        let (dx, dy) = match anchor {
            ResizeAnchor::TopLeft => (0.0, 0.0),
            ResizeAnchor::Top => (-dw / 2.0, 0.0),
            ResizeAnchor::TopRight => (-dw, 0.0),
            ResizeAnchor::Left => (0.0, -dh / 2.0),
            ResizeAnchor::Center => (-dw / 2.0, -dh / 2.0),
            ResizeAnchor::Right => (-dw, -dh / 2.0),
            ResizeAnchor::BottomLeft => (0.0, -dh),
            ResizeAnchor::Bottom => (-dw / 2.0, -dh),
            ResizeAnchor::BottomRight => (-dw, -dh),
        };
        object.common.anchor.anchor_col_offset += px_to_emu(dx);
        object.common.anchor.anchor_row_offset += px_to_emu(dy);
    }
    object.common.width = config.width.get();
    object.common.height = config.height.get();
    object.common.anchor.extent_cx = Some(px_to_emu(config.width.get()));
    object.common.anchor.extent_cy = Some(px_to_emu(config.height.get()));
    object.common.updated_at = now_millis();
    serde_json::to_value(object.as_ref()).ok()
}
pub fn rotate_floating_object_typed(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    rotation: f64,
) -> Option<serde_json::Value> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.objects,
        id
    );
    let object = state_mut(storage, sheet)?.objects.get_mut(id)?;
    object.common.rotation = rotation.rem_euclid(360.0);
    object.common.updated_at = now_millis();
    serde_json::to_value(object.as_ref()).ok()
}
pub fn update_shape_style_typed(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    updates: &ShapeStyleUpdate,
) -> Option<serde_json::Value> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.objects,
        id
    );
    let object = state_mut(storage, sheet)?.objects.get_mut(id)?;
    if let FloatingObjectData::Shape(shape) = &mut object.data {
        if let Some(value) = &updates.fill {
            shape.fill = Some(value.clone());
        }
        if let Some(value) = &updates.outline {
            shape.outline = Some(value.clone());
        }
        if let Some(value) = &updates.text {
            shape.text = Some(value.clone());
        }
        if let Some(value) = &updates.shadow {
            shape.shadow = Some(value.clone());
        }
        if let Some(value) = &updates.adjustments {
            shape.adjustments = Some(
                value
                    .iter()
                    .map(|(key, value)| (key.clone(), value.get()))
                    .collect(),
            );
        }
    }
    if let Some(value) = updates.opacity {
        object.common.opacity = value.get();
    }
    if let Some(value) = updates.locked {
        object.common.locked = value;
    }
    object.common.updated_at = now_millis();
    serde_json::to_value(object.as_ref()).ok()
}
pub fn update_shape_style(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    updates: &ShapeStyleUpdate,
) -> Option<serde_json::Value> {
    update_shape_style_typed(storage, sheet, id, updates)
}
pub fn flip_floating_object_typed(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    axis: &FlipAxis,
) -> Option<serde_json::Value> {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.objects,
        id
    );
    let object = state_mut(storage, sheet)?.objects.get_mut(id)?;
    match axis {
        FlipAxis::Horizontal => object.common.flip_h = !object.common.flip_h,
        FlipAxis::Vertical => object.common.flip_v = !object.common.flip_v,
    }
    object.common.updated_at = now_millis();
    serde_json::to_value(object.as_ref()).ok()
}
pub fn duplicate_floating_object_typed(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    offset_x: f64,
    offset_y: f64,
    allocator: &cell_types::IdAllocator,
) -> Option<serde_json::Value> {
    let new_id = generate_object_id(allocator);
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        floating_objects.objects,
        new_id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet,
        floating_objects.order
    );
    let state = state_mut(storage, sheet)?;
    let mut object = state.objects.get(id)?.as_ref().clone();
    object.common.id = new_id;
    object.common.z_index = state
        .objects
        .values()
        .map(|object| object.common.z_index)
        .max()
        .unwrap_or(-1)
        .saturating_add(1);
    object.common.created_at = now_millis();
    object.common.updated_at = object.common.created_at;
    object.common.anchor.anchor_col_offset += px_to_emu(offset_x);
    object.common.anchor.anchor_row_offset += px_to_emu(offset_y);
    object.common.name = if object.common.name.is_empty() {
        "Shape (Copy)".into()
    } else {
        format!("{} (Copy)", object.common.name)
    };
    let json = serde_json::to_value(&object).ok()?;
    state.insert(object);
    Some(json)
}

use std::sync::Arc;

use crate::engine_types::floating_objects::{FlipAxis, MoveTarget, ResizeConfig, ShapeStyleUpdate};
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_FLOATING_OBJECTS;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::codec::{
    json_value_to_any, read_all_typed, read_object_for_update, read_object_structured,
    update_object_fields, write_object_typed,
};
use super::ids::{generate_object_id, now_millis};
use super::keys::{
    FO_ADJUSTMENTS, FO_FILL, FO_FLIP_H, FO_FLIP_V, FO_LOCKED, FO_OPACITY, FO_OUTLINE, FO_ROTATION,
    FO_SHADOW, FO_TEXT, FO_UPDATED_AT, KEY_ANCHOR_COL_OFFSET_EMU, KEY_ANCHOR_ROW_OFFSET_EMU,
    KEY_EXTENT_CX_EMU, KEY_EXTENT_CY_EMU,
};
use super::sheet_map::get_sheet_submap;
use super::units::px_to_emu;

pub fn move_floating_object_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    target: &MoveTarget,
    grid_index: Option<&mut GridIndex>,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;

    // Read as typed struct — the source of truth.
    let mut obj = read_object_structured(&txn, &map, object_id)?;
    let inner = match map.get(&txn, object_id)? {
        Out::YMap(m) => m,
        _ => return None,
    };

    let now = now_millis();

    match target {
        MoveTarget::Absolute {
            anchor_row,
            anchor_col,
            x_offset,
            y_offset,
        } => {
            obj.common.anchor.anchor_row = *anchor_row;
            obj.common.anchor.anchor_col = *anchor_col;
            obj.common.anchor.anchor_col_offset = px_to_emu(x_offset.get());
            obj.common.anchor.anchor_row_offset = px_to_emu(y_offset.get());
            obj.common.updated_at = now;

            let mut fields: Vec<(&str, Any)> = vec![
                ("anchorRow", Any::Number(*anchor_row as f64)),
                ("anchorCol", Any::Number(*anchor_col as f64)),
                (
                    KEY_ANCHOR_COL_OFFSET_EMU,
                    Any::Number(px_to_emu(x_offset.get()) as f64),
                ),
                (
                    KEY_ANCHOR_ROW_OFFSET_EMU,
                    Any::Number(px_to_emu(y_offset.get()) as f64),
                ),
                ("updatedAt", Any::Number(now as f64)),
            ];

            // Update stable CellId
            if let Some(grid) = grid_index {
                let cell_id = grid.ensure_cell_id(*anchor_row, *anchor_col);
                let cell_id_hex = id_to_hex(cell_id.as_u128());
                obj.common.anchor_cell_id = Some(cell_id_hex.to_string());
                fields.push(("anchorCellId", Any::String(Arc::from(cell_id_hex.as_str()))));
            }

            update_object_fields(&mut txn, &inner, &fields);
        }
        MoveTarget::Delta { dx, dy } => {
            let new_col_offset = obj.common.anchor.anchor_col_offset + px_to_emu(dx.get());
            let new_row_offset = obj.common.anchor.anchor_row_offset + px_to_emu(dy.get());
            obj.common.anchor.anchor_col_offset = new_col_offset as i64;
            obj.common.anchor.anchor_row_offset = new_row_offset as i64;
            obj.common.updated_at = now;

            update_object_fields(
                &mut txn,
                &inner,
                &[
                    (
                        KEY_ANCHOR_COL_OFFSET_EMU,
                        Any::Number(new_col_offset as f64),
                    ),
                    (
                        KEY_ANCHOR_ROW_OFFSET_EMU,
                        Any::Number(new_row_offset as f64),
                    ),
                    ("updatedAt", Any::Number(now as f64)),
                ],
            );
        }
    }

    serde_json::to_value(&obj).ok()
}

/// Resize a floating object. When `anchor_corner` is set, the position is adjusted
/// so that the specified corner stays fixed.
///
/// Reads the object as a typed `FloatingObject`, mutates struct fields directly,
/// writes the correct Y.Map keys, and returns the updated JSON.
pub fn resize_floating_object_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    config: &ResizeConfig,
) -> Option<serde_json::Value> {
    use crate::engine_types::floating_objects::ResizeAnchor;

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;

    // Read as typed struct — the source of truth.
    let mut obj = read_object_structured(&txn, &map, object_id)?;
    let inner = match map.get(&txn, object_id)? {
        Out::YMap(m) => m,
        _ => return None,
    };

    let old_w = obj.common.width;
    let old_h = obj.common.height;
    let dw = config.width.get() - old_w;
    let dh = config.height.get() - old_h;
    let now = now_millis();

    // Adjust position to keep the specified corner fixed.
    let position_changed = if let Some(ref anchor) = config.anchor_corner {
        let cur_col_offset = obj.common.anchor.anchor_col_offset;
        let cur_row_offset = obj.common.anchor.anchor_row_offset;

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

        let new_col_offset = cur_col_offset + px_to_emu(dx);
        let new_row_offset = cur_row_offset + px_to_emu(dy);
        obj.common.anchor.anchor_col_offset = new_col_offset;
        obj.common.anchor.anchor_row_offset = new_row_offset;
        Some((new_col_offset, new_row_offset))
    } else {
        None
    };

    obj.common.width = config.width.get();
    obj.common.height = config.height.get();
    obj.common.anchor.extent_cx = Some(px_to_emu(config.width.get()));
    obj.common.anchor.extent_cy = Some(px_to_emu(config.height.get()));
    obj.common.updated_at = now;

    let mut field_updates: Vec<(&str, Any)> = vec![
        ("width", Any::Number(config.width.get())),
        ("height", Any::Number(config.height.get())),
        (
            KEY_EXTENT_CX_EMU,
            Any::Number(px_to_emu(config.width.get()) as f64),
        ),
        (
            KEY_EXTENT_CY_EMU,
            Any::Number(px_to_emu(config.height.get()) as f64),
        ),
        ("updatedAt", Any::Number(now as f64)),
    ];
    if let Some((new_col_offset, new_row_offset)) = position_changed {
        field_updates.push((
            KEY_ANCHOR_COL_OFFSET_EMU,
            Any::Number(new_col_offset as f64),
        ));
        field_updates.push((
            KEY_ANCHOR_ROW_OFFSET_EMU,
            Any::Number(new_row_offset as f64),
        ));
    }
    update_object_fields(&mut txn, &inner, &field_updates);

    serde_json::to_value(&obj).ok()
}

/// Set the rotation of a floating object (normalized to 0..360 degrees).
///
/// Returns the updated JSON object, or `None` if the object was not found.
pub fn rotate_floating_object_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    rotation: f64,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;
    let (mut obj, inner) = read_object_for_update(&txn, &map, object_id)?;

    let normalized = rotation.rem_euclid(360.0);
    let now = now_millis();
    obj["rotation"] = serde_json::json!(normalized);
    obj["updatedAt"] = serde_json::json!(now);

    update_object_fields(
        &mut txn,
        &inner,
        &[
            (FO_ROTATION, Any::Number(normalized)),
            (FO_UPDATED_AT, Any::Number(now as f64)),
        ],
    );

    Some(obj)
}

/// Partially update the style of a shape (fill, outline, text, shadow, adjustments,
/// opacity, locked). Only fields present in `updates` are changed.
///
/// Returns the updated JSON object, or `None` if the object was not found.
///
/// Also available as `update_shape_style` (alias without the `_typed` suffix).
pub fn update_shape_style_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    updates: &ShapeStyleUpdate,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;
    let (mut obj, inner) = read_object_for_update(&txn, &map, object_id)?;

    let now = now_millis();
    let mut field_updates: Vec<(&str, Any)> = Vec::new();

    if let Some(ref fill) = updates.fill {
        let val = serde_json::to_value(fill).unwrap();
        obj["fill"] = val.clone();
        field_updates.push((FO_FILL, json_value_to_any(&val)));
    }
    if let Some(ref outline) = updates.outline {
        let val = serde_json::to_value(outline).unwrap();
        obj["outline"] = val.clone();
        field_updates.push((FO_OUTLINE, json_value_to_any(&val)));
    }
    if let Some(ref text) = updates.text {
        let val = serde_json::to_value(text).unwrap();
        obj["text"] = val.clone();
        field_updates.push((FO_TEXT, json_value_to_any(&val)));
    }
    if let Some(ref shadow) = updates.shadow {
        let val = serde_json::to_value(shadow).unwrap();
        obj["shadow"] = val.clone();
        field_updates.push((FO_SHADOW, json_value_to_any(&val)));
    }
    if let Some(ref adjustments) = updates.adjustments {
        let val = serde_json::to_value(adjustments).unwrap();
        obj["adjustments"] = val.clone();
        field_updates.push((FO_ADJUSTMENTS, json_value_to_any(&val)));
    }
    if let Some(opacity) = updates.opacity {
        obj["opacity"] = serde_json::json!(opacity.get());
        field_updates.push((FO_OPACITY, Any::Number(opacity.get())));
    }
    if let Some(locked) = updates.locked {
        obj["locked"] = serde_json::json!(locked);
        field_updates.push((FO_LOCKED, Any::Bool(locked)));
    }

    obj["updatedAt"] = serde_json::json!(now);
    field_updates.push((FO_UPDATED_AT, Any::Number(now as f64)));

    update_object_fields(&mut txn, &inner, &field_updates);

    Some(obj)
}

/// Alias for `update_shape_style_typed` (name without the `_typed` suffix for engine callers).
pub fn update_shape_style(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    updates: &ShapeStyleUpdate,
) -> Option<serde_json::Value> {
    update_shape_style_typed(doc, sheets, sheet_id, object_id, updates)
}

/// Toggle the horizontal or vertical flip on a floating object.
///
/// Returns the updated JSON object, or `None` if the object was not found.
pub fn flip_floating_object_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    axis: &FlipAxis,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;
    let (mut obj, inner) = read_object_for_update(&txn, &map, object_id)?;

    let now = now_millis();

    let (flip_key, new_val) = match axis {
        FlipAxis::Horizontal => {
            let current = obj.get("flipH").and_then(|v| v.as_bool()).unwrap_or(false);
            obj["flipH"] = serde_json::json!(!current);
            (FO_FLIP_H, !current)
        }
        FlipAxis::Vertical => {
            let current = obj.get("flipV").and_then(|v| v.as_bool()).unwrap_or(false);
            obj["flipV"] = serde_json::json!(!current);
            (FO_FLIP_V, !current)
        }
    };

    obj["updatedAt"] = serde_json::json!(now);

    update_object_fields(
        &mut txn,
        &inner,
        &[
            (flip_key, Any::Bool(new_val)),
            (FO_UPDATED_AT, Any::Number(now as f64)),
        ],
    );

    Some(obj)
}

/// Duplicate a floating object with a positional offset.
///
/// Creates a deep clone with a new ID, new z-index (front), new timestamps,
/// and the position shifted by `(offset_x, offset_y)`.
///
/// Returns the new object JSON, or `None` if the source object was not found.
pub fn duplicate_floating_object_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    offset_x: f64,
    offset_y: f64,
    id_alloc: &cell_types::IdAllocator,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;

    // Read as typed struct — the source of truth.
    let mut obj = read_object_structured(&txn, &map, object_id)?;

    let new_id = generate_object_id(id_alloc);
    let now = now_millis();

    // Compute new z-index (max + 1). Charts are floating objects now, so one scan suffices.
    let max_z = read_all_typed(&txn, &map)
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(-1);

    // Update identity fields.
    obj.common.id = new_id.clone();
    obj.common.z_index = max_z + 1;
    obj.common.created_at = now;
    obj.common.updated_at = now;

    // Offset position using the correct anchor offset fields.
    obj.common.anchor.anchor_col_offset += px_to_emu(offset_x);
    obj.common.anchor.anchor_row_offset += px_to_emu(offset_y);

    // Generate a new name.
    let old_name = obj.common.name.clone();
    obj.common.name = if old_name.is_empty() {
        "Shape (Copy)".to_string()
    } else {
        format!("{} (Copy)", old_name)
    };

    // Write as typed struct — the canonical write path.
    write_object_typed(&mut txn, &map, &new_id, &obj);
    serde_json::to_value(&obj).ok()
}

use crate::engine_types::floating_objects::ZOrderEntry;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use yrs::{Doc, MapRef};

use super::objects::{get_all_floating_objects_typed, update_floating_object};

pub fn get_floating_object_max_z_index(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> i32 {
    get_all_floating_objects_typed(doc, sheets, sheet_id)
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(0)
}

/// Get the minimum z_index among all floating objects in a sheet. Returns 0 if empty.
pub fn get_floating_object_min_z_index(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> i32 {
    get_all_floating_objects_typed(doc, sheets, sheet_id)
        .iter()
        .map(|o| o.common.z_index)
        .min()
        .unwrap_or(0)
}

/// Bring a floating object to the front (highest z_index + 1).
pub fn bring_floating_object_to_front(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) {
    let max_z = get_floating_object_max_z_index(doc, sheets, sheet_id);
    let updates = serde_json::json!({ "zIndex": max_z + 1 });
    update_floating_object(doc, sheets, sheet_id, object_id, &updates);
}

/// Send a floating object to the back (lowest z_index - 1).
pub fn send_floating_object_to_back(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) {
    let min_z = get_floating_object_min_z_index(doc, sheets, sheet_id);
    let updates = serde_json::json!({ "zIndex": min_z - 1 });
    update_floating_object(doc, sheets, sheet_id, object_id, &updates);
}

/// Bring a floating object one step forward in z-order.
pub fn bring_floating_object_forward(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) {
    let objects = get_all_floating_objects_typed(doc, sheets, sheet_id);
    let current = match objects.iter().find(|o| o.common.id == object_id) {
        Some(o) => o,
        None => return,
    };
    let current_z = current.common.z_index;
    let next_above = objects
        .iter()
        .filter(|o| o.common.id != object_id && o.common.z_index > current_z)
        .min_by_key(|o| o.common.z_index);
    if let Some(above) = next_above {
        let above_z = above.common.z_index;
        let above_id = above.common.id.clone();
        update_floating_object(
            doc,
            sheets,
            sheet_id,
            object_id,
            &serde_json::json!({ "zIndex": above_z }),
        );
        update_floating_object(
            doc,
            sheets,
            sheet_id,
            &above_id,
            &serde_json::json!({ "zIndex": current_z }),
        );
    }
}

/// Send a floating object one step backward in z-order.
pub fn send_floating_object_backward(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) {
    let objects = get_all_floating_objects_typed(doc, sheets, sheet_id);
    let current = match objects.iter().find(|o| o.common.id == object_id) {
        Some(o) => o,
        None => return,
    };
    let current_z = current.common.z_index;
    let next_below = objects
        .iter()
        .filter(|o| o.common.id != object_id && o.common.z_index < current_z)
        .max_by_key(|o| o.common.z_index);
    if let Some(below) = next_below {
        let below_z = below.common.z_index;
        let below_id = below.common.id.clone();
        update_floating_object(
            doc,
            sheets,
            sheet_id,
            object_id,
            &serde_json::json!({ "zIndex": below_z }),
        );
        update_floating_object(
            doc,
            sheets,
            sheet_id,
            &below_id,
            &serde_json::json!({ "zIndex": current_z }),
        );
    }
}

/// Get all floating objects in a sheet sorted by z_index ascending (back to front).
pub fn get_floating_objects_in_z_order(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    let mut objects = get_all_floating_objects_typed(doc, sheets, sheet_id);
    objects.sort_by_key(|o| o.common.z_index);
    objects
}

// =============================================================================
// Floating Object Group Operations
// =============================================================================

pub fn get_max_z_index_all(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> i32 {
    get_floating_object_max_z_index(doc, sheets, sheet_id)
}

/// Get the minimum z-index across ALL floating objects (including charts) in a sheet.
///
/// After chart unification, this is identical to `get_floating_object_min_z_index`.
pub fn get_min_z_index_all(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> i32 {
    get_floating_object_min_z_index(doc, sheets, sheet_id)
}

/// Get all floating objects (including charts) sorted by z-order (ascending, back to front).
///
/// After chart unification, charts are identified by `type == "chart"` in the floating objects map.
pub fn get_all_in_z_order(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<ZOrderEntry> {
    let obj_list = get_all_floating_objects_typed(doc, sheets, sheet_id);

    let mut entries: Vec<ZOrderEntry> = Vec::with_capacity(obj_list.len());

    for o in &obj_list {
        let is_chart = o.object_type() == "chart";
        if is_chart {
            entries.push(ZOrderEntry::Chart {
                id: o.common.id.clone(),
                z_index: o.common.z_index,
            });
        } else {
            entries.push(ZOrderEntry::FloatingObject {
                id: o.common.id.clone(),
                z_index: o.common.z_index,
            });
        }
    }

    entries.sort_by_key(|e| match e {
        ZOrderEntry::Chart { z_index, .. } => *z_index,
        ZOrderEntry::FloatingObject { z_index, .. } => *z_index,
    });

    entries
}

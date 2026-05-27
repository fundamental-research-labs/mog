use crate::engine_types::floating_objects::SerializedFloatingObjectGroup;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_FLOATING_OBJECT_GROUPS;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::codec::{
    json_value_to_any, read_group_typed_from_ymap, read_raw_map_for_update, update_object_fields,
};
use super::ids::generate_group_id;
use super::sheet_map::get_sheet_submap;

pub fn set_floating_object_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
    json: &serde_json::Value,
) -> Result<(), ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS).ok_or_else(
        || ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        },
    )?;

    // Groups use raw JSON write since they don't map to FloatingObject.
    write_group_from_json(&mut txn, &map, group_id, json);
    Ok(())
}

/// Write a group as a structured Y.Map from JSON.
pub(super) fn write_group_from_json(
    txn: &mut yrs::TransactionMut,
    map: &MapRef,
    group_id: &str,
    json: &serde_json::Value,
) {
    let obj_map = match json.as_object() {
        Some(m) => m,
        None => return,
    };
    let mut entries: Vec<(&str, Any)> = Vec::with_capacity(obj_map.len());
    for (key, value) in obj_map {
        entries.push((key.as_str(), json_value_to_any(value)));
    }
    let prelim: MapPrelim = entries.into_iter().collect();
    map.insert(txn, group_id, prelim);
}

/// Get a single floating object group by ID as a JSON value.
pub fn get_floating_object_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS)?;
    // Groups are read as SerializedFloatingObjectGroup and serialized to JSON.
    match map.get(&txn, group_id)? {
        Out::YMap(inner) => {
            let grp = read_group_typed_from_ymap(&txn, &inner)?;
            serde_json::to_value(&grp).ok()
        }
        _ => None,
    }
}

/// Get all floating object groups in a sheet as (groupId, json) pairs.
pub fn get_all_floating_object_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<(String, serde_json::Value)> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS) {
        Some(m) => {
            let mut result = Vec::new();
            for (key, value) in m.iter(&txn) {
                if let Out::YMap(inner) = &value
                    && let Some(grp) = read_group_typed_from_ymap(&txn, inner)
                    && let Ok(json) = serde_json::to_value(&grp)
                {
                    result.push((key.to_string(), json));
                }
            }
            result
        }
        None => vec![],
    }
}

/// Delete a floating object group by ID. Returns `true` if found and removed.
pub fn delete_floating_object_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS) {
        Some(m) => m,
        None => return false,
    };

    if map.get(&txn, group_id).is_none() {
        return false;
    }

    map.remove(&mut txn, group_id);
    true
}

// =============================================================================
// Typed Floating Object Group Operations
// =============================================================================

/// Create a new floating object group in the given sheet from a JSON config object.
///
/// Generates a unique group ID, sets the sheet_id, and stores the group.
/// Returns the generated group ID on success.
pub fn create_floating_object_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &serde_json::Value,
    id_alloc: &cell_types::IdAllocator,
) -> Result<String, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let group_id = generate_group_id(id_alloc);

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS).ok_or_else(
        || ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        },
    )?;

    let mut obj = config.clone();
    if let Some(m) = obj.as_object_mut() {
        m.insert(
            "id".to_string(),
            serde_json::Value::String(group_id.clone()),
        );
        m.insert(
            "sheetId".to_string(),
            serde_json::Value::String(sheet_hex.to_string()),
        );
    }

    write_group_from_json(&mut txn, &map, &group_id, &obj);

    Ok(group_id)
}

/// Update a floating object group by merging `updates` into the existing JSON.
pub fn update_floating_object_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
    updates: &serde_json::Value,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS) {
        Some(m) => m,
        None => return false,
    };

    let (_obj, inner) = match read_raw_map_for_update(&txn, &map, group_id) {
        Some(r) => r,
        None => return false,
    };

    let updates_obj = match updates.as_object() {
        Some(m) => m,
        None => return false,
    };

    // Field-level updates on only the changed keys
    let mut field_updates: Vec<(&str, Any)> = Vec::new();
    for (key, value) in updates_obj {
        field_updates.push((key.as_str(), json_value_to_any(value)));
    }
    update_object_fields(&mut txn, &inner, &field_updates);

    true
}

/// Get a single floating object group by ID as a typed struct.
pub fn get_floating_object_group_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<SerializedFloatingObjectGroup> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS)?;
    match map.get(&txn, group_id)? {
        Out::YMap(inner) => read_group_typed_from_ymap(&txn, &inner),
        _ => None,
    }
}

/// Get all floating object groups in a sheet as typed structs.
///
/// Uses direct Y.Map field reads — no JSON roundtrip.
pub fn get_all_floating_object_groups_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<SerializedFloatingObjectGroup> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECT_GROUPS) {
        Some(m) => {
            let mut result = Vec::new();
            for (_key, value) in m.iter(&txn) {
                if let Out::YMap(inner) = &value
                    && let Some(grp) = read_group_typed_from_ymap(&txn, inner)
                {
                    result.push(grp);
                }
            }
            result
        }
        None => vec![],
    }
}

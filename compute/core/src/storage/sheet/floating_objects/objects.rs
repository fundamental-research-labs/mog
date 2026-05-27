use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_FLOATING_OBJECTS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::floating_object::FloatingObject;
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapRef, Origin, Transact};

use super::codec::{
    json_value_to_any, read_all_entries_as_json, read_all_typed, read_object_as_json,
    read_object_for_update, read_object_structured, update_object_fields, write_object_from_json,
};
use super::ids::{generate_object_id, now_millis};
use super::keys::FO_UPDATED_AT;
use super::sheet_map::get_sheet_submap;

pub fn set_floating_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    json: &serde_json::Value,
) -> Result<(), ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map =
        get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            }
        })?;

    write_object_from_json(&mut txn, &map, object_id, json);
    Ok(())
}

/// Get a single floating object by ID as a JSON value.
pub fn get_floating_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) -> Option<serde_json::Value> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;
    read_object_as_json(&txn, &map, object_id)
}

/// Get all floating objects in a sheet as (objectId, json) pairs.
pub fn get_all_floating_objects(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<(String, serde_json::Value)> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS) {
        Some(m) => read_all_entries_as_json(&txn, &m),
        None => vec![],
    }
}

/// Delete a floating object by ID. Returns `true` if found and removed.
pub fn delete_floating_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS) {
        Some(m) => m,
        None => return false,
    };

    if map.get(&txn, object_id).is_none() {
        return false;
    }

    map.remove(&mut txn, object_id);
    true
}

// =============================================================================
// Typed Floating Object Operations
// =============================================================================

/// Create a new floating object in the given sheet from a JSON config object.
///
/// Generates a unique ID, sets timestamps and z_index (auto-increment), and stores
/// the object. Returns the generated object ID on success.
pub fn create_floating_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &serde_json::Value,
    id_alloc: &cell_types::IdAllocator,
) -> Result<String, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let object_id = generate_object_id(id_alloc);
    let now = now_millis();

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map =
        get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            }
        })?;

    let max_z = read_all_typed(&txn, &map)
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(-1);

    let mut obj = config.clone();
    if let Some(m) = obj.as_object_mut() {
        m.insert(
            "id".to_string(),
            serde_json::Value::String(object_id.clone()),
        );
        m.insert(
            "sheetId".to_string(),
            serde_json::Value::String(sheet_hex.to_string()),
        );
        m.insert(
            "createdAt".to_string(),
            serde_json::Value::Number(serde_json::Number::from(now)),
        );
        m.insert(
            "updatedAt".to_string(),
            serde_json::Value::Number(serde_json::Number::from(now)),
        );
        m.insert(
            "zIndex".to_string(),
            serde_json::Value::Number(serde_json::Number::from(max_z + 1)),
        );
    }

    write_object_from_json(&mut txn, &map, &object_id, &obj);

    Ok(object_id)
}

/// Update a floating object by merging `updates` into the existing JSON.
pub fn update_floating_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
    updates: &serde_json::Value,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map = match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS) {
        Some(m) => m,
        None => return false,
    };

    let (mut obj, inner) = match read_object_for_update(&txn, &map, object_id) {
        Some(r) => r,
        None => return false,
    };

    let updates_obj = match updates.as_object() {
        Some(m) => m,
        None => return false,
    };

    // Merge updates into obj (for return value consistency)
    if let Some(existing_obj) = obj.as_object_mut() {
        for (key, value) in updates_obj {
            existing_obj.insert(key.clone(), value.clone());
        }
        existing_obj.insert(
            "updatedAt".to_string(),
            serde_json::Value::Number(serde_json::Number::from(now_millis())),
        );
    }

    // Flatten nested objects that the Yrs schema stores as flat top-level fields.
    // The TS API sends `{ anchor: { anchorRow, anchorCol, ... } }` but the Yrs
    // schema writes/reads these as flat entries: `anchorRow`, `anchorCol`, etc.
    let mut flat_updates: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    for (key, value) in updates_obj {
        if key == "anchor"
            && let Some(anchor_obj) = value.as_object()
        {
            for (ak, av) in anchor_obj {
                flat_updates.insert(ak.clone(), av.clone());
            }
            continue;
        }
        flat_updates.insert(key.clone(), value.clone());
    }

    // Field-level updates on only the changed keys
    let mut field_updates: Vec<(&str, Any)> = Vec::new();
    for (key, value) in &flat_updates {
        field_updates.push((key.as_str(), json_value_to_any(value)));
    }
    field_updates.push((FO_UPDATED_AT, Any::Number(now_millis() as f64)));
    update_object_fields(&mut txn, &inner, &field_updates);

    true
}

/// Get a single floating object by ID as a typed struct.
///
/// Uses the unified yrs_schema reader — no JSON roundtrip.
pub fn get_floating_object_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    object_id: &str,
) -> Option<FloatingObject> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS)?;
    read_object_structured(&txn, &map, object_id)
}

/// Get all floating objects in a sheet as typed structs.
///
/// Uses the unified yrs_schema reader — no JSON roundtrip.
pub fn get_all_floating_objects_typed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<FloatingObject> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS) {
        Some(m) => read_all_typed(&txn, &m),
        None => vec![],
    }
}

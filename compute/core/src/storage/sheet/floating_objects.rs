//! Sheet-level Floating Object CRUD operations with z-order management.
//!
//! Floating objects (shapes, images, connectors, textboxes, group shapes) are stored as
//! **structured Y.Map entries** in per-sheet Yrs maps. Each object's primitive fields
//! (position, size, rotation, flags) are stored as native `Any` values for field-level
//! CRDT conflict resolution. Complex sub-objects (fill, outline, text, shadow) are stored
//! as JSON strings within the Y.Map for atomic-per-sub-object semantics.
//!
//! ## Yrs Storage Layout
//!
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- floatingObjects: Y.Map<ObjectId, Y.Map>
//!       |     +-- "id"       → String
//!       |     +-- "x"        → Number
//!       |     +-- "width"    → Number
//!       |     +-- "fill"     → String (JSON)
//!       |     +-- ...
//!       +-- floatingObjectGroups: Y.Map<GroupId, Y.Map>
//!             +-- "id"       → String
//!             +-- "children" → String (JSON array)
//!             +-- ...
//! ```

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::engine_types::floating_objects::{
    CreateShapeConfig, FlipAxis, MoveTarget, ResizeConfig, SerializedFloatingObjectGroup,
    ShapeStyleUpdate, ZOrderEntry,
};
use cell_types::CellId;
use cell_types::SheetId;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_FLOATING_OBJECT_GROUPS, KEY_FLOATING_OBJECTS};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::floating_object::{
    AnchorMode, ChartData, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon,
    FloatingObjectData, ShapeData,
};
use domain_types::yrs_schema::floating_object as fo_yrs;
use value_types::ComputeError;

use compute_layout_index::LayoutIndex;
use snapshot_types::FloatingObjectBounds;

/// English Metric Units per CSS pixel at 96 DPI.
///
/// OOXML drawing anchors persist offsets and extents in EMUs. UI and renderer
/// APIs operate in CSS pixels, so all persistence boundaries must convert by
/// this factor instead of storing ambiguous pixel values in anchor fields.
const EMU_PER_CSS_PX: f64 = 9_525.0;
const KEY_ANCHOR_ROW_OFFSET_EMU: &str = "anchorRowOffsetEmu";
const KEY_ANCHOR_COL_OFFSET_EMU: &str = "anchorColOffsetEmu";
const KEY_END_ROW_OFFSET_EMU: &str = "endRowOffsetEmu";
const KEY_END_COL_OFFSET_EMU: &str = "endColOffsetEmu";
const KEY_EXTENT_CX_EMU: &str = "extentCxEmu";
const KEY_EXTENT_CY_EMU: &str = "extentCyEmu";

fn px_to_emu(px: f64) -> i64 {
    (px * EMU_PER_CSS_PX).round() as i64
}

fn emu_to_px(emu: f64) -> f64 {
    emu / EMU_PER_CSS_PX
}

fn json_number_to_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|v| v.round() as i64))
}

fn json_i64_alias(
    obj: &serde_json::Map<String, serde_json::Value>,
    canonical: &str,
    legacy: &str,
) -> Option<i64> {
    obj.get(canonical)
        .and_then(json_number_to_i64)
        .or_else(|| obj.get(legacy).and_then(json_number_to_i64))
}

// =============================================================================
// Private Helpers
// =============================================================================

/// Get a per-sheet sub-map by key (read-only).
fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
    map_key: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, map_key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Get the current timestamp in milliseconds since UNIX epoch (as i64).
fn now_millis() -> i64 {
    crate::storage::infra::yrs_helpers::now_millis() as i64
}

/// Generate a unique floating object ID: `fobj-{timestamp_millis}-{counter_hex}`.
///
/// Uses the `fobj-` prefix to match the canonical key convention expected by
/// the export pipeline (`export_floating_objects_for_sheet` filters on `fobj-*`).
/// Uniqueness is guaranteed by the monotonic `IdAllocator` counter.
fn generate_object_id(id_alloc: &cell_types::IdAllocator) -> String {
    let ts = now_millis();
    let n = id_alloc.next_u128();
    format!("fobj-{}-{:x}", ts, n)
}

/// Generate a unique floating object group ID: `grp-{timestamp_millis}-{counter_hex}`.
fn generate_group_id(id_alloc: &cell_types::IdAllocator) -> String {
    let ts = now_millis();
    let n = id_alloc.next_u128();
    format!("grp-{}-{:x}", ts, n)
}

// =============================================================================
// Field key constants (used by update_object_fields for partial writes)
// =============================================================================

const FO_UPDATED_AT: &str = "updatedAt";
const FO_X: &str = "x";
const FO_Y: &str = "y";
const FO_WIDTH: &str = "width";
const FO_HEIGHT: &str = "height";
const FO_Z_INDEX: &str = "zIndex";
const FO_ROTATION: &str = "rotation";
const FO_LOCKED: &str = "locked";
const FO_FLIP_H: &str = "flipH";
const FO_FLIP_V: &str = "flipV";
const FO_OPACITY: &str = "opacity";
const FO_FILL: &str = "fill";
const FO_OUTLINE: &str = "outline";
const FO_TEXT: &str = "text";
const FO_SHADOW: &str = "shadow";
const FO_ADJUSTMENTS: &str = "adjustments";
const FO_CHILDREN: &str = "children";
const FO_EXTRA: &str = "_extra";

// =============================================================================
// Structured CRDT Storage — Readers (delegated to domain_types::yrs_schema)
// =============================================================================

/// Read a single floating object by ID from the structured Y.Map storage.
fn read_object_structured(
    txn: &impl yrs::ReadTxn,
    map: &MapRef,
    object_id: &str,
) -> Option<FloatingObject> {
    match map.get(txn, object_id)? {
        Out::YMap(inner) => fo_yrs::from_yrs_map(&inner, txn),
        _ => None,
    }
}

/// Read a single floating object as JSON (for callers that need serde_json::Value).
/// Tries the unified schema reader first; falls back to raw Y.Map reading for
/// objects that don't fully conform to the FloatingObject schema.
fn read_object_as_json(
    txn: &impl yrs::ReadTxn,
    map: &MapRef,
    object_id: &str,
) -> Option<serde_json::Value> {
    match map.get(txn, object_id)? {
        Out::YMap(inner) => {
            // Try typed reader first
            if let Some(obj) = fo_yrs::from_yrs_map(&inner, txn) {
                return serde_json::to_value(&obj).ok();
            }
            // Fallback: raw Y.Map → JSON
            let mut json_map = serde_json::Map::new();
            for (key, value) in inner.iter(txn) {
                if let Some(json_val) = out_to_json_value(&value) {
                    json_map.insert(key.to_string(), json_val);
                }
            }
            Some(serde_json::Value::Object(json_map))
        }
        _ => None,
    }
}

/// Read all floating objects from a map as typed `FloatingObject` values.
fn read_all_typed<T: yrs::ReadTxn>(txn: &T, map: &MapRef) -> Vec<FloatingObject> {
    let mut result = Vec::new();
    for (_key, value) in map.iter(txn) {
        if let Out::YMap(inner) = &value
            && let Some(obj) = fo_yrs::from_yrs_map(inner, txn)
        {
            result.push(obj);
        }
    }
    result
}

/// Read all floating object entries from a map as `(objectId, serde_json::Value)` pairs.
fn read_all_entries_as_json<T: yrs::ReadTxn>(
    txn: &T,
    map: &MapRef,
) -> Vec<(String, serde_json::Value)> {
    let mut result = Vec::new();
    for (key, value) in map.iter(txn) {
        if let Out::YMap(inner) = &value {
            // Try typed reader first
            if let Some(obj) = fo_yrs::from_yrs_map(inner, txn)
                && let Ok(json) = serde_json::to_value(&obj)
            {
                result.push((key.to_string(), json));
                continue;
            }
            // Fallback: raw Y.Map → JSON
            let mut json_map = serde_json::Map::new();
            for (k, v) in inner.iter(txn) {
                if let Some(json_val) = out_to_json_value(&v) {
                    json_map.insert(k.to_string(), json_val);
                }
            }
            result.push((key.to_string(), serde_json::Value::Object(json_map)));
        }
    }
    result
}

/// Read a floating object for mutation, returning the assembled JSON and the inner MapRef
/// for field-level updates.
fn read_object_for_update(
    txn: &impl yrs::ReadTxn,
    map: &MapRef,
    object_id: &str,
) -> Option<(serde_json::Value, MapRef)> {
    match map.get(txn, object_id)? {
        Out::YMap(inner) => {
            let obj = fo_yrs::from_yrs_map(&inner, txn)?;
            let json = serde_json::to_value(&obj).ok()?;
            Some((json, inner))
        }
        _ => None,
    }
}

/// Read a Y.Map entry for mutation without type-specific deserialization.
/// Used for groups and other non-FloatingObject maps.
fn read_raw_map_for_update(
    txn: &impl yrs::ReadTxn,
    map: &MapRef,
    entry_id: &str,
) -> Option<(serde_json::Value, MapRef)> {
    match map.get(txn, entry_id)? {
        Out::YMap(inner) => {
            // Build a raw JSON map from Y.Map entries
            let mut json_map = serde_json::Map::new();
            for (key, value) in inner.iter(txn) {
                let key_str = key.to_string();
                if let Some(json_val) = out_to_json_value(&value) {
                    json_map.insert(key_str, json_val);
                }
            }
            Some((serde_json::Value::Object(json_map), inner))
        }
        _ => None,
    }
}

/// Convert a Y.Map Out value to serde_json::Value.
fn out_to_json_value(out: &Out) -> Option<serde_json::Value> {
    match out {
        Out::Any(any) => match any {
            Any::Number(n) => {
                if n.fract() == 0.0 && *n >= i64::MIN as f64 && *n <= i64::MAX as f64 {
                    Some(serde_json::Value::Number(serde_json::Number::from(
                        *n as i64,
                    )))
                } else {
                    serde_json::Number::from_f64(*n).map(serde_json::Value::Number)
                }
            }
            Any::String(s) => {
                // Try to parse as JSON sub-object first
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s)
                    && (parsed.is_object() || parsed.is_array())
                {
                    return Some(parsed);
                }
                Some(serde_json::Value::String(s.to_string()))
            }
            Any::Bool(b) => Some(serde_json::Value::Bool(*b)),
            Any::Null | Any::Undefined => Some(serde_json::Value::Null),
            _ => None,
        },
        _ => None,
    }
}

/// Convert a JSON value to a Yrs `Any` for partial field updates.
/// Primitive types → native Any; complex objects → JSON string.
fn json_value_to_any(value: &serde_json::Value) -> Any {
    match value {
        serde_json::Value::Number(n) => Any::Number(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => Any::String(Arc::from(s.as_str())),
        serde_json::Value::Bool(b) => Any::Bool(*b),
        serde_json::Value::Null => Any::Null,
        other => {
            // Complex objects/arrays are stored as JSON strings in Y.Map entries.
            // The read path (`out_to_json_value`) parses them back on read.
            let json_str = serde_json::to_string(other).unwrap_or_default();
            Any::String(Arc::from(json_str.as_str()))
        }
    }
}

/// Read a string from a Y.Map entry.
fn ymap_read_string(map: &MapRef, txn: &impl yrs::ReadTxn, key: &str) -> Option<String> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

/// Read an f64 from a Y.Map entry.
fn ymap_read_f64(map: &MapRef, txn: &impl yrs::ReadTxn, key: &str) -> Option<f64> {
    match map.get(txn, key)? {
        Out::Any(Any::Number(n)) => Some(n),
        _ => None,
    }
}

/// Read a bool from a Y.Map entry.
fn ymap_read_bool(map: &MapRef, txn: &impl yrs::ReadTxn, key: &str) -> Option<bool> {
    match map.get(txn, key)? {
        Out::Any(Any::Bool(b)) => Some(b),
        _ => None,
    }
}

/// Read an i32 from a Y.Map entry (stored as f64).
fn ymap_read_i32(map: &MapRef, txn: &impl yrs::ReadTxn, key: &str) -> Option<i32> {
    ymap_read_f64(map, txn, key).map(|n| n as i32)
}

/// Read a sub-object JSON string from a Y.Map entry and deserialize it.
fn ymap_read_sub_object<T: serde::de::DeserializeOwned>(
    map: &MapRef,
    txn: &impl yrs::ReadTxn,
    key: &str,
) -> Option<T> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => serde_json::from_str(&s).ok(),
        Out::Any(Any::Null) | Out::Any(Any::Undefined) => None,
        _ => None,
    }
}

/// Read a sub-object as raw serde_json::Value from a Y.Map entry.
fn ymap_read_sub_object_value(
    map: &MapRef,
    txn: &impl yrs::ReadTxn,
    key: &str,
) -> Option<serde_json::Value> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => serde_json::from_str(&s).ok(),
        Out::Any(Any::Null) | Out::Any(Any::Undefined) => None,
        _ => None,
    }
}

/// Read a `SerializedFloatingObjectGroup` directly from a Y.Map — no JSON roundtrip.
fn read_group_typed_from_ymap(
    txn: &impl yrs::ReadTxn,
    inner: &MapRef,
) -> Option<SerializedFloatingObjectGroup> {
    let id = ymap_read_string(inner, txn, "id").unwrap_or_default();
    let sheet_id = ymap_read_string(inner, txn, "sheetId").unwrap_or_default();

    // Read _extra for the catch-all
    let mut extra = match ymap_read_sub_object_value(inner, txn, FO_EXTRA) {
        Some(v @ serde_json::Value::Object(_)) => v,
        _ => serde_json::Value::Object(serde_json::Map::new()),
    };

    // "children" is stored as a JSON string (sub-object field).
    // For backward compatibility, also check if it was stored in _extra.
    let children: Vec<String> = ymap_read_sub_object(inner, txn, FO_CHILDREN)
        .or_else(|| {
            extra.as_object_mut().and_then(|m| {
                m.remove("children")
                    .and_then(|v| serde_json::from_value(v).ok())
            })
        })
        .unwrap_or_default();

    // Wrap raw yrs-stored coordinates with `FiniteF64::new`, mapping any
    // non-finite stored value (corrupt/legacy) to `None` rather than
    // crashing — the wire shape is `Option<FiniteF64>` either way.
    Some(SerializedFloatingObjectGroup {
        id,
        sheet_id,
        children,
        x: ymap_read_f64(inner, txn, FO_X).and_then(value_types::FiniteF64::new),
        y: ymap_read_f64(inner, txn, FO_Y).and_then(value_types::FiniteF64::new),
        width: ymap_read_f64(inner, txn, FO_WIDTH).and_then(value_types::FiniteF64::new),
        height: ymap_read_f64(inner, txn, FO_HEIGHT).and_then(value_types::FiniteF64::new),
        z_index: ymap_read_i32(inner, txn, FO_Z_INDEX),
        name: ymap_read_string(inner, txn, "name"),
        locked: ymap_read_bool(inner, txn, FO_LOCKED),
        extra,
    })
}

// =============================================================================
// Structured CRDT Storage — Writers
// =============================================================================

/// Write a FloatingObject as a structured Y.Map entry using the unified yrs_schema.
fn write_object_typed(
    txn: &mut yrs::TransactionMut,
    map: &MapRef,
    object_id: &str,
    obj: &FloatingObject,
) {
    let entries = fo_yrs::to_yrs_prelim(obj);
    let prelim: MapPrelim = entries.into_iter().collect();
    map.insert(txn, object_id, prelim);
}

/// Write a floating object from a JSON value. Deserializes to FloatingObject first,
/// then uses the unified yrs_schema. Falls back to raw JSON write for unrecognized types.
fn write_object_from_json(
    txn: &mut yrs::TransactionMut,
    map: &MapRef,
    object_id: &str,
    json: &serde_json::Value,
) {
    if let Ok(obj) = serde_json::from_value::<FloatingObject>(json.clone()) {
        write_object_typed(txn, map, object_id, &obj);
    } else {
        // Fallback: write raw JSON fields to Y.Map for data that doesn't parse
        // into FloatingObject (e.g., incomplete/partial config objects).
        let obj_map = match json.as_object() {
            Some(m) => m,
            None => return,
        };
        let mut entries: Vec<(&str, Any)> = Vec::with_capacity(obj_map.len());
        for (key, value) in obj_map {
            entries.push((key.as_str(), json_value_to_any(value)));
        }
        let prelim: MapPrelim = entries.into_iter().collect();
        map.insert(txn, object_id, prelim);
    }
}

/// Partially update fields on an already-structured Y.Map entry.
///
/// Calls `inner.insert(txn, key, value)` for each update. Only touches
/// the specified keys — other fields remain untouched in the CRDT.
fn update_object_fields(txn: &mut yrs::TransactionMut, inner: &MapRef, updates: &[(&str, Any)]) {
    for (key, value) in updates {
        inner.insert(txn, *key, value.clone());
    }
}

// =============================================================================
// Floating Object Operations
// =============================================================================

/// Set (create or replace) a floating object in the given sheet from a JSON value.
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

// =============================================================================
// Floating Object Z-Order Operations
// =============================================================================

/// Get the maximum z_index among all floating objects in a sheet. Returns 0 if empty.
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

/// Set (create or replace) a floating object group in the given sheet from a JSON value.
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
fn write_group_from_json(
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

// =============================================================================
// Unified Z-Order
// =============================================================================
// Charts are now floating objects, so "all" z-order is just floating object z-order.

/// Get the maximum z-index across ALL floating objects (including charts) in a sheet.
///
/// After chart unification, this is identical to `get_floating_object_max_z_index`.
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

// =============================================================================
// Typed Shape Operations — Private Helpers
// =============================================================================

// =============================================================================
// Typed Shape Operations
// =============================================================================

/// Create a new shape from a fully-typed `CreateShapeConfig`.
///
/// Generates a unique ID, computes z-index (max of floating objects + charts + 1),
/// applies default fill/outline when not provided, and stores the shape via
/// `write_object_typed` (the canonical struct-based write path).
/// Returns the full JSON object on success.
pub fn create_shape_from_config(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &CreateShapeConfig,
    grid_index: Option<&mut GridIndex>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<serde_json::Value, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map =
        get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            }
        })?;

    let object_id = generate_object_id(id_alloc);
    let now = now_millis();

    // Read all floating objects once and reuse for z-index and shape counting.
    let all_objects = read_all_typed(&txn, &map);

    // Compute z-index: max across all floating objects (charts are floating objects now), then +1.
    let max_z = all_objects
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(-1);

    // Auto-generate shape name if not provided.
    let name = config.name.clone().unwrap_or_else(|| {
        let count = all_objects
            .iter()
            .filter(|o| o.object_type() == "shape")
            .count();
        format!("Shape {}", count + 1)
    });

    // Apply defaults for fill and outline.
    let fill = config
        .fill
        .clone()
        .unwrap_or_else(CreateShapeConfig::default_fill);
    let outline = config
        .outline
        .clone()
        .unwrap_or_else(CreateShapeConfig::default_outline);

    // Store stable CellId for identity-based anchoring
    let anchor_cell_id = grid_index.map(|grid| {
        let cell_id = grid.ensure_cell_id(config.anchor_row, config.anchor_col);
        id_to_hex(cell_id.as_u128()).to_string()
    });

    // Build the FloatingObject struct directly — no flat JSON intermediate.
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: object_id.clone(),
            sheet_id: sheet_hex.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: config.anchor_row,
                anchor_col: config.anchor_col,
                anchor_row_offset: px_to_emu(config.y_offset.get()),
                anchor_col_offset: px_to_emu(config.x_offset.get()),
                anchor_mode: AnchorMode::OneCell,
                extent_cx: Some(px_to_emu(config.width.get())),
                extent_cy: Some(px_to_emu(config.height.get())),
                ..Default::default()
            },
            width: config.width.get(),
            height: config.height.get(),
            z_index: max_z + 1,
            rotation: config.rotation.map(|r| r.get()).unwrap_or(0.0),
            locked: false,
            printable: true,
            visible: true,
            opacity: 1.0,
            name,
            created_at: now,
            updated_at: now,
            anchor_cell_id,
            ..Default::default()
        },
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: serde_json::to_string(&config.shape_type)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string(),
            fill: Some(fill),
            outline: Some(outline),
            text: config.text.clone(),
            shadow: config.shadow.clone(),
            // Boundary type uses FiniteF64; ShapeData (domain) uses bare f64.
            // Unwrap each finite value back to f64 — no fallibility added.
            adjustments: config
                .adjustments
                .as_ref()
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v.get())).collect()),
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };

    write_object_typed(&mut txn, &map, &object_id, &obj);
    serde_json::to_value(&obj).map_err(|e| ComputeError::Eval {
        message: e.to_string(),
    })
}

/// Create a new chart as a floating object with `type: "chart"`.
///
/// Generates a unique ID, computes z-index (max of all floating objects + 1),
/// and stores the object via `write_object_typed` (the canonical struct-based write path).
/// All chart domain fields (series, axes, legend, colors, data ranges, etc.) are
/// stored as individual Y.Map keys on the floating object — no `chartConfig` sub-object.
///
/// Returns the full JSON object on success.
pub fn create_chart_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &serde_json::Value,
    grid_index: Option<&mut GridIndex>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<serde_json::Value, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map =
        get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            }
        })?;

    let object_id = generate_object_id(id_alloc);
    let now = now_millis();

    // Read all floating objects for z-index and chart counting.
    let all_objects = read_all_typed(&txn, &map);

    // Compute z-index: max across all floating objects (charts are floating objects now), then +1.
    let max_z = all_objects
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(-1);

    // Count existing charts for auto-name generation.
    let chart_count = all_objects
        .iter()
        .filter(|o| o.object_type() == "chart")
        .count();

    let config_obj = config.as_object().cloned().unwrap_or_default();

    // Extract common fields from config.
    let anchor_row = config_obj
        .get("anchorRow")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let anchor_col = config_obj
        .get("anchorCol")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let x_offset_emu = if let Some(px) = config_obj.get("xOffset").and_then(|v| v.as_f64()) {
        px_to_emu(px)
    } else {
        json_i64_alias(&config_obj, KEY_ANCHOR_COL_OFFSET_EMU, "anchorColOffset").unwrap_or(0)
    };
    let y_offset_emu = if let Some(px) = config_obj.get("yOffset").and_then(|v| v.as_f64()) {
        px_to_emu(px)
    } else {
        json_i64_alias(&config_obj, KEY_ANCHOR_ROW_OFFSET_EMU, "anchorRowOffset").unwrap_or(0)
    };
    let width = config_obj
        .get("width")
        .and_then(|v| v.as_f64())
        .unwrap_or(400.0);
    let height = config_obj
        .get("height")
        .and_then(|v| v.as_f64())
        .unwrap_or(300.0);
    let anchor_mode_str = config_obj
        .get("anchorMode")
        .and_then(|v| v.as_str())
        .unwrap_or("oneCell");
    let anchor_mode = match anchor_mode_str {
        "twoCell" => AnchorMode::TwoCell,
        "absolute" => AnchorMode::Absolute,
        _ => AnchorMode::OneCell,
    };
    let name = config_obj
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Chart {}", chart_count + 1));

    // Store stable CellId for identity-based anchoring.
    let anchor_cell_id = grid_index.map(|grid| {
        let cell_id = grid.ensure_cell_id(anchor_row, anchor_col);
        id_to_hex(cell_id.as_u128()).to_string()
    });

    // Build a merged JSON for chart-specific field parsing.
    let mut chart_json = config_obj.clone();
    // Ensure chartType is set (may have come as "type" from caller).
    if !chart_json.contains_key("chartType")
        && let Some(t) = chart_json.get("type").cloned()
    {
        chart_json.insert("chartType".to_string(), t);
    }

    let chart_data: ChartData = serde_json::from_value(serde_json::Value::Object(chart_json))
        .map_err(|e| ComputeError::Eval {
            message: format!("Invalid chart config: {}", e),
        })?;

    // Build the FloatingObject struct directly — no flat JSON → serde roundtrip.
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: object_id.clone(),
            sheet_id: sheet_hex.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row,
                anchor_col,
                anchor_row_offset: y_offset_emu,
                anchor_col_offset: x_offset_emu,
                anchor_mode,
                end_row: config_obj
                    .get("endRow")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                end_col: config_obj
                    .get("endCol")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                end_row_offset: json_i64_alias(&config_obj, KEY_END_ROW_OFFSET_EMU, "endRowOffset"),
                end_col_offset: json_i64_alias(&config_obj, KEY_END_COL_OFFSET_EMU, "endColOffset"),
                extent_cx: json_i64_alias(&config_obj, KEY_EXTENT_CX_EMU, "extentCx")
                    .or_else(|| Some(px_to_emu(width))),
                extent_cy: json_i64_alias(&config_obj, KEY_EXTENT_CY_EMU, "extentCy")
                    .or_else(|| Some(px_to_emu(height))),
            },
            width,
            height,
            z_index: max_z + 1,
            locked: false,
            printable: true,
            visible: true,
            opacity: 1.0,
            name,
            created_at: now,
            updated_at: now,
            anchor_cell_id,
            ..Default::default()
        },
        data: FloatingObjectData::Chart(chart_data),
    };

    write_object_typed(&mut txn, &map, &object_id, &obj);
    serde_json::to_value(&obj).map_err(|e| ComputeError::Eval {
        message: e.to_string(),
    })
}

// =============================================================================
// Chart Query Helpers (floating objects filtered by type=="chart")
// =============================================================================

/// Get all chart floating objects in a sheet as JSON values.
#[allow(dead_code)]
pub fn get_chart_objects(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<serde_json::Value> {
    get_all_floating_objects(doc, sheets, sheet_id)
        .into_iter()
        .filter(|(_id, json)| json.get("type").and_then(|v| v.as_str()) == Some("chart"))
        .map(|(_id, json)| json)
        .collect()
}

/// Get all chart floating objects linked to a specific table (by sourceTableId primitive field).
#[allow(dead_code)]
pub fn get_charts_linked_to_table(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    table_id: &str,
) -> Vec<serde_json::Value> {
    get_all_floating_objects(doc, sheets, sheet_id)
        .into_iter()
        .filter(|(_id, json)| {
            json.get("type").and_then(|v| v.as_str()) == Some("chart")
                && json.get("sourceTableId").and_then(|v| v.as_str()) == Some(table_id)
        })
        .map(|(_id, json)| json)
        .collect()
}

/// Move a floating object to an absolute or relative position.
///
/// Reads the object as a typed `FloatingObject`, mutates struct fields directly,
/// writes the correct Y.Map keys (`anchorRow`, `anchorCol`,
/// `anchorRowOffsetEmu`, `anchorColOffsetEmu`) that `from_yrs_map` reads, and
/// returns the updated JSON.
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

// =============================================================================
// Connector Connection Queries
// =============================================================================

/// Match a JSON value (string or number) against a shape ID string.
///
/// From OOXML import, `shapeId` may be a JSON number (u32); from user-created
/// connectors it will be a JSON string. This helper handles both cases.
fn match_shape_id(json_val: &serde_json::Value, shape_id: &str) -> bool {
    match json_val {
        serde_json::Value::String(s) => s == shape_id,
        serde_json::Value::Number(n) => {
            // Compare numeric shapeId: convert both to string for comparison
            n.to_string() == shape_id
        }
        _ => false,
    }
}

/// Find all connectors in a sheet that reference a given shape ID via
/// `startConnection.shapeId` or `endConnection.shapeId`.
///
/// Returns a list of `(object_id, serde_json::Value)` pairs for each matching
/// connector. This is used to identify connectors that need re-routing when a
/// shape is moved or resized.
pub fn find_connectors_for_shape(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    shape_id: &str,
) -> Vec<(String, serde_json::Value)> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in map.iter(&txn) {
        let obj = match &value {
            Out::YMap(inner) => {
                fo_yrs::from_yrs_map(inner, &txn).and_then(|o| serde_json::to_value(&o).ok())
            }
            _ => None,
        };
        if let Some(obj) = obj {
            // Check if this is a connector type
            let is_connector = obj.get("type").and_then(|v| v.as_str()) == Some("connector");
            if !is_connector {
                continue;
            }

            // Check startConnection.shapeId (may be string or number)
            let start_matches = obj
                .get("startConnection")
                .and_then(|c| c.get("shapeId"))
                .is_some_and(|v| match_shape_id(v, shape_id));

            // Check endConnection.shapeId (may be string or number)
            let end_matches = obj
                .get("endConnection")
                .and_then(|c| c.get("shapeId"))
                .is_some_and(|v| match_shape_id(v, shape_id));

            if start_matches || end_matches {
                result.push((key.to_string(), obj));
            }
        }
    }

    result
}

// =============================================================================
// Pixel-Bounds Computation
// =============================================================================

/// Compute absolute pixel bounds for a floating object from its anchor config
/// and the current LayoutIndex.
///
/// Returns `None` if `layout_index` is `None` (e.g., sheet not yet laid out).
///
/// Supports both JSON shapes:
/// - **Typed** (from `serde_json::to_value(&FloatingObject)`): nested `anchor` object
///   with `anchorRow`, `anchorCol`, `anchorRowOffset`, `anchorColOffset`, etc.
/// - **Legacy/flat**: top-level `anchorRow`, `anchorCol`, `xOffset`/`yOffset` keys.
///
/// For oneCell anchors: pixel position = layout_position(anchor) + offset; size from width/height.
/// For twoCell anchors: pixel position = layout_position(from_anchor) + offset;
///   size = layout_position(to_anchor) + to_offset - pixel_position.
/// For absolute anchors: returns bounds directly from the object's x/y/width/height fields.
pub fn compute_object_pixel_bounds(
    grid_index: Option<&GridIndex>,
    layout_index: Option<&LayoutIndex>,
    obj_json: &serde_json::Value,
) -> Option<FloatingObjectBounds> {
    let layout = layout_index?;

    // Support both nested (typed) and flat (legacy) JSON:
    // Typed: { "anchor": { "anchorMode": "oneCell", "anchorRow": 5, ... }, "width": 200, ... }
    // Flat:  { "anchorMode": "oneCell", "anchorRow": 5, "xOffset": 10, "width": 200, ... }
    let anchor_obj = obj_json.get("anchor");

    let anchor_mode = anchor_obj
        .and_then(|a| a.get("anchorMode"))
        .and_then(|v| v.as_str())
        .or_else(|| obj_json.get("anchorMode").and_then(|v| v.as_str()))
        .unwrap_or("oneCell");
    let rotation = obj_json
        .get("rotation")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    // Helper: read a field from nested anchor first, then fall back to top-level.
    let anchor_field = |key: &str| -> Option<f64> {
        anchor_obj
            .and_then(|a| a.get(key))
            .and_then(|v| v.as_f64())
            .or_else(|| obj_json.get(key).and_then(|v| v.as_f64()))
    };
    let anchor_field_aliased = |canonical: &str, legacy: &str| -> Option<f64> {
        anchor_field(canonical).or_else(|| anchor_field(legacy))
    };
    let _anchor_field_str = |key: &str| -> Option<&str> {
        anchor_obj
            .and_then(|a| a.get(key))
            .and_then(|v| v.as_str())
            .or_else(|| obj_json.get(key).and_then(|v| v.as_str()))
    };

    // Read col offset (anchorColOffsetEmu is persisted in EMUs; xOffset is legacy px input).
    let read_col_offset = || -> f64 {
        anchor_field_aliased(KEY_ANCHOR_COL_OFFSET_EMU, "anchorColOffset")
            .map(emu_to_px)
            .or_else(|| obj_json.get("xOffset").and_then(|v| v.as_f64()))
            .unwrap_or(0.0)
    };
    // Read row offset (anchorRowOffsetEmu is persisted in EMUs; yOffset is legacy px input).
    let read_row_offset = || -> f64 {
        anchor_field_aliased(KEY_ANCHOR_ROW_OFFSET_EMU, "anchorRowOffset")
            .map(emu_to_px)
            .or_else(|| obj_json.get("yOffset").and_then(|v| v.as_f64()))
            .unwrap_or(0.0)
    };

    /// Resolve anchor position from CellId or raw row/col, supporting both nested and flat JSON.
    fn resolve_anchor_pos(
        grid_index: Option<&GridIndex>,
        obj_json: &serde_json::Value,
        anchor_obj: Option<&serde_json::Value>,
        cell_id_key: &str,
        row_key: &str,
        col_key: &str,
    ) -> (usize, usize) {
        // Try CellId resolution first (top-level or nested)
        let cell_id_hex = obj_json
            .get(cell_id_key)
            .and_then(|v| v.as_str())
            .or_else(|| {
                anchor_obj
                    .and_then(|a| a.get(cell_id_key))
                    .and_then(|v| v.as_str())
            });
        if let (Some(grid), Some(hex)) = (grid_index, cell_id_hex)
            && let Some(raw_id) = hex_to_id(hex)
        {
            let cell_id = CellId::from_raw(raw_id);
            if let Some((row, col)) = grid.cell_position(&cell_id) {
                return (row as usize, col as usize);
            }
        }
        // Fall back to raw indices (nested anchor first, then top-level)
        let row = anchor_obj
            .and_then(|a| a.get(row_key))
            .and_then(|v| v.as_u64())
            .or_else(|| obj_json.get(row_key).and_then(|v| v.as_u64()))
            .unwrap_or(0) as usize;
        let col = anchor_obj
            .and_then(|a| a.get(col_key))
            .and_then(|v| v.as_u64())
            .or_else(|| obj_json.get(col_key).and_then(|v| v.as_u64()))
            .unwrap_or(0) as usize;
        (row, col)
    }

    match anchor_mode {
        "absolute" => {
            // Absolute anchors: x/y are already pixel coordinates
            let x = obj_json.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = obj_json.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let width = obj_json
                .get("width")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let height = obj_json
                .get("height")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            // All coordinates derive from layout/yrs storage which uses
            // pixel/CharWidth values that stay finite by construction.
            // `FiniteF64::must` documents the storage invariant.
            Some(FloatingObjectBounds {
                x: value_types::FiniteF64::must(x),
                y: value_types::FiniteF64::must(y),
                width: value_types::FiniteF64::must(width),
                height: value_types::FiniteF64::must(height),
                rotation: value_types::FiniteF64::must(rotation),
            })
        }
        "twoCell" => {
            // From anchor — resolve via CellId if available
            let (anchor_row, anchor_col) = resolve_anchor_pos(
                grid_index,
                obj_json,
                anchor_obj,
                "anchorCellId",
                "anchorRow",
                "anchorCol",
            );
            let col_offset = read_col_offset();
            let row_offset = read_row_offset();

            // To anchor — resolve via CellId if available
            let (to_row, to_col) = resolve_anchor_pos(
                grid_index,
                obj_json,
                anchor_obj,
                "toAnchorCellId",
                "endRow",
                "endCol",
            );
            let to_col_offset = anchor_field_aliased(KEY_END_COL_OFFSET_EMU, "endColOffset")
                .map(emu_to_px)
                .or_else(|| obj_json.get("toXOffset").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            let to_row_offset = anchor_field_aliased(KEY_END_ROW_OFFSET_EMU, "endRowOffset")
                .map(emu_to_px)
                .or_else(|| obj_json.get("toYOffset").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);

            let from_x = layout.get_col_position(anchor_col).0 + col_offset;
            let from_y = layout.get_row_position(anchor_row).0 + row_offset;
            let to_x = layout.get_col_position(to_col).0 + to_col_offset;
            let to_y = layout.get_row_position(to_row).0 + to_row_offset;

            Some(FloatingObjectBounds {
                x: value_types::FiniteF64::must(from_x),
                y: value_types::FiniteF64::must(from_y),
                width: value_types::FiniteF64::must((to_x - from_x).abs()),
                height: value_types::FiniteF64::must((to_y - from_y).abs()),
                rotation: value_types::FiniteF64::must(rotation),
            })
        }
        _ => {
            // oneCell (default): position from anchor + offset, explicit width/height
            // Resolve via CellId if available
            let (anchor_row, anchor_col) = resolve_anchor_pos(
                grid_index,
                obj_json,
                anchor_obj,
                "anchorCellId",
                "anchorRow",
                "anchorCol",
            );
            let col_offset = read_col_offset();
            let row_offset = read_row_offset();
            let width = anchor_field_aliased(KEY_EXTENT_CX_EMU, "extentCx")
                .map(emu_to_px)
                .or_else(|| obj_json.get("width").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            let height = anchor_field_aliased(KEY_EXTENT_CY_EMU, "extentCy")
                .map(emu_to_px)
                .or_else(|| obj_json.get("height").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);

            let x = layout.get_col_position(anchor_col).0 + col_offset;
            let y = layout.get_row_position(anchor_row).0 + row_offset;

            Some(FloatingObjectBounds {
                x: value_types::FiniteF64::must(x),
                y: value_types::FiniteF64::must(y),
                width: value_types::FiniteF64::must(width),
                height: value_types::FiniteF64::must(height),
                rotation: value_types::FiniteF64::must(rotation),
            })
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use yrs::ReadTxn;
    use yrs::updates::decoder::Decode;

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn storage_with_sheet() -> (YrsStorage, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");
        (storage, sheet_id)
    }

    fn basic_object_config() -> serde_json::Value {
        serde_json::json!({
            "type": "shape",
            "shapeType": "rect",
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffset": 0,
            "anchorColOffset": 0,
            "anchorMode": "oneCell",
            "width": 300.0,
            "height": 400.0,
            "visible": true,
            "printable": true,
            "flipH": false,
            "flipV": false,
            "opacity": 1.0,
            "rotation": 0.0
        })
    }

    #[test]
    fn test_compute_object_pixel_bounds_projects_emu_anchor_units() {
        let layout = LayoutIndex::with_defaults(
            10,
            10,
            domain_types::units::Pixels(20.0),
            domain_types::units::Pixels(64.0),
        );
        let obj = serde_json::json!({
            "anchor": {
                "anchorMode": "oneCell",
                "anchorRow": 2,
                "anchorCol": 3,
                "anchorRowOffsetEmu": 5 * 9525,
                "anchorColOffsetEmu": 7 * 9525,
                "extentCxEmu": 88 * 9525,
                "extentCyEmu": 44 * 9525
            },
            "rotation": 15
        });

        let bounds = compute_object_pixel_bounds(None, Some(&layout), &obj).unwrap();

        assert_eq!(bounds.x.get(), 3.0 * 64.0 + 7.0);
        assert_eq!(bounds.y.get(), 2.0 * 20.0 + 5.0);
        assert_eq!(bounds.width.get(), 88.0);
        assert_eq!(bounds.height.get(), 44.0);
        assert_eq!(bounds.rotation.get(), 15.0);
    }

    #[test]
    fn test_compute_object_pixel_bounds_projects_two_cell_emu_offsets() {
        let layout = LayoutIndex::with_defaults(
            10,
            10,
            domain_types::units::Pixels(20.0),
            domain_types::units::Pixels(64.0),
        );
        let obj = serde_json::json!({
            "anchor": {
                "anchorMode": "twoCell",
                "anchorRow": 1,
                "anchorCol": 1,
                "anchorRowOffsetEmu": 3 * 9525,
                "anchorColOffsetEmu": 4 * 9525,
                "endRow": 4,
                "endCol": 3,
                "endRowOffsetEmu": 9 * 9525,
                "endColOffsetEmu": 12 * 9525
            }
        });

        let bounds = compute_object_pixel_bounds(None, Some(&layout), &obj).unwrap();

        assert_eq!(bounds.x.get(), 68.0);
        assert_eq!(bounds.y.get(), 23.0);
        assert_eq!(bounds.width.get(), 136.0);
        assert_eq!(bounds.height.get(), 66.0);
    }

    // -------------------------------------------------------------------
    // Floating Object CRUD (opaque JSON API)
    // -------------------------------------------------------------------

    #[test]
    fn test_set_and_get_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let json = serde_json::json!({
            "type": "picture",
            "x": 100,
            "y": 200,
            "width": 300,
            "height": 400
        });

        set_floating_object(doc, sheets, &sheet_id, "obj-1", &json).expect("set should succeed");

        let result = get_floating_object(doc, sheets, &sheet_id, "obj-1");
        assert!(result.is_some());
        let val = result.unwrap();
        assert_eq!(val["type"], "picture");
        assert_eq!(val["width"], 300);
    }

    #[test]
    fn test_get_nonexistent_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        assert!(get_floating_object(doc, sheets, &sheet_id, "nope").is_none());
    }

    #[test]
    fn test_get_all_floating_objects() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        set_floating_object(
            doc,
            sheets,
            &sheet_id,
            "obj-1",
            &serde_json::json!({"type": "shape"}),
        )
        .unwrap();
        set_floating_object(
            doc,
            sheets,
            &sheet_id,
            "obj-2",
            &serde_json::json!({"type": "textbox"}),
        )
        .unwrap();

        let all = get_all_floating_objects(doc, sheets, &sheet_id);
        assert_eq!(all.len(), 2);
        let ids: Vec<&str> = all.iter().map(|(id, _)| id.as_str()).collect();
        assert!(ids.contains(&"obj-1"));
        assert!(ids.contains(&"obj-2"));
    }

    #[test]
    fn test_get_all_floating_objects_empty() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        assert!(get_all_floating_objects(doc, sheets, &sheet_id).is_empty());
    }

    #[test]
    fn test_delete_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        set_floating_object(
            doc,
            sheets,
            &sheet_id,
            "obj-1",
            &serde_json::json!({"type": "chart"}),
        )
        .unwrap();
        assert!(get_floating_object(doc, sheets, &sheet_id, "obj-1").is_some());

        let deleted = delete_floating_object(doc, sheets, &sheet_id, "obj-1");
        assert!(deleted);
        assert!(get_floating_object(doc, sheets, &sheet_id, "obj-1").is_none());
    }

    #[test]
    fn test_delete_nonexistent_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        assert!(!delete_floating_object(doc, sheets, &sheet_id, "nope"));
    }

    #[test]
    fn test_overwrite_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        set_floating_object(
            doc,
            sheets,
            &sheet_id,
            "obj-1",
            &serde_json::json!({"width": 100}),
        )
        .unwrap();
        set_floating_object(
            doc,
            sheets,
            &sheet_id,
            "obj-1",
            &serde_json::json!({"width": 999}),
        )
        .unwrap();

        let val = get_floating_object(doc, sheets, &sheet_id, "obj-1").unwrap();
        assert_eq!(val["width"], 999);
    }

    #[test]
    fn test_floating_object_nonexistent_sheet() {
        let (storage, _) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let fake = make_sheet_id(999);
        assert!(set_floating_object(doc, sheets, &fake, "obj-1", &serde_json::json!({})).is_err());
        assert!(get_floating_object(doc, sheets, &fake, "obj-1").is_none());
        assert!(get_all_floating_objects(doc, sheets, &fake).is_empty());
        assert!(!delete_floating_object(doc, sheets, &fake, "obj-1"));
    }

    // -------------------------------------------------------------------
    // Typed Floating Object CRUD
    // -------------------------------------------------------------------

    #[test]
    fn test_create_floating_object_and_get_typed() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let object_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("create should succeed");
        assert!(object_id.starts_with("fobj-"));

        let obj = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
        assert_eq!(obj.common.id, object_id);
        assert_eq!(obj.common.width, 300.0);
        assert_eq!(obj.common.height, 400.0);
        assert!(obj.common.created_at != 0);
        assert!(obj.common.updated_at != 0);
    }

    #[test]
    fn test_create_floating_object_z_index_auto_increment() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id3 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let o1 = get_floating_object_typed(doc, sheets, &sheet_id, &id1).unwrap();
        let o2 = get_floating_object_typed(doc, sheets, &sheet_id, &id2).unwrap();
        let o3 = get_floating_object_typed(doc, sheets, &sheet_id, &id3).unwrap();
        assert!(o1.common.z_index < o2.common.z_index);
        assert!(o2.common.z_index < o3.common.z_index);
    }

    #[test]
    fn test_update_floating_object_typed() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let object_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let original = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
        let original_updated_at = original.common.updated_at;

        let updates = serde_json::json!({ "width": 999.0, "height": 888.0 });
        let updated = update_floating_object(doc, sheets, &sheet_id, &object_id, &updates);
        assert!(updated);

        let obj = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
        assert_eq!(obj.common.width, 999.0);
        assert_eq!(obj.common.height, 888.0);
        assert!(obj.common.updated_at >= original_updated_at);
    }

    #[test]
    fn test_update_nonexistent_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let updates = serde_json::json!({ "width": 999 });
        assert!(!update_floating_object(
            doc,
            sheets,
            &sheet_id,
            "nonexistent",
            &updates
        ));
    }

    #[test]
    fn test_get_all_floating_objects_typed() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let mut pic_config = basic_object_config();
        pic_config["type"] = serde_json::json!("picture");
        pic_config["src"] = serde_json::json!("http://img.png");
        pic_config.as_object_mut().unwrap().remove("shapeType");
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &pic_config,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let all = get_all_floating_objects_typed(doc, sheets, &sheet_id);
        assert_eq!(all.len(), 2);
        let ids: Vec<&str> = all.iter().map(|o| o.common.id.as_str()).collect();
        assert!(ids.contains(&id1.as_str()));
        assert!(ids.contains(&id2.as_str()));
    }

    #[test]
    fn test_create_floating_object_nonexistent_sheet() {
        let (storage, _) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let fake = make_sheet_id(999);
        let result = create_floating_object(
            doc,
            sheets,
            &fake,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
        match result.unwrap_err() {
            ComputeError::SheetNotFound { .. } => {}
            other => panic!("Expected SheetNotFound, got {:?}", other),
        }
    }

    // -------------------------------------------------------------------
    // Z-Order Operations
    // -------------------------------------------------------------------

    #[test]
    fn test_z_index_empty_sheet() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        assert_eq!(get_floating_object_max_z_index(doc, sheets, &sheet_id), 0);
        assert_eq!(get_floating_object_min_z_index(doc, sheets, &sheet_id), 0);
    }

    #[test]
    fn test_bring_floating_object_to_front() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id3 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        bring_floating_object_to_front(doc, sheets, &sheet_id, &id1);
        let o1 = get_floating_object_typed(doc, sheets, &sheet_id, &id1).unwrap();
        let o2 = get_floating_object_typed(doc, sheets, &sheet_id, &id2).unwrap();
        let o3 = get_floating_object_typed(doc, sheets, &sheet_id, &id3).unwrap();
        assert!(o1.common.z_index > o2.common.z_index);
        assert!(o1.common.z_index > o3.common.z_index);
    }

    #[test]
    fn test_send_floating_object_to_back() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id3 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        send_floating_object_to_back(doc, sheets, &sheet_id, &id3);
        let o1 = get_floating_object_typed(doc, sheets, &sheet_id, &id1).unwrap();
        let o2 = get_floating_object_typed(doc, sheets, &sheet_id, &id2).unwrap();
        let o3 = get_floating_object_typed(doc, sheets, &sheet_id, &id3).unwrap();
        assert!(o3.common.z_index < o1.common.z_index);
        assert!(o3.common.z_index < o2.common.z_index);
    }

    #[test]
    fn test_bring_floating_object_forward() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _id3 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let z1_before = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
            .unwrap()
            .common
            .z_index;
        let z2_before = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
            .unwrap()
            .common
            .z_index;
        bring_floating_object_forward(doc, sheets, &sheet_id, &id1);
        let z1_after = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
            .unwrap()
            .common
            .z_index;
        let z2_after = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
            .unwrap()
            .common
            .z_index;
        assert_eq!(z1_after, z2_before);
        assert_eq!(z2_after, z1_before);
    }

    #[test]
    fn test_send_floating_object_backward() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _id3 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let z1_before = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
            .unwrap()
            .common
            .z_index;
        let z2_before = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
            .unwrap()
            .common
            .z_index;
        send_floating_object_backward(doc, sheets, &sheet_id, &id2);
        let z1_after = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
            .unwrap()
            .common
            .z_index;
        let z2_after = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
            .unwrap()
            .common
            .z_index;
        assert_eq!(z2_after, z1_before);
        assert_eq!(z1_after, z2_before);
    }

    #[test]
    fn test_bring_forward_at_top_is_noop() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let _id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let z2_before = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
            .unwrap()
            .common
            .z_index;
        bring_floating_object_forward(doc, sheets, &sheet_id, &id2);
        let z2_after = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
            .unwrap()
            .common
            .z_index;
        assert_eq!(z2_before, z2_after);
    }

    #[test]
    fn test_send_backward_at_bottom_is_noop() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let z1_before = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
            .unwrap()
            .common
            .z_index;
        send_floating_object_backward(doc, sheets, &sheet_id, &id1);
        let z1_after = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
            .unwrap()
            .common
            .z_index;
        assert_eq!(z1_before, z1_after);
    }

    #[test]
    fn test_get_floating_objects_in_z_order() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id3 = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        send_floating_object_to_back(doc, sheets, &sheet_id, &id3);
        let ordered = get_floating_objects_in_z_order(doc, sheets, &sheet_id);
        assert_eq!(ordered.len(), 3);
        assert_eq!(ordered[0].common.id, id3);
        assert_eq!(ordered[1].common.id, id1);
        assert_eq!(ordered[2].common.id, id2);
    }

    // -------------------------------------------------------------------
    // Floating Object Group CRUD (opaque JSON API)
    // -------------------------------------------------------------------

    #[test]
    fn test_set_and_get_floating_object_group() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let json = serde_json::json!({
            "children": ["obj-1", "obj-2"],
            "x": 50,
            "y": 50
        });

        set_floating_object_group(doc, sheets, &sheet_id, "grp-1", &json)
            .expect("set should succeed");

        let result = get_floating_object_group(doc, sheets, &sheet_id, "grp-1");
        assert!(result.is_some());
        let val = result.unwrap();
        assert_eq!(val["children"][0], "obj-1");
    }

    #[test]
    fn test_get_all_floating_object_groups() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        set_floating_object_group(
            doc,
            sheets,
            &sheet_id,
            "grp-1",
            &serde_json::json!({"a": 1}),
        )
        .unwrap();
        set_floating_object_group(
            doc,
            sheets,
            &sheet_id,
            "grp-2",
            &serde_json::json!({"b": 2}),
        )
        .unwrap();

        let all = get_all_floating_object_groups(doc, sheets, &sheet_id);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_delete_floating_object_group() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        set_floating_object_group(doc, sheets, &sheet_id, "grp-1", &serde_json::json!({})).unwrap();
        assert!(delete_floating_object_group(
            doc, sheets, &sheet_id, "grp-1"
        ));
        assert!(get_floating_object_group(doc, sheets, &sheet_id, "grp-1").is_none());
    }

    #[test]
    fn test_delete_nonexistent_floating_object_group() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        assert!(!delete_floating_object_group(
            doc, sheets, &sheet_id, "nope"
        ));
    }

    // -------------------------------------------------------------------
    // Typed Floating Object Group CRUD
    // -------------------------------------------------------------------

    #[test]
    fn test_create_floating_object_group_typed() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let config = serde_json::json!({
            "children": ["obj-a", "obj-b"],
            "x": 10.0,
            "y": 20.0,
            "width": 200.0,
            "height": 150.0
        });
        let group_id = create_floating_object_group(
            doc,
            sheets,
            &sheet_id,
            &config,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("create group should succeed");
        assert!(group_id.starts_with("grp-"));

        let grp = get_floating_object_group_typed(doc, sheets, &sheet_id, &group_id).unwrap();
        assert_eq!(grp.id, group_id);
        assert_eq!(grp.children, vec!["obj-a", "obj-b"]);
        assert_eq!(grp.x, Some(value_types::FiniteF64::must(10.0)));
        assert_eq!(grp.y, Some(value_types::FiniteF64::must(20.0)));
        assert_eq!(grp.width, Some(value_types::FiniteF64::must(200.0)));
        assert_eq!(grp.height, Some(value_types::FiniteF64::must(150.0)));
    }

    #[test]
    fn test_update_floating_object_group_typed() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let config = serde_json::json!({ "children": ["obj-a"], "x": 10.0 });
        let group_id = create_floating_object_group(
            doc,
            sheets,
            &sheet_id,
            &config,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let updates = serde_json::json!({ "x": 99.0, "width": 500.0 });
        let updated = update_floating_object_group(doc, sheets, &sheet_id, &group_id, &updates);
        assert!(updated);

        let grp = get_floating_object_group_typed(doc, sheets, &sheet_id, &group_id).unwrap();
        assert_eq!(grp.x, Some(value_types::FiniteF64::must(99.0)));
        assert_eq!(grp.width, Some(value_types::FiniteF64::must(500.0)));
        assert_eq!(grp.children, vec!["obj-a"]); // untouched
    }

    #[test]
    fn test_get_all_floating_object_groups_typed() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let id1 = create_floating_object_group(
            doc,
            sheets,
            &sheet_id,
            &serde_json::json!({"children": []}),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let id2 = create_floating_object_group(
            doc,
            sheets,
            &sheet_id,
            &serde_json::json!({"children": []}),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let all = get_all_floating_object_groups_typed(doc, sheets, &sheet_id);
        assert_eq!(all.len(), 2);
        let ids: Vec<&str> = all.iter().map(|g| g.id.as_str()).collect();
        assert!(ids.contains(&id1.as_str()));
        assert!(ids.contains(&id2.as_str()));
    }

    #[test]
    fn test_create_floating_object_group_nonexistent_sheet() {
        let (storage, _) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let fake = make_sheet_id(999);
        let result = create_floating_object_group(
            doc,
            sheets,
            &fake,
            &serde_json::json!({"children": []}),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Unified Z-Order (Charts as Floating Objects)
    // -------------------------------------------------------------------

    #[test]
    fn test_unified_z_order_interleave() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Create chart as a floating object
        let chart_config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
        let chart_json = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &chart_config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let chart_id = chart_json["id"].as_str().unwrap().to_string();

        // Create shape floating object
        let obj_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let entries = get_all_in_z_order(doc, sheets, &sheet_id);
        assert_eq!(entries.len(), 2);

        // Both should be present
        let has_chart = entries
            .iter()
            .any(|e| matches!(e, ZOrderEntry::Chart { id, .. } if id == &chart_id));
        let has_obj = entries
            .iter()
            .any(|e| matches!(e, ZOrderEntry::FloatingObject { id, .. } if id == &obj_id));
        assert!(has_chart);
        assert!(has_obj);

        // They should be sorted by z_index
        let z_indices: Vec<i32> = entries
            .iter()
            .map(|e| match e {
                ZOrderEntry::Chart { z_index, .. } => *z_index,
                ZOrderEntry::FloatingObject { z_index, .. } => *z_index,
            })
            .collect();
        for i in 1..z_indices.len() {
            assert!(z_indices[i] >= z_indices[i - 1]);
        }
    }

    #[test]
    fn test_unified_max_min_z_index() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Empty sheet
        assert_eq!(get_max_z_index_all(doc, sheets, &sheet_id), 0);
        assert_eq!(get_min_z_index_all(doc, sheets, &sheet_id), 0);

        // Add chart (as floating object) and shape floating object
        let chart_config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
        let _chart_json = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &chart_config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let _obj_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let max_z = get_max_z_index_all(doc, sheets, &sheet_id);
        let min_z = get_min_z_index_all(doc, sheets, &sheet_id);
        assert!(max_z >= min_z);
        assert!(max_z >= 0);
    }

    // -------------------------------------------------------------------
    // Chart as Floating Object — CRUD
    // -------------------------------------------------------------------

    #[test]
    fn test_create_chart_object_basic() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let config = serde_json::json!({
            "chartType": "bar",
            "anchorRow": 2,
            "anchorCol": 3,
            "width": 500,
            "height": 400,
            "dataRange": "A1:D10",
            "series": [{"name": "Revenue"}]
        });
        let obj = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(obj["type"], "chart");
        assert_eq!(obj["chartType"], "bar");
        assert_eq!(obj["anchor"]["anchorRow"].as_i64(), Some(2));
        assert_eq!(obj["anchor"]["anchorCol"].as_i64(), Some(3));
        assert_eq!(obj["width"].as_f64(), Some(500.0));
        assert_eq!(obj["height"].as_f64(), Some(400.0));
        assert!(obj["id"].as_str().is_some());
        assert!(obj["zIndex"].as_i64().is_some());
        // Domain data should be at top level (no chartConfig sub-object)
        assert_eq!(obj["dataRange"], "A1:D10");
        assert_eq!(obj["series"][0]["name"], "Revenue");
        assert!(
            obj.get("chartConfig").is_none(),
            "chartConfig sub-object should not exist"
        );
    }

    #[test]
    fn test_chart_z_index_unified_with_shapes() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Create a shape first
        let _shape_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let shape_z = get_floating_object_max_z_index(doc, sheets, &sheet_id);

        // Create a chart — should get a higher z-index
        let chart_config = serde_json::json!({ "chartType": "line", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
        let chart_obj = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &chart_config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let chart_z = chart_obj["zIndex"].as_i64().unwrap() as i32;
        assert!(chart_z > shape_z);
    }

    #[test]
    fn test_get_chart_objects() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Create a shape and a chart
        let _shape_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &basic_object_config(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let chart_config = serde_json::json!({ "chartType": "pie", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
        let _chart_obj = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &chart_config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // get_chart_objects should only return charts, not shapes
        let charts = get_chart_objects(doc, sheets, &sheet_id);
        assert_eq!(charts.len(), 1);
        assert_eq!(charts[0]["type"], "chart");
        assert_eq!(charts[0]["chartType"], "pie");
    }

    #[test]
    fn test_get_charts_linked_to_table_query() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Create two charts, one linked to a table
        let config1 = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300, "sourceTableId": "table-A" });
        let _c1 = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &config1,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let config2 = serde_json::json!({ "chartType": "line", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
        let _c2 = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &config2,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let linked = get_charts_linked_to_table(doc, sheets, &sheet_id, "table-A");
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0]["chartType"], "bar");

        let linked_b = get_charts_linked_to_table(doc, sheets, &sheet_id, "table-B");
        assert!(linked_b.is_empty());
    }

    #[test]
    fn test_delete_chart_floating_object() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
        let chart_obj = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let chart_id = chart_obj["id"].as_str().unwrap();

        assert!(get_floating_object(doc, sheets, &sheet_id, chart_id).is_some());
        let deleted = delete_floating_object(doc, sheets, &sheet_id, chart_id);
        assert!(deleted);
        assert!(get_floating_object(doc, sheets, &sheet_id, chart_id).is_none());
    }

    #[test]
    fn test_update_chart_config() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300, "dataRange": "A1:B5" });
        let chart_obj = create_chart_object(
            doc,
            sheets,
            &sheet_id,
            &config,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let chart_id = chart_obj["id"].as_str().unwrap();

        // Update chart fields directly as individual top-level keys
        let updates = serde_json::json!({ "dataRange": "A1:C10", "legend": {"show": true} });
        let updated = update_floating_object(doc, sheets, &sheet_id, chart_id, &updates);
        assert!(updated);

        let obj = get_floating_object(doc, sheets, &sheet_id, chart_id).unwrap();
        assert_eq!(obj["dataRange"], "A1:C10");
        assert_eq!(obj["legend"]["show"], true);
    }

    // -------------------------------------------------------------------
    // Cross-API: opaque set, typed get
    // -------------------------------------------------------------------

    #[test]
    fn test_opaque_set_typed_get() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Store via opaque JSON API with all required fields
        let json = serde_json::json!({
            "id": "obj-opaque",
            "sheetId": "whatever",
            "type": "shape",
            "shapeType": "rect",
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffset": 0,
            "anchorColOffset": 0,
            "anchorMode": "oneCell",
            "width": 200.0,
            "height": 100.0,
            "zIndex": 5,
            "rotation": 0.0,
            "flipH": false,
            "flipV": false,
            "locked": false,
            "visible": true,
            "printable": true,
            "opacity": 1.0,
            "name": "",
            "createdAt": 0,
            "updatedAt": 0
        });
        set_floating_object(doc, sheets, &sheet_id, "obj-opaque", &json).unwrap();

        // Read via typed API
        let obj = get_floating_object_typed(doc, sheets, &sheet_id, "obj-opaque").unwrap();
        assert_eq!(obj.common.id, "obj-opaque");
        assert_eq!(obj.common.width, 200.0);
        assert_eq!(obj.common.height, 100.0);
        assert_eq!(obj.common.z_index, 5);
    }

    #[test]
    fn test_shape_fill_preserved() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let mut config = basic_object_config();
        config["fill"] = serde_json::json!({ "type": "solid", "color": "#ff0000" });
        let object_id = create_floating_object(
            doc,
            sheets,
            &sheet_id,
            &config,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        let obj = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
        if let FloatingObjectData::Shape(shape) = &obj.data {
            let fill = shape.fill.as_ref().expect("fill should be present");
            assert_eq!(fill.color.as_deref(), Some("#ff0000"));
        } else {
            panic!("Expected Shape data");
        }
    }

    // -------------------------------------------------------------------
    // Structured CRDT Storage
    // -------------------------------------------------------------------

    /// Helper: get the floatingObjects sub-map for a sheet, creating a txn internally.
    fn get_fo_map_for_sheet(storage: &YrsStorage, sheet_id: &SheetId) -> (Doc, MapRef) {
        // We need direct access to the map for low-level structured tests.
        // Clone the doc reference and get the sheets map.
        let doc = storage.doc().clone();
        let sheets = storage.sheets().clone();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let txn = doc.transact();
        let map = get_sheet_submap(
            &txn,
            &sheets,
            &sheet_hex,
            compute_document::schema::KEY_FLOATING_OBJECTS,
        )
        .expect("floatingObjects map should exist");
        drop(txn);
        (doc, map)
    }

    #[test]
    fn test_json_value_to_any_number() {
        let val = serde_json::json!(42.5);
        let any = json_value_to_any(&val);
        match any {
            Any::Number(n) => assert_eq!(n, 42.5),
            other => panic!("Expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn test_json_value_to_any_string() {
        let val = serde_json::json!("shape");
        let any = json_value_to_any(&val);
        match any {
            Any::String(s) => assert_eq!(&*s, "shape"),
            other => panic!("Expected Any::String, got {:?}", other),
        }
    }

    #[test]
    fn test_json_value_to_any_bool() {
        let val = serde_json::json!(true);
        let any = json_value_to_any(&val);
        match any {
            Any::Bool(b) => assert!(b),
            other => panic!("Expected Any::Bool, got {:?}", other),
        }
    }

    #[test]
    fn test_json_value_to_any_null() {
        let val = serde_json::Value::Null;
        let any = json_value_to_any(&val);
        assert!(matches!(any, Any::Null));
    }

    #[test]
    fn test_json_value_to_any_object() {
        let val = serde_json::json!({"color": "#ff0000", "opacity": 0.8});
        let any = json_value_to_any(&val);
        match any {
            Any::String(s) => {
                let parsed: serde_json::Value = serde_json::from_str(&s).unwrap();
                assert_eq!(parsed["color"], "#ff0000");
                assert_eq!(parsed["opacity"], 0.8);
            }
            other => panic!("Expected Any::String (JSON), got {:?}", other),
        }
    }

    #[test]
    fn test_write_and_read_object_via_unified_schema() {
        let (storage, sheet_id) = storage_with_sheet();
        let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

        let json = serde_json::json!({
            "id": "obj-structured-1",
            "sheetId": "abc",
            "type": "shape",
            "shapeType": "rect",
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffset": 0,
            "anchorColOffset": 0,
            "anchorMode": "oneCell",
            "width": 100.0,
            "height": 50.0,
            "locked": false,
            "visible": true,
            "printable": true,
            "flipH": false,
            "flipV": false,
            "opacity": 1.0,
            "rotation": 0.0,
            "zIndex": 3,
            "name": "Shape 1",
            "createdAt": 0,
            "updatedAt": 0,
            "fill": {"color": "#00ff00", "type": "solid"}
        });

        // Write via unified schema
        {
            let mut txn = doc.transact_mut();
            write_object_from_json(&mut txn, &map, "obj-structured-1", &json);
        }

        // Read back via unified schema reader
        {
            let txn = doc.transact();
            let result = read_object_structured(&txn, &map, "obj-structured-1");
            assert!(result.is_some());
            let obj = result.unwrap();
            assert_eq!(obj.common.id, "obj-structured-1");
            assert_eq!(obj.object_type(), "shape");
            assert_eq!(obj.common.width, 100.0);
            assert_eq!(obj.common.height, 50.0);
            assert!(!obj.common.locked);
            assert_eq!(obj.common.z_index, 3);
        }
    }

    #[test]
    fn test_read_object_structured_nonexistent() {
        let (storage, sheet_id) = storage_with_sheet();
        let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);
        let txn = doc.transact();
        assert!(read_object_structured(&txn, &map, "does-not-exist").is_none());
    }

    #[test]
    fn test_read_all_typed_multiple_entries() {
        let (storage, sheet_id) = storage_with_sheet();
        let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

        {
            let mut txn = doc.transact_mut();

            let obj1 = serde_json::json!({
                "id": "obj-1", "sheetId": "abc", "type": "shape", "shapeType": "rect",
                "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
                "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
                "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
                "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
            });
            write_object_from_json(&mut txn, &map, "obj-1", &obj1);

            let obj2 = serde_json::json!({
                "id": "obj-2", "sheetId": "abc", "type": "picture", "src": "http://img.png",
                "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
                "anchorMode": "oneCell", "width": 200.0, "height": 100.0,
                "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
                "opacity": 1.0, "rotation": 0.0, "zIndex": 1, "name": "", "createdAt": 0, "updatedAt": 0
            });
            write_object_from_json(&mut txn, &map, "obj-2", &obj2);
        }

        {
            let txn = doc.transact();
            let all = read_all_typed(&txn, &map);
            assert_eq!(all.len(), 2);
            let ids: Vec<&str> = all.iter().map(|o| o.common.id.as_str()).collect();
            assert!(ids.contains(&"obj-1"));
            assert!(ids.contains(&"obj-2"));
        }
    }

    #[test]
    fn test_read_all_entries_as_json_multiple() {
        let (storage, sheet_id) = storage_with_sheet();
        let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

        {
            let mut txn = doc.transact_mut();

            let obj1 = serde_json::json!({
                "id": "ent-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
                "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
                "anchorMode": "oneCell", "width": 10.0, "height": 10.0,
                "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
                "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
            });
            write_object_from_json(&mut txn, &map, "ent-1", &obj1);

            let obj2 = serde_json::json!({
                "id": "ent-2", "sheetId": "s", "type": "shape", "shapeType": "oval",
                "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
                "anchorMode": "oneCell", "width": 10.0, "height": 10.0,
                "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
                "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
            });
            write_object_from_json(&mut txn, &map, "ent-2", &obj2);
        }

        {
            let txn = doc.transact();
            let all = read_all_entries_as_json(&txn, &map);
            assert_eq!(all.len(), 2);
            let keys: Vec<&str> = all.iter().map(|(k, _)| k.as_str()).collect();
            assert!(keys.contains(&"ent-1"));
            assert!(keys.contains(&"ent-2"));
        }
    }

    #[test]
    fn test_update_object_fields_partial() {
        let (storage, sheet_id) = storage_with_sheet();
        let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

        // Create entry
        let json = serde_json::json!({
            "id": "obj-update-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
        });
        {
            let mut txn = doc.transact_mut();
            write_object_from_json(&mut txn, &map, "obj-update-1", &json);
        }

        // Partially update width and locked
        {
            let mut txn = doc.transact_mut();
            let inner = match map.get(&txn, "obj-update-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap, got {:?}", other),
            };
            update_object_fields(
                &mut txn,
                &inner,
                &[(FO_WIDTH, Any::Number(99.0)), (FO_LOCKED, Any::Bool(true))],
            );
        }

        // Verify partial update
        {
            let txn = doc.transact();
            let result = read_object_structured(&txn, &map, "obj-update-1").unwrap();
            assert_eq!(result.common.width, 99.0);
            assert!(result.common.locked);
            assert_eq!(result.common.height, 50.0); // untouched
        }
    }

    // -------------------------------------------------------------------
    // Concurrent Edit Integration Tests (CRDT merge behavior)
    // -------------------------------------------------------------------

    /// Sync all state from `src` into `dst`. Both docs end up with the same state.
    fn sync_docs(src: &Doc, dst: &Doc) {
        let sv = dst.transact().state_vector();
        let update = src.transact().encode_diff_v1(&sv);
        let decoded = yrs::Update::decode_v1(&update).expect("decode update");
        dst.transact_mut()
            .apply_update(decoded)
            .expect("apply update");
    }

    /// Create a second Doc that is an exact clone of `src`, and return it
    /// along with the floatingObjects MapRef (looked up by sheet_hex).
    fn fork_doc(src: &Doc, sheet_hex: &str) -> (Doc, MapRef) {
        let doc2 = Doc::new();

        // Full state sync from src → doc2
        let update = src.transact().encode_diff_v1(&yrs::StateVector::default());
        let decoded = yrs::Update::decode_v1(&update).expect("decode update");
        doc2.transact_mut()
            .apply_update(decoded)
            .expect("apply update");

        // Look up the floatingObjects map in doc2
        let sheets2 = doc2.get_or_insert_map(compute_document::schema::KEY_SHEETS);
        let txn = doc2.transact();
        let map2 = get_sheet_submap(&txn, &sheets2, sheet_hex, KEY_FLOATING_OBJECTS)
            .expect("floatingObjects map should exist in forked doc");
        drop(txn);
        (doc2, map2)
    }

    #[test]
    fn test_concurrent_edits_different_fields_merge_cleanly() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc1 = storage.doc();
        let sheets1 = storage.sheets();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

        let shape_json = serde_json::json!({
            "id": "obj-concurrent-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0,
            "fill": {"color": "#ff0000", "type": "solid"}
        });
        set_floating_object(doc1, sheets1, &sheet_id, "obj-concurrent-1", &shape_json).unwrap();

        let (doc2, map2) = fork_doc(doc1, &sheet_hex);

        // Doc1: change width
        {
            let fo_map =
                get_sheet_submap(&doc1.transact(), sheets1, &sheet_hex, KEY_FLOATING_OBJECTS)
                    .unwrap();
            let mut txn = doc1.transact_mut();
            let inner = match fo_map.get(&txn, "obj-concurrent-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap, got {:?}", other),
            };
            update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(99.0))]);
        }

        // Doc2: change fill
        {
            let mut txn = doc2.transact_mut();
            let inner = match map2.get(&txn, "obj-concurrent-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap in doc2, got {:?}", other),
            };
            let new_fill = serde_json::json!({"color": "#00ff00", "type": "solid"});
            let fill_any = json_value_to_any(&new_fill);
            update_object_fields(&mut txn, &inner, &[(FO_FILL, fill_any)]);
        }

        sync_docs(doc1, &doc2);
        sync_docs(&doc2, doc1);

        // Both changes present in doc1
        {
            let obj =
                get_floating_object_typed(doc1, sheets1, &sheet_id, "obj-concurrent-1").unwrap();
            assert_eq!(obj.common.width, 99.0);
            assert_eq!(obj.common.height, 50.0);
        }
    }

    #[test]
    fn test_concurrent_same_field_last_writer_wins() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc1 = storage.doc();
        let sheets1 = storage.sheets();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

        let shape_json = serde_json::json!({
            "id": "obj-lww-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
        });
        set_floating_object(doc1, sheets1, &sheet_id, "obj-lww-1", &shape_json).unwrap();

        let (doc2, map2) = fork_doc(doc1, &sheet_hex);

        // Doc1: set width = 111
        {
            let fo_map =
                get_sheet_submap(&doc1.transact(), sheets1, &sheet_hex, KEY_FLOATING_OBJECTS)
                    .unwrap();
            let mut txn = doc1.transact_mut();
            let inner = match fo_map.get(&txn, "obj-lww-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap, got {:?}", other),
            };
            update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(111.0))]);
        }

        // Doc2: set width = 222
        {
            let mut txn = doc2.transact_mut();
            let inner = match map2.get(&txn, "obj-lww-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap in doc2, got {:?}", other),
            };
            update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(222.0))]);
        }

        sync_docs(doc1, &doc2);
        sync_docs(&doc2, doc1);

        let val1 = get_floating_object_typed(doc1, sheets1, &sheet_id, "obj-lww-1")
            .unwrap()
            .common
            .width;
        let val2 = {
            let txn = doc2.transact();
            let obj = fo_yrs::from_yrs_map(
                &match map2.get(&txn, "obj-lww-1") {
                    Some(Out::YMap(m)) => m,
                    _ => panic!("expected ymap"),
                },
                &txn,
            )
            .unwrap();
            obj.common.width
        };

        assert_eq!(
            val1, val2,
            "Both docs should have the same LWW value for width"
        );
        assert!(
            val1 == 111.0 || val1 == 222.0,
            "width should be 111 or 222, got {}",
            val1
        );
    }

    #[test]
    fn test_concurrent_create_and_update() {
        let (storage, sheet_id) = storage_with_sheet();
        let doc1 = storage.doc();
        let sheets1 = storage.sheets();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

        let shape_json = serde_json::json!({
            "id": "obj-create-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
        });
        set_floating_object(doc1, sheets1, &sheet_id, "obj-create-1", &shape_json).unwrap();

        let (doc2, map2) = fork_doc(doc1, &sheet_hex);

        // Doc2: update width
        {
            let mut txn = doc2.transact_mut();
            let inner = match map2.get(&txn, "obj-create-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap in doc2, got {:?}", other),
            };
            update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(999.0))]);
        }

        // Doc1: update height
        {
            let fo_map =
                get_sheet_submap(&doc1.transact(), sheets1, &sheet_hex, KEY_FLOATING_OBJECTS)
                    .unwrap();
            let mut txn = doc1.transact_mut();
            let inner = match fo_map.get(&txn, "obj-create-1") {
                Some(Out::YMap(m)) => m,
                other => panic!("Expected YMap, got {:?}", other),
            };
            update_object_fields(&mut txn, &inner, &[(FO_HEIGHT, Any::Number(777.0))]);
        }

        sync_docs(doc1, &doc2);
        sync_docs(&doc2, doc1);

        let obj = get_floating_object_typed(doc1, sheets1, &sheet_id, "obj-create-1").unwrap();
        assert_eq!(obj.object_type(), "shape");
        assert_eq!(obj.common.width, 999.0);
        assert_eq!(obj.common.height, 777.0);
    }
}

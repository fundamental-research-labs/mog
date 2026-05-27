use std::sync::Arc;

use crate::engine_types::floating_objects::SerializedFloatingObjectGroup;
use domain_types::domain::floating_object::FloatingObject;
use domain_types::yrs_schema::floating_object as fo_yrs;
use yrs::{Any, Map, MapPrelim, MapRef, Out};

use super::keys::*;

pub(super) fn read_object_structured(
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
pub(super) fn read_object_as_json(
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
pub(super) fn read_all_typed<T: yrs::ReadTxn>(txn: &T, map: &MapRef) -> Vec<FloatingObject> {
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
pub(super) fn read_all_entries_as_json<T: yrs::ReadTxn>(
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
pub(super) fn read_object_for_update(
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
pub(super) fn read_raw_map_for_update(
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
pub(super) fn out_to_json_value(out: &Out) -> Option<serde_json::Value> {
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
pub(super) fn json_value_to_any(value: &serde_json::Value) -> Any {
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
pub(super) fn read_group_typed_from_ymap(
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
pub(super) fn write_object_typed(
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
pub(super) fn write_object_from_json(
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
pub(super) fn update_object_fields(
    txn: &mut yrs::TransactionMut,
    inner: &MapRef,
    updates: &[(&str, Any)],
) {
    for (key, value) in updates {
        inner.insert(txn, *key, value.clone());
    }
}

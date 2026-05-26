//! Shared Yrs read/write helpers — following the cell_serde.rs pattern.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

// Re-export serde_json for downstream yrs_schema modules that use json_any / read_json.
pub use serde_json;

/// Read a String value from a Y.Map.
pub fn read_string<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key)? {
        yrs::Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

/// Read an f64 value from a Y.Map.
pub fn read_number<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<f64> {
    match map.get(txn, key)? {
        yrs::Out::Any(Any::Number(n)) => Some(n),
        _ => None,
    }
}

/// Read a bool value from a Y.Map.
pub fn read_bool<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<bool> {
    match map.get(txn, key)? {
        yrs::Out::Any(Any::Bool(b)) => Some(b),
        _ => None,
    }
}

/// Read a u32 value from a Y.Map (stored as f64).
pub fn read_u32<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<u32> {
    read_number(map, txn, key).map(|n| n as u32)
}

/// Read an i32 value from a Y.Map (stored as f64).
pub fn read_i32<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<i32> {
    read_number(map, txn, key).map(|n| n as i32)
}

/// Read an i64 value from a Y.Map (stored as f64).
pub fn read_i64<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<i64> {
    read_number(map, txn, key).map(|n| n as i64)
}

/// Read a u64 value from a Y.Map (stored as f64).
pub fn read_u64<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<u64> {
    read_number(map, txn, key).map(|n| n as u64)
}

/// Convert an Option<String> to Yrs Any (String or Null).
pub fn option_string(val: &Option<String>) -> Any {
    match val {
        Some(s) => Any::String(Arc::from(s.as_str())),
        None => Any::Null,
    }
}

/// Convert an Option<f64> to Yrs Any (Number or Null).
pub fn option_number(val: &Option<f64>) -> Any {
    match val {
        Some(n) => Any::Number(*n),
        None => Any::Null,
    }
}

/// Convert an Option<u32> to Yrs Any (Number or Null).
pub fn option_u32(val: &Option<u32>) -> Any {
    match val {
        Some(n) => Any::Number(*n as f64),
        None => Any::Null,
    }
}

/// Convert an Option<i32> to Yrs Any (Number or Null).
pub fn option_i32(val: &Option<i32>) -> Any {
    match val {
        Some(n) => Any::Number(*n as f64),
        None => Any::Null,
    }
}

/// Convert an Option<bool> to Yrs Any (Bool or Null).
pub fn option_bool(val: &Option<bool>) -> Any {
    match val {
        Some(b) => Any::Bool(*b),
        None => Any::Null,
    }
}

/// Write a string value to a Y.Map.
pub fn write_string(map: &MapRef, txn: &mut TransactionMut, key: &str, value: &str) {
    map.insert(txn, key, Any::String(Arc::from(value)));
}

/// Write an optional string value to a Y.Map (removes key if None).
pub fn write_option_string(
    map: &MapRef,
    txn: &mut TransactionMut,
    key: &str,
    value: &Option<String>,
) {
    match value {
        Some(s) => map.insert(txn, key, Any::String(Arc::from(s.as_str()))),
        None => map.insert(txn, key, Any::Null),
    };
}

/// Write a number value to a Y.Map.
pub fn write_number(map: &MapRef, txn: &mut TransactionMut, key: &str, value: f64) {
    map.insert(txn, key, Any::Number(value));
}

/// Write a bool value to a Y.Map.
pub fn write_bool(map: &MapRef, txn: &mut TransactionMut, key: &str, value: bool) {
    map.insert(txn, key, Any::Bool(value));
}

/// Serialize a value to a JSON string and store it as `Any::String` in a Y.Map.
///
/// This is the "JSON bridge" pattern: complex/nested types that don't map to
/// flat Yrs primitives are serialized as JSON strings. Use for `Vec<T>`,
/// nested structs, `HashMap`, etc.
pub fn write_json<V: serde::Serialize>(
    map: &MapRef,
    txn: &mut TransactionMut,
    key: &str,
    value: &V,
) {
    let json = serde_json::to_string(value).unwrap_or_default();
    map.insert(txn, key, Any::String(Arc::from(json.as_str())));
}

/// Serialize a value to a JSON `Any::String` for use in prelim entries.
pub fn json_any<V: serde::Serialize>(v: &V) -> Any {
    Any::String(Arc::from(
        serde_json::to_string(v).unwrap_or_default().as_str(),
    ))
}

/// Read a JSON-serialized value from a Y.Map string field.
///
/// Counterpart to [`write_json`]. Returns `None` if the key is missing or
/// the stored string cannot be deserialized into `V`.
pub fn read_json<T: yrs::ReadTxn, V: serde::de::DeserializeOwned>(
    map: &MapRef,
    txn: &T,
    key: &str,
) -> Option<V> {
    match map.get(txn, key)? {
        yrs::Out::Any(Any::String(s)) => serde_json::from_str(&s).ok(),
        _ => None,
    }
}

/// Read a JSON-serialized `Vec<T>` from a Y.Map string entry.
///
/// Bridge pattern for ordered collections that stay as JSON strings
/// (Yrs `ArrayRef` migration is a future follow-up).
pub fn read_json_vec<T: yrs::ReadTxn, V: serde::de::DeserializeOwned>(
    map: &MapRef,
    txn: &T,
    key: &str,
) -> Vec<V> {
    read_string(map, txn, key)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Write a `Vec<T>` as a JSON string entry in a Y.Map.
///
/// Removes the key when the slice is empty to keep the map sparse.
pub fn write_json_vec<V: serde::Serialize>(
    map: &MapRef,
    txn: &mut TransactionMut,
    key: &str,
    value: &[V],
) {
    if value.is_empty() {
        map.remove(txn, key);
    } else {
        let json = serde_json::to_string(value).expect("vec serialization");
        map.insert(txn, key, Any::String(Arc::from(json.as_str())));
    }
}

/// Run a strict `from_ooxml_token` parser against a stored string; emit a
/// loud warning on unknown tokens and return `None` so the field becomes
/// unset. The warn carries the field's Yrs key and the offending token so
/// the source of the corruption is visible in logs.
///
/// Use at every Yrs read path that maps a stored OOXML token to a typed
/// enum. Field-level leniency without visibility is silent data corruption
/// — this helper makes sure the drop is observable.
pub fn parse_ooxml_token<E>(
    token: &str,
    key: &str,
    parser: impl FnOnce(&str) -> Option<E>,
) -> Option<E> {
    match parser(token) {
        Some(e) => Some(e),
        None => {
            tracing::warn!(
                yrs_key = key,
                token = token,
                "unknown OOXML token in stored Yrs value; dropping field"
            );
            None
        }
    }
}

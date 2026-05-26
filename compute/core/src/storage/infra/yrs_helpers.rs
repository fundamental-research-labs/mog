//! Shared Yrs CRUD helpers for the storage module.
//!
//! Generic read/write utilities for JSON-serialized data in Yrs maps,
//! plus a generic deserializer for Yrs output values. Consolidating
//! these eliminates ~15 duplicate function definitions across 9+ files.
//!
//! # JSON blob helpers (`read_json` / `write_json`)
//!
//! `read_json` supports two storage representations:
//!
//! - **`Any::String`**: A JSON-encoded string (used by callers that store blobs
//!   via `write_json` or `domain_types::yrs_schema::helpers::json_any`).
//! - **`Any::Map` / `Any::Array`**: Native Yrs structured values (used by
//!   callers that store via `json_to_any` in workbook settings).
//!
//! Both representations are in active use by different callers, so both
//! branches are required.
//!
//! ## Current callers
//!
//! | Module | Helper | Data | Tier | Rationale |
//! |--------|--------|------|------|-----------|
//! | `workbook/settings` | `read_json` | `enterKeyDirection`, `selectedSheetIds`, `calculationSettings` | 3 | Small sub-objects within structured settings map |
//! | `workbook/named_ranges` | both | `DefinedName` | 3 | Each entry is a self-contained definition blob |
//! | `sheet/bindings` | `read_json` | `columnMappings` | 3 | JSON-bridged array within structured binding map |
//!
//! The `deserialize_yrs_json` helper is also used by sheet-level modules
//! (bindings, merges, filters, pivots, sparklines) for reading JSON-stored
//! entries.

use serde::de::DeserializeOwned;
use yrs::{Any, Map, MapRef, Out};

// ---------------------------------------------------------------------------
// Generic Yrs map read helpers
// ---------------------------------------------------------------------------

/// Read a string value from a Yrs map entry.
pub(crate) fn read_string<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

/// Read a JSON-deserialized value from a Yrs map entry.
///
/// Supports two storage representations:
/// - **`Any::String`**: JSON-encoded string (from `write_json` / `json_any`)
/// - **`Any::Map` / `Any::Array`**: Native Yrs structured values (from `json_to_any`)
///
/// For structured values, converts back to `serde_json::Value` first, then
/// deserializes into the target type.
pub(crate) fn read_json<T: yrs::ReadTxn, V: DeserializeOwned>(
    map: &MapRef,
    txn: &T,
    key: &str,
) -> Option<V> {
    match map.get(txn, key) {
        Some(Out::Any(Any::String(s))) => serde_json::from_str(&s).ok(),
        Some(Out::Any(any @ Any::Map(_))) | Some(Out::Any(any @ Any::Array(_))) => {
            let json_val = any_to_json(&any);
            serde_json::from_value(json_val).ok()
        }
        _ => None,
    }
}

/// Convert a `yrs::Any` to a `serde_json::Value`.
///
/// Used by `read_json` to convert structured `Any::Map`/`Any::Array` values
/// and by `get_setting` for generic value retrieval.
pub(crate) fn any_to_json(any: &Any) -> serde_json::Value {
    match any {
        Any::Null | Any::Undefined => serde_json::Value::Null,
        Any::Bool(b) => serde_json::Value::Bool(*b),
        Any::Number(n) => {
            // Preserve integer representation when the value is a whole number,
            // so that serde_json can deserialize into u32/i32/u64/i64 fields.
            if n.fract() == 0.0 && *n >= i64::MIN as f64 && *n <= i64::MAX as f64 {
                serde_json::Value::Number((*n as i64).into())
            } else {
                serde_json::Number::from_f64(*n)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            }
        }
        Any::BigInt(n) => serde_json::Value::Number((*n).into()),
        Any::String(s) => serde_json::Value::String(s.to_string()),
        Any::Buffer(_) => serde_json::Value::Null,
        Any::Array(arr) => serde_json::Value::Array(arr.iter().map(any_to_json).collect()),
        Any::Map(map) => {
            let obj: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), any_to_json(v)))
                .collect();
            serde_json::Value::Object(obj)
        }
    }
}

/// Read a boolean value from a Yrs map entry.
pub(crate) fn read_bool<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<bool> {
    match map.get(txn, key) {
        Some(Out::Any(Any::Bool(b))) => Some(b),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Generic Yrs map write helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generic Yrs output deserialization
// ---------------------------------------------------------------------------

/// Deserialize a JSON value from a Yrs `Out` reference.
///
/// This replaces the many per-type `deserialize_*` functions (e.g.
/// `deserialize_comment`, `deserialize_sparkline`, `deserialize_merge`, etc.)
/// with a single generic version.
///
/// Expects the `Out` variant to be `Any::String` containing a JSON payload.
pub(crate) fn deserialize_yrs_json<V: DeserializeOwned>(out: &Out) -> Option<V> {
    match out {
        Out::Any(Any::String(s)) => serde_json::from_str(s).ok(),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

/// Get the current timestamp in milliseconds since UNIX epoch.
///
pub(crate) fn now_millis() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as u64
    }
}

use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use crate::domain::floating_object::AnchorMode;
use crate::yrs_schema::helpers::{read_i64, read_string};

pub(super) fn sub_object_to_any<T: serde::Serialize>(val: &T) -> Any {
    Any::String(Arc::from(
        serde_json::to_string(val).unwrap_or_default().as_str(),
    ))
}

pub(super) fn option_sub_object<T: serde::Serialize>(val: &Option<T>) -> Option<Any> {
    val.as_ref().map(|v| sub_object_to_any(v))
}

pub(super) fn read_sub_object<T: serde::de::DeserializeOwned, R: ReadTxn>(
    map: &MapRef,
    txn: &R,
    key: &str,
) -> Option<T> {
    read_string(map, txn, key).and_then(|s| match serde_json::from_str(&s) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("[WARN] read_sub_object({key}): deserialization failed: {e}");
            None
        }
    })
}

pub(super) fn read_i64_aliased<R: ReadTxn>(
    map: &MapRef,
    txn: &R,
    canonical: &str,
    legacy: &str,
) -> Option<i64> {
    read_i64(map, txn, canonical).or_else(|| read_i64(map, txn, legacy))
}

pub(super) fn anchor_mode_to_str(mode: &AnchorMode) -> &'static str {
    match mode {
        AnchorMode::OneCell => "oneCell",
        AnchorMode::TwoCell => "twoCell",
        AnchorMode::Absolute => "absolute",
    }
}

pub(super) fn str_to_anchor_mode(s: &str) -> AnchorMode {
    match s {
        "twoCell" => AnchorMode::TwoCell,
        "absolute" => AnchorMode::Absolute,
        _ => AnchorMode::OneCell,
    }
}

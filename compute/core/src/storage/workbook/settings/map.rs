use std::sync::Arc;

use compute_document::schema::KEY_WORKBOOK_SETTINGS;
use yrs::{Any, Map, MapPrelim, MapRef, Out};

pub(super) fn get_settings_map<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<MapRef> {
    match workbook.get(txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn ensure_settings_map(workbook: &MapRef, txn: &mut yrs::TransactionMut<'_>) -> MapRef {
    match workbook.get(txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(txn, KEY_WORKBOOK_SETTINGS, empty)
        }
    }
}

pub(super) fn ensure_optional_string_sub_map(
    settings_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    key: &str,
) -> MapRef {
    match settings_map.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            settings_map.insert(txn, key, empty)
        }
    }
}

pub(super) fn get_optional_string_sub_map<T: yrs::ReadTxn>(
    settings_map: &MapRef,
    txn: &T,
    key: &str,
) -> Option<MapRef> {
    match settings_map.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

pub(super) fn json_to_any(value: &serde_json::Value) -> Any {
    match value {
        serde_json::Value::Null => Any::Null,
        serde_json::Value::Bool(b) => Any::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                Any::Number(f)
            } else {
                Any::Null
            }
        }
        serde_json::Value::String(s) => Any::String(Arc::from(s.as_str())),
        serde_json::Value::Object(map) => {
            let entries: std::collections::HashMap<String, Any> = map
                .iter()
                .map(|(k, v)| (k.clone(), json_to_any(v)))
                .collect();
            Any::Map(Arc::from(entries))
        }
        serde_json::Value::Array(arr) => {
            let items: Vec<Any> = arr.iter().map(json_to_any).collect();
            Any::Array(Arc::from(items))
        }
    }
}

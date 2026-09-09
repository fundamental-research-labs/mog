//! Shared helpers for query submodules.

use value_types::CellValue;

pub(super) fn diff_top_level_keys(
    pre: &serde_json::Value,
    post: &serde_json::Value,
) -> Vec<String> {
    match (pre.as_object(), post.as_object()) {
        (Some(pre_map), Some(post_map)) => {
            let mut keys: Vec<String> = Vec::new();
            for (k, v_post) in post_map {
                match pre_map.get(k) {
                    Some(v_pre) if v_pre == v_post => {}
                    _ => keys.push(k.clone()),
                }
            }
            for k in pre_map.keys() {
                if !post_map.contains_key(k) {
                    keys.push(k.clone());
                }
            }
            keys
        }
        (None, Some(post_map)) => post_map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

pub(super) fn cell_value_to_type_string(value: Option<&CellValue>) -> &'static str {
    match value {
        None | Some(CellValue::Null) => "String",
        Some(CellValue::Number(n)) => {
            if n.get().fract() == 0.0 && n.get().abs() < (i32::MAX as f64) {
                "Integer"
            } else {
                "Double"
            }
        }
        Some(CellValue::Text(_)) => "String",
        Some(CellValue::Boolean(_)) => "Boolean",
        Some(CellValue::Error(..)) => "Error",
        Some(CellValue::Array(_)) => "Array",
        Some(CellValue::Control(_)) => "Boolean",
        Some(CellValue::Image(_)) => "String",
    }
}

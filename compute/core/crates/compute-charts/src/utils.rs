//! Shared utility functions for compute-charts DataRow transforms.

use serde_json::Value;

/// Convert a JSON value to its string representation, matching JS `String()` semantics.
pub(crate) fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

/// Extract f64 from a JSON value.
pub(crate) fn value_as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

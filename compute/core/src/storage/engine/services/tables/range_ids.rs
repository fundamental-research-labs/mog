#![allow(unused_imports, unused_variables)]
use super::*;

// -------------------------------------------------------------------
// Range ID helpers
// -------------------------------------------------------------------

/// Derive a stable range_id key for a table name.
///
/// Convention: `"table:<name>"` — allows rangeBindings to distinguish
/// table bindings from future Range kinds (e.g., `"condformat:<id>"`).
pub(in crate::storage::engine) fn table_range_id(table_name: &str) -> String {
    format!("table:{}", table_name)
}

/// Extract the table name from a range_id, if it follows the `"table:<name>"` convention.
pub(in crate::storage::engine) fn table_name_from_range_id(range_id: &str) -> Option<&str> {
    range_id.strip_prefix("table:")
}

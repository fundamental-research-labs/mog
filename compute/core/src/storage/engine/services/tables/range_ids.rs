#![allow(unused_imports, unused_variables)]
use super::*;

// -------------------------------------------------------------------
// Range ID helpers
// -------------------------------------------------------------------

/// Derive a stable range_id key for a table ID.
///
/// Convention: `"table:<table_id>"` — allows rangeBindings to distinguish
/// table bindings from future Range kinds (e.g., `"condformat:<id>"`).
pub(in crate::storage::engine) fn table_range_id(table_id: &str) -> String {
    format!("table:{}", table_id)
}

/// Extract the table ID from a range_id, if it follows the `"table:<table_id>"` convention.
pub(in crate::storage::engine) fn table_id_from_range_id(range_id: &str) -> Option<&str> {
    range_id.strip_prefix("table:")
}

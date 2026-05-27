//! Unified YrsSchema for FloatingObject — all 12 floating object types.
//!
//! Every floating object is stored as a single Y.Map with:
//! - Common fields (id, sheetId, type, position, size, etc.) as native Yrs keys
//! - Per-type primitive fields as native Yrs keys
//! - Per-type sub-object fields as JSON-serialized strings
//!
//! This replaces the 6 separate yrs_schema modules (floating_object, chart,
//! connector, ole_object, diagram, form_control) with ONE unified module.

mod types;

pub use types::*;

#[cfg(test)]
mod tests;

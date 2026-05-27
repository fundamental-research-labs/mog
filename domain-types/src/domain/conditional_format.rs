//! Unified conditional formatting types.
//!
//! Single source of truth for CF data — used by the XLSX parser, yrs_schema
//! hydration, cf_store runtime CRUD, and XLSX export. Replaces both the old
//! `domain::conditional::CFSpec` and `compute-core::domain_types::cf::ConditionalFormat`.
//!
//! # Typed-enum fields
//!
//! Eight CF enum-valued fields are typed as their `ooxml-types` enum directly
//! instead of `String` / `Option<String>`:
//!
//! - [`CFRule::CellValue`] `operator`
//! - [`CFRule::ContainsText`] `operator`
//! - [`CFRule::TimePeriod`] `time_period`
//! - [`CFColorPoint`] `value_type`
//! - [`CFIconThreshold`] `value_type`
//! - [`CFDataBar`] `direction` / `axis_position`
//! - [`CFIconSet`] `icon_set_name`
//!
//! Wire compat is preserved: each enum carries `#[serde(rename = "<ooxml-token>")]`
//! so the JSON / Yrs byte shape is identical to what the pre-refactor `String`
//! field held (`op.to_ooxml().to_string()`).

mod types;

pub use types::*;

#[cfg(test)]
mod tests;

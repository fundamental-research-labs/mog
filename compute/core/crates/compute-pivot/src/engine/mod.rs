//! Pivot engine orchestrator — compute, detectFields, drillDown, validateConfig, validateAndResolve.
//!
//! Core computation is delegated to `compute-relational`. This module handles
//! config validation, result presentation, and Show Values As transforms.

mod compute;
mod drill_down;
pub mod pivot_items;
pub(crate) mod row_computation;
mod type_detection;
mod validation;

#[cfg(test)]
mod empty_measures_framing_tests;
#[cfg(test)]
mod engine_basic_tests;
#[cfg(test)]
mod engine_edge_case_tests;
#[cfg(test)]
mod engine_expand_collapse_tests;
#[cfg(test)]
mod engine_filter_tests;
#[cfg(test)]
mod engine_grouping_tests;
#[cfg(test)]
mod engine_multi_value_tests;
#[cfg(test)]
mod engine_property_tests;
#[cfg(test)]
mod engine_subtotal_tests;
#[cfg(test)]
mod pivot_rendering_bug_tests;
#[cfg(test)]
mod tabular_layout_tests;
#[cfg(test)]
mod test_helpers;
#[cfg(test)]
mod validation_tests;
#[cfg(test)]
mod value_sorting_tests;

// Sentinel key constants used throughout the pivot engine.
pub(crate) const VALUES_FIELD_KEY: &str = "__VALUES__";
pub(crate) const GRAND_TOTAL_KEY: &str = "__GRAND__";
pub(crate) const SUBTOTAL_SUFFIX: &str = "__SUBTOTAL__";

// Re-export public API
pub use compute::{
    compute, compute_resolved, compute_with_show_values_as, compute_with_show_values_as_resolved,
};
pub use drill_down::{drill_down, drill_down_resolved};
pub use pivot_items::{get_all_field_items, get_field_items};
pub use type_detection::detect_fields;
pub use validation::{validate_and_resolve, validate_config};

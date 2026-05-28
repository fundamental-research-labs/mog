//! Formula accuracy tests for XLOOKUP scalar, concatenation, structured-ref,
//! optimized-path, and return-range regressions.
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_xlookup

#[path = "formula_accuracy_xlookup/array_concat.rs"]
mod array_concat;
#[path = "formula_accuracy_xlookup/basic_semantics.rs"]
mod basic_semantics;
#[path = "formula_accuracy_xlookup/error_fallbacks.rs"]
mod error_fallbacks;
#[path = "formula_accuracy_xlookup/optimized_paths.rs"]
mod optimized_paths;
#[path = "formula_accuracy_xlookup/return_ranges.rs"]
mod return_ranges;
#[path = "formula_accuracy_xlookup/structured_table_refs.rs"]
mod structured_table_refs;
#[path = "formula_accuracy_xlookup/support.rs"]
mod support;

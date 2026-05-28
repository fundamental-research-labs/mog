//! Formula accuracy tests for MATCH, INDEX/MATCH, array-IF lookup patterns,
//! and lazy INDEX regressions.
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_match_index

#[path = "formula_accuracy_match_index/array_if_index_match.rs"]
mod array_if_index_match;
#[path = "formula_accuracy_match_index/index_shape_forms.rs"]
mod index_shape_forms;
#[path = "formula_accuracy_match_index/lazy_index_cycles.rs"]
mod lazy_index_cycles;
#[path = "formula_accuracy_match_index/match_basic.rs"]
mod match_basic;
#[path = "formula_accuracy_match_index/match_index_errors.rs"]
mod match_index_errors;
#[path = "formula_accuracy_match_index/support.rs"]
mod support;

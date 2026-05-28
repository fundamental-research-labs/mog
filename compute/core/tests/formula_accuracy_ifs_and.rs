//! Formula accuracy tests for IFS + AND engine regressions.
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_ifs_and

#[path = "formula_accuracy_ifs_and/and_basic.rs"]
mod and_basic;
#[path = "formula_accuracy_ifs_and/and_ranges_and_errors.rs"]
mod and_ranges_and_errors;
#[path = "formula_accuracy_ifs_and/ifs_and_corpus.rs"]
mod ifs_and_corpus;
#[path = "formula_accuracy_ifs_and/ifs_and_scalar.rs"]
mod ifs_and_scalar;
#[path = "formula_accuracy_ifs_and/ifs_basic.rs"]
mod ifs_basic;
#[path = "formula_accuracy_ifs_and/support.rs"]
mod support;
#[path = "formula_accuracy_ifs_and/xlfn_prefix.rs"]
mod xlfn_prefix;

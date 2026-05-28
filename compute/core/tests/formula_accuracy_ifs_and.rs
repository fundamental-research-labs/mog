//! Formula accuracy tests for IFS + AND engine regressions.
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_ifs_and

mod support;
mod ifs_basic;
mod and_basic;
mod ifs_and_scalar;
mod xlfn_prefix;
mod and_ranges_and_errors;
mod ifs_and_corpus;

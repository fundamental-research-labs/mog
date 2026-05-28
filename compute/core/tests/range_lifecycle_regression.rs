//! Range lifecycle regression suite.
//!
//! Tests every lifecycle path that Range-backed data must survive through the
//! public `YrsComputeEngine` APIs and mirror reads.
//!
//! Run:
//!   cargo test -p compute-core --test range_lifecycle_regression

#![allow(dead_code)]

#[path = "range_lifecycle_regression/basic_lifecycle.rs"]
mod basic_lifecycle;
#[path = "range_lifecycle_regression/copy_sheet_lifecycle.rs"]
mod copy_sheet_lifecycle;
#[path = "range_lifecycle_regression/cross_sheet_dependencies.rs"]
mod cross_sheet_dependencies;
#[path = "range_lifecycle_regression/edit_history.rs"]
mod edit_history;
#[path = "range_lifecycle_regression/mirror_column_invariants.rs"]
mod mirror_column_invariants;
#[path = "range_lifecycle_regression/persistence_roundtrip.rs"]
mod persistence_roundtrip;
#[path = "range_lifecycle_regression/range_payload_lifecycle.rs"]
mod range_payload_lifecycle;
#[path = "range_lifecycle_regression/structural_lifecycle.rs"]
mod structural_lifecycle;
#[path = "range_lifecycle_regression/support.rs"]
mod support;

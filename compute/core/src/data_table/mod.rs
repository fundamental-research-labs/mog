//! Data Table calculator and persistent Data Table creation support.
//!
//! The root module preserves the public `compute_core::data_table` facade while
//! separating bridge-facing types, pure evaluation, creation validation, A1
//! reference resolution, geometry, and error construction into private modules.

mod creation;
mod errors;
mod evaluate;
mod geometry;
mod refs;
mod types;

#[cfg(test)]
mod evaluate_tests;

pub(crate) use creation::prepare_data_table_creation;
pub use evaluate::calculate_data_table;
pub use types::{CreateDataTableInput, CreateDataTableResult, DataTableParams, DataTableResult};

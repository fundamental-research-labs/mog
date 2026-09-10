//! Chart data transforms for the compute engine.
//!
//! This crate handles chart-specific data transforms: stacking, grouping,
//! and the full transform pipeline. General-purpose statistics, regression,
//! and KDE are provided by `compute-stats` and re-exported here for
//! backwards compatibility.

mod error;
pub use error::*;

pub mod types;
mod utils;
pub use compute_stats::regression;
pub use compute_stats::statistics;
pub mod grouping;
pub mod stacking;
pub mod transforms;

#[cfg(test)]
mod types_tests;

//! Relational compute engine — GROUP BY and aggregation.
//!
//! This crate implements a declarative relational query engine over tabular data.
//! It produces a pure data tree (`QueryResult`) with no layout, no UI state,
//! and no presentation concerns. Consumers (pivot presenter, chart engine,
//! table totals) interpret the tree for their specific output format.
//!
//! ## Pipeline
//!
//! ```text
//! validate(query)
//!   → filter(data, query.filters)
//!   → group_rows(data, query.row_fields)
//!   → group_columns(data, query.column_fields)
//!   → aggregate(row_tree, col_tree, query.measures)
//!   → sort_trees(row_tree, col_tree, query)
//!   → calc_measures(tree, query.calculated_measures)
//!   → grand_totals(tree, query.grand_totals)
//!   → QueryResult
//! ```

#![warn(clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::too_many_lines,
    clippy::similar_names
)]

mod aggregate;
mod calc_measure;
pub mod engine;
pub mod error;
mod filter;
mod grand_totals;
mod group;
mod sort;
pub mod types;

pub use engine::execute;
pub use error::RelationalError;
pub use types::*;

#[cfg(test)]
mod tests;

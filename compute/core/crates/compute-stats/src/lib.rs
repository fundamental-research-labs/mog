//! Shared statistical and analytical primitives for the compute engine.
//!
//! This crate (`compute-stats`, formerly `compute-aggregate`) provides the
//! general-purpose building blocks used by the pivot engine, chart engine,
//! worksheet functions, and WASM bindings:
//!
//! - **`values`** — Canonical value semantics (blank detection, numeric checks,
//!   sort keys, grouping keys, Kahan summation)
//! - **`aggregate`** — 12 aggregate functions with Kahan/Welford numerical accuracy
//! - **`filter`** — Predicate matching (condition operators, wildcard patterns)
//! - **`sort`** — Multi-key sorting (natural sort, type-priority, custom order)
//! - **`describe`** — Single-pass descriptive statistics (min, max, mean, std dev, percentiles)
//! - **`types`** — Shared enums (`AggregateFunction`, `SortDirection`, `FilterOperator`, etc.)
//! - **`regression_types`** — Types for regression analysis (`Point`, `RegressionMethod`, `RegressionOutput`)

#![warn(clippy::pedantic)]
#![deny(missing_docs)]
#![allow(
    clippy::module_name_repetitions,
    clippy::too_many_lines,
    clippy::similar_names,
    clippy::cast_precision_loss
)]

mod error;
pub use error::*;

pub mod aggregate;
pub mod describe;
pub mod filter;
pub mod regression;
pub mod regression_types;
pub mod sort;
pub mod statistics;
pub mod types;
pub mod values;

// Re-export key types at crate root for convenience
pub use aggregate::aggregate;
pub use describe::{DescriptiveStats, describe, percentile};
pub use filter::matches_condition;
pub use regression_types::{Point, RegressionMethod, RegressionOutput};
pub use types::{
    AggregateFunction, BinaryFilterOp, DateGrouping, DetectedDataType, FilterOperator,
    NullaryFilterOp, NumberGrouping, PivotFilterCondition, PivotFilterConditionFlat, SortDirection,
    UnaryFilterOp,
};
pub use values::{
    ARRAY_DISPLAY_LABEL, ARRAY_KEY, BLANK_DISPLAY_LABEL, BLANK_KEY, GroupKey, LAMBDA_DISPLAY_LABEL,
    LAMBDA_KEY, SortKey, cell_value_eq, cell_value_is_numeric, cell_value_to_display_key,
    cell_value_to_group_key, cell_value_to_key, cell_value_to_sort_key, f64_to_group_bits,
    kahan_sum, welford_online,
};

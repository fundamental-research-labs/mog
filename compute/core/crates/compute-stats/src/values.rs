//! Canonical value normalization for the compute engine.
//!
//! This module is the **single source of truth** for how `CellValue` is
//! interpreted across the entire compute engine.  Every other compute module
//! (filter, aggregator, sorter, grouper) MUST delegate to
//! the functions here rather than rolling their own blank detection, numeric
//! checks, equality comparisons, sort ordering, key generation, or
//! compensated summation.
//!
//! # Responsibilities
//!
//! | Concern | Function |
//! |---------|----------|
//! | Blank detection | [`value_types::CellValue::is_visually_blank`] |
//! | Numeric detection | [`cell_value_is_numeric`] |
//! | Value equality | [`cell_value_eq`] |
//! | Sort ordering | [`cell_value_to_sort_key`] / [`SortKey`] |
//! | Structural grouping key | [`cell_value_to_group_key`] / [`GroupKey`] |
//! | Wire-format string key | [`cell_value_to_key`] (delegates to `GroupKey`) |
//! | User-visible label | [`cell_value_to_display_key`] |
//! | Accurate summation | [`kahan_sum`] |

mod display;
mod equality;
mod group;
mod keys;
mod online;
mod sort_key;

pub use display::{
    ARRAY_DISPLAY_LABEL, BLANK_DISPLAY_LABEL, LAMBDA_DISPLAY_LABEL, cell_value_to_display_key,
};
pub use equality::{cell_value_eq, cell_value_is_numeric};
pub use group::{
    ARRAY_KEY, BLANK_KEY, GroupKey, LAMBDA_KEY, cell_value_to_group_key, f64_to_group_bits,
};
pub use keys::{cell_value_filter_keys, cell_value_to_key};
pub use online::{kahan_sum, welford_online};
pub use sort_key::{SortKey, cell_value_to_sort_key};

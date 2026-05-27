//! Analytical sorting — in-place, canonical sort keys, natural sort, custom order, multi-key.
//!
//! All comparisons delegate to `SortKey` from `super::values`, which provides the
//! single source of truth for value ordering across the compute engine.
//!
//! # Sort semantics
//!
//! - **Blanks always last**, regardless of sort direction. A blank is `Null`,
//!   `Text("")`, or `Text` containing only whitespace.
//! - **Type priority is stable** in both ascending and descending: Number < Text
//!   < Boolean < Error < Blank (matches Excel). Only within-type ordering reverses for descending.
//! - **Natural sort** for text values: `"Item 2"` sorts before `"Item 10"`.
//! - **Case-insensitive** by default.
//!
//! # Performance
//!
//! All sort functions use the Schwartzian transform (decorate-sort-undecorate):
//! keys are extracted once in O(n), comparisons use precomputed keys, and
//! reordering is done in-place via index permutation — no cloning of `T`.

mod compare;
mod config;
mod custom_order;
mod in_place;
mod natural;
mod unique;

pub use compare::compare_cell_values;
pub use config::SortConfig;
pub use custom_order::{sort_by_custom_order, sort_by_custom_order_in_place};
pub use in_place::{KeyConfig, sort_by, sort_by_in_place, sort_by_multiple_in_place, sort_values};
pub use natural::natural_compare;
pub use unique::get_unique_sorted;

#[cfg(test)]
mod tests;

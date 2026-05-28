//! Group hierarchy index for Show Values As.
//!
//! This module solves the core architectural problem with Show Values As:
//! the transform layer currently operates on a flat list of `PivotRow`s and
//! cannot reset running totals at group boundaries, scope ranks within
//! parent groups, or find parent totals efficiently.
//!
//! `GroupHierarchy` is a lightweight pre-indexed structure built in O(R) time
//! that provides:
//!
//! - **O(1) parent lookup**: given a row, find its parent subtotal at any depth
//! - **Group-scoped iteration**: iterate siblings within a parent group
//! - **Group boundary detection**: check if a row is the first/last in its group
//! - **Field depth resolution**: map a `base_field` name to the hierarchy depth
//!
//! # Usage
//!
//! ```
//! use compute_pivot::hierarchy::{build_group_hierarchy, GroupHierarchy};
//! use compute_pivot::types::PivotRow;
//!
//! let rows: Vec<PivotRow> = vec![];
//! let row_field_names: Vec<String> = vec!["Region".to_string()];
//! let hierarchy = build_group_hierarchy(&rows, &row_field_names);
//! assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
//! assert_eq!(hierarchy.depth_for_field("Unknown"), None);
//! ```
//!
//! # Allocation Strategy
//!
//! Uses owned `String`s (not lifetimes) for simplicity. The hierarchy is built
//! once per `compute()` call and the allocation is O(R * D) where D is the
//! hierarchy depth (typically 2-5). Lifetime complexity is not worth it here.
//!
//! # Important: Equality Semantics
//!
//! Specific-item lookups use the pivot engine's canonical `cell_value_eq`
//! equality semantics for Unicode-aware text matching, blank unification, and
//! epsilon-tolerant number matching.

mod flat_builder;
mod model;
mod query;
mod tree_builder;

pub use flat_builder::build_group_hierarchy;
pub use model::GroupHierarchy;
pub use tree_builder::build_group_hierarchy_from_aggregated_tree;

#[cfg(test)]
mod tests;

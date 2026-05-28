//! Predicate matching primitives for analytical filtering.
//!
//! General-purpose filter condition evaluation and wildcard pattern matching.
//! Used by both the pivot engine and worksheet functions (SUMIF, COUNTIF, D* functions).
//!
//! # Key functions
//!
//! - [`matches_condition`] — Evaluate a [`crate::types::PivotFilterCondition`] against a [`value_types::CellValue`]
//! - [`matches_wildcard_pattern`] — Excel-compatible wildcard matching (`*`, `?`, `~` escape)

mod condition;
mod text;
mod wildcard;

pub use condition::matches_condition;
pub use wildcard::{CompiledPattern, WildcardToken, matches_wildcard_pattern};

#[cfg(test)]
mod tests;

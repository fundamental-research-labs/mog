//! Wildcard matching and criteria parsing for conditional functions.
//!
//! Used by SUMIF, COUNTIF, AVERAGEIF, and their multi-range variants
//! (SUMIFS, COUNTIFS, AVERAGEIFS, etc.).

mod elements;
mod number;
mod predicate;
mod wildcard;

pub use elements::extract_criteria_elements;
pub use predicate::parse_criteria;
pub use wildcard::{WildcardPattern, wildcard_match};

#[cfg(test)]
mod tests;

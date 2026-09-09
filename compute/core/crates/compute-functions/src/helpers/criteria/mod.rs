//! Wildcard matching and criteria parsing for conditional functions.
//!
//! Used by SUMIF, COUNTIF, AVERAGEIF, and their multi-range variants
//! (SUMIFS, COUNTIFS, AVERAGEIFS, etc.).

mod elements;
mod number;
mod predicate;
mod wildcard;

pub use elements::extract_criteria_elements;
pub use predicate::{numeric_equality_criteria, parse_criteria, plain_text_criteria};
pub use wildcard::{WildcardPattern, wildcard_match};

#[cfg(test)]
mod tests;

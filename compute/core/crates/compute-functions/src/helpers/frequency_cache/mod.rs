//! Session-scoped frequency map cache for COUNTIF/SUMIF/AVERAGEIF.
//!
//! Builds normalized value frequency maps once per range and serves exact
//! COUNTIF/SUMIF/AVERAGEIF criteria with O(1) lookups.

mod cache;
mod count_map;
mod exact;
mod key;
mod sum_map;

pub use cache::{clear, count_lookup, sum_and_count_lookup, sum_lookup};
pub use count_map::{CountFrequencyMap, build_count_map};
pub use exact::is_exact_match_criteria;
pub use key::NormalizedKey;
pub use sum_map::{SumFrequencyMap, build_sum_map};

#[cfg(test)]
mod tests;

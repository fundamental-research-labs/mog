//! Shared infrastructure for Excel-compatible functions.
//!
//! All domain modules (math, text, statistical, etc.) import shared
//! helpers from here. Domain modules NEVER import from each other.
//!
//! ## Module categories
//!
//! **Function utilities** — used by function implementations:
//! - [`coercion`] — value coercion and flattening
//! - [`criteria`] — wildcard/operator criteria parsing
//! - [`conditional_aggregate`] — shared SUMIFS/COUNTIFS aggregation
//! - [`date_serial`] — date serial number conversions
//! - [`power`] — negative base exponentiation
//! - [`hashing`] — cell value hashing
//!
//! **Evaluation caches** — used by `compute-core`'s scheduler and
//! evaluator for incremental recalculation. These are SPI (service
//! provider interface) for the evaluation engine, not general-purpose
//! utilities:
//! - [`bitmask_cache`], [`cache_key`], [`column_bitset`],
//!   [`column_index`], [`frequency_cache`], [`sorted_cache`],
//!   [`sumifs_result_cache`]

// -- Function utilities --
pub mod coercion;
pub mod conditional_aggregate;
pub mod criteria;
pub mod date_serial;
pub mod hashing;
pub mod power;

// -- Evaluation caches (SPI for compute-core scheduler) --
pub mod bitmask_cache;
pub mod cache_key;
pub mod column_bitset;
pub mod column_index;
pub mod frequency_cache;
pub mod sorted_cache;
pub mod sumifs_result_cache;

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/// Functions that can return different results on each evaluation.
/// These must NEVER be cached across calls.
///
/// Used by: scheduler (volatility detection), lambda_cache (parameter-free
/// analysis), subexpr_cache (cacheability check).
///
/// **Duplicate:** `compute-parser` has its own copy (in
/// `compute-core/crates/compute-parser/src/identity_transform.rs`) because it
/// must not depend on `compute-functions`. When adding or removing volatile
/// functions, update **both** lists.
#[allow(dead_code)]
pub const VOLATILE_FUNCTIONS: &[&str] = &[
    "RAND",
    "RANDBETWEEN",
    "RANDARRAY",
    "NOW",
    "TODAY",
    "OFFSET",
    "INDIRECT",
];

#[cfg(test)]
mod tests {
    use super::VOLATILE_FUNCTIONS;

    #[test]
    fn volatile_functions_include_random_array_family() {
        for name in ["RAND", "RANDBETWEEN", "RANDARRAY"] {
            assert!(
                VOLATILE_FUNCTIONS.contains(&name),
                "{name} must stay in shared volatile metadata"
            );
        }
    }
}

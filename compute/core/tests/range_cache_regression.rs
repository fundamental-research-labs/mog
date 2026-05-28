//! Cache regression suite.
//!
//! Verifies coordinated invalidation across the observable cache layers after
//! Range-backed mutations:
//!
//! 1. `col_data` - per-column `Vec<CellValue>` in `SheetMirror`
//! 2. `col_version` - monotonic `u64` in `CellMirror.col_versions`
//! 3. `DenseColumnCache` - `Vec<f64>` materialized for SIMD aggregation
//! 4. `RangeStore` - `Arc<CellArray>` pre-materialized for range refs
//! 5. `LookupIndexCache` - tested indirectly via VLOOKUP formula results
//!
//! Run:
//!   cargo test -p compute-core --test range_cache_regression -- --nocapture

#[path = "range_cache_regression/edit_paths.rs"]
mod edit_paths;
#[path = "range_cache_regression/fixtures.rs"]
mod fixtures;
#[path = "range_cache_regression/freshness_paths.rs"]
mod freshness_paths;
#[path = "range_cache_regression/harness.rs"]
mod harness;
#[path = "range_cache_regression/structural_paths.rs"]
mod structural_paths;

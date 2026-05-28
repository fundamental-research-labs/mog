//! Bin transform support for quantitative chart data.
//!
//! This module keeps the public `transforms::bin` API stable while grouping the
//! bin-grid math, row transform, histogram derivation, and per-series config
//! resolution into focused implementation modules.

mod config;
mod grid;
mod histogram;
mod rows;

pub use config::{histogram_with_series_config, resolve_bin_params};
pub use grid::{BinParams, calculate_bins, find_bin_index, get_bin_boundaries, nice_step};
pub use histogram::{
    CumulativeBin, NormalizedBin, cumulative_histogram, histogram, histogram_from_data,
    normalized_histogram,
};
pub use rows::{apply_bin, apply_bin_spec};

#[cfg(test)]
mod tests;

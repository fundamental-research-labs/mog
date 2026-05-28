//! Statistical functions for chart computations.
//!
//! Provides descriptive statistics, quantiles, outlier detection,
//! correlation, normalization, and kernel density estimation.
//!
//! Ported from `charts/src/math/statistics.ts` — same algorithms,
//! same edge-case behavior.

mod bandwidth;
mod binning;
mod bivariate;
mod descriptive;
mod kde;
mod kernels;
mod outliers;
mod quantile;
mod scale;
#[cfg(test)]
mod tests;
mod types;

pub use bandwidth::{scott_bandwidth, silverman_bandwidth};
pub use binning::{freedman_diaconis_bins, sturges_bins};
pub use bivariate::{correlation, covariance, sample_covariance};
pub use descriptive::{
    max_val, mean, median, min_val, range, sample_std_dev, sample_variance, std_dev, sum, variance,
};
pub use kde::kde;
pub use kernels::{
    biweight_kernel, epanechnikov_kernel, gaussian_kernel, triangular_kernel, uniform_kernel,
};
pub use outliers::{outlier_bounds, outliers, remove_outliers};
pub use quantile::{iqr, quantile, quartiles};
pub use scale::{normalize, z_scores};
pub use types::{KdeOptions, KdeResult, KernelChoice, OutlierBounds, Quartiles};

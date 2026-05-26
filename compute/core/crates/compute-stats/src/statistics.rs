//! Statistical functions for chart computations.
//!
//! Provides descriptive statistics, quantiles, outlier detection,
//! correlation, normalization, and kernel density estimation.
//!
//! Ported from `charts/src/math/statistics.ts` — same algorithms,
//! same edge-case behavior.

use super::values::{kahan_sum, welford_online};
use std::f64::consts::PI;

// =============================================================================
// Types
// =============================================================================

/// Quartile values (Q1, median, Q3).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quartiles {
    /// First quartile (25th percentile).
    pub q1: f64,
    /// Second quartile / median (50th percentile).
    pub median: f64,
    /// Third quartile (75th percentile).
    pub q3: f64,
}

/// Lower and upper outlier bounds (Tukey's rule).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OutlierBounds {
    /// Lower bound: Q1 - multiplier * IQR.
    pub lower: f64,
    /// Upper bound: Q3 + multiplier * IQR.
    pub upper: f64,
}

/// Kernel choice for KDE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KernelChoice {
    /// Gaussian (normal) kernel.
    Gaussian,
    /// Epanechnikov kernel (optimal MSE, compact support).
    Epanechnikov,
    /// Triangular kernel (compact support).
    Triangular,
    /// Uniform (box) kernel.
    Uniform,
    /// Biweight (quartic) kernel.
    Biweight,
}

/// Options for kernel density estimation.
#[derive(Debug, Clone, Default)]
pub struct KdeOptions {
    /// Smoothing bandwidth (default: Silverman's rule).
    pub bandwidth: Option<f64>,
    /// Number of output points (default: 100).
    pub points: Option<usize>,
    /// Kernel function (default: Gaussian).
    pub kernel: Option<KernelChoice>,
    /// Minimum x value (default: min(data) - 3*bandwidth).
    pub min_x: Option<f64>,
    /// Maximum x value (default: max(data) + 3*bandwidth).
    pub max_x: Option<f64>,
}

/// Result of kernel density estimation.
#[derive(Debug, Clone, PartialEq)]
pub struct KdeResult {
    /// X coordinates of the density curve.
    pub x: Vec<f64>,
    /// Y coordinates (density values) of the curve.
    pub y: Vec<f64>,
}

// =============================================================================
// Descriptive Statistics
// =============================================================================

/// Arithmetic mean. Returns `NaN` for empty slices.
#[must_use]
pub fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    kahan_sum(values.iter().copied()) / values.len() as f64
}

/// Median (50th percentile). Returns `NaN` for empty slices.
#[must_use]
pub fn median(values: &[f64]) -> f64 {
    quantile(values, 0.5)
}

/// Population variance (N divisor). Returns `NaN` for empty slices.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn variance(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let (_mean, m2, count) = welford_online(values.iter().copied());
    m2 / count as f64
}

/// Sample variance (N-1 divisor, Bessel's correction).
/// Returns `NaN` for slices with fewer than 2 elements.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn sample_variance(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return f64::NAN;
    }
    let (_mean, m2, count) = welford_online(values.iter().copied());
    m2 / (count - 1) as f64
}

/// Population standard deviation.
#[must_use]
pub fn std_dev(values: &[f64]) -> f64 {
    variance(values).sqrt()
}

/// Sample standard deviation (N-1 divisor).
#[must_use]
pub fn sample_std_dev(values: &[f64]) -> f64 {
    sample_variance(values).sqrt()
}

/// Minimum value. Returns `Infinity` for empty slices.
#[must_use]
pub fn min_val(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::INFINITY;
    }
    let mut result = values[0];
    for &v in &values[1..] {
        if v < result {
            result = v;
        }
    }
    result
}

/// Maximum value. Returns `-Infinity` for empty slices.
#[must_use]
pub fn max_val(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NEG_INFINITY;
    }
    let mut result = values[0];
    for &v in &values[1..] {
        if v > result {
            result = v;
        }
    }
    result
}

/// Range (max - min). Returns `NaN` for empty slices.
#[must_use]
pub fn range(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    max_val(values) - min_val(values)
}

/// Sum of all values. Returns `0` for empty slices.
#[must_use]
pub fn sum(values: &[f64]) -> f64 {
    kahan_sum(values.iter().copied())
}

// =============================================================================
// Quantiles
// =============================================================================

/// Quantile using R-7 method with linear interpolation.
///
/// Returns `NaN` for empty slices.
///
/// # Panics
///
/// Panics if `p` is outside `[0, 1]`.
#[must_use]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]
pub fn quantile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    assert!(
        (0.0..=1.0).contains(&p),
        "Quantile p must be in range [0, 1], got {p}"
    );

    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();

    if n == 1 {
        return sorted[0];
    }
    if p == 0.0 {
        return sorted[0];
    }
    if p == 1.0 {
        return sorted[n - 1];
    }

    // R-7: index = (n - 1) * p
    let index = (n - 1) as f64 * p;
    let lower = index.floor() as usize;
    let upper = index.ceil() as usize;
    let weight = index - lower as f64;

    if lower == upper {
        return sorted[lower];
    }

    // Linear interpolation
    sorted[lower] * (1.0 - weight) + sorted[upper] * weight
}

/// All three quartiles (Q1, median, Q3).
#[must_use]
pub fn quartiles(values: &[f64]) -> Quartiles {
    Quartiles {
        q1: quantile(values, 0.25),
        median: quantile(values, 0.5),
        q3: quantile(values, 0.75),
    }
}

/// Interquartile range (Q3 - Q1). Returns `NaN` for empty slices.
#[must_use]
pub fn iqr(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    quantile(values, 0.75) - quantile(values, 0.25)
}

// =============================================================================
// Outlier Detection
// =============================================================================

/// Tukey's outlier bounds: `[Q1 - multiplier*IQR, Q3 + multiplier*IQR]`.
#[must_use]
pub fn outlier_bounds(values: &[f64], multiplier: f64) -> OutlierBounds {
    let q = quartiles(values);
    let interquartile_range = q.q3 - q.q1;
    OutlierBounds {
        lower: q.q1 - multiplier * interquartile_range,
        upper: q.q3 + multiplier * interquartile_range,
    }
}

/// Values outside Tukey's bounds.
#[must_use]
pub fn outliers(values: &[f64], multiplier: f64) -> Vec<f64> {
    let bounds = outlier_bounds(values, multiplier);
    values
        .iter()
        .copied()
        .filter(|&v| v < bounds.lower || v > bounds.upper)
        .collect()
}

/// Values within Tukey's bounds (outliers removed).
#[must_use]
pub fn remove_outliers(values: &[f64], multiplier: f64) -> Vec<f64> {
    let bounds = outlier_bounds(values, multiplier);
    values
        .iter()
        .copied()
        .filter(|&v| v >= bounds.lower && v <= bounds.upper)
        .collect()
}

// =============================================================================
// Correlation and Covariance
// =============================================================================

/// Population covariance (N divisor). Returns `NaN` if lengths differ or empty.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn covariance(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.is_empty() {
        return f64::NAN;
    }
    let mean_x = mean(x);
    let mean_y = mean(y);
    let cov = kahan_sum(
        x.iter()
            .zip(y.iter())
            .map(|(&xi, &yi)| (xi - mean_x) * (yi - mean_y)),
    );
    cov / x.len() as f64
}

/// Sample covariance (N-1 divisor). Returns `NaN` if lengths differ or < 2.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn sample_covariance(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.len() < 2 {
        return f64::NAN;
    }
    let mean_x = mean(x);
    let mean_y = mean(y);
    let cov = kahan_sum(
        x.iter()
            .zip(y.iter())
            .map(|(&xi, &yi)| (xi - mean_x) * (yi - mean_y)),
    );
    cov / (x.len() - 1) as f64
}

/// Pearson correlation coefficient. Returns `NaN` if lengths differ, empty,
/// or either series has zero standard deviation.
#[must_use]
pub fn correlation(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.is_empty() {
        return f64::NAN;
    }
    let cov = covariance(x, y);
    let std_x = std_dev(x);
    let std_y = std_dev(y);
    if std_x == 0.0 || std_y == 0.0 {
        return f64::NAN;
    }
    cov / (std_x * std_y)
}

// =============================================================================
// Z-Score and Normalization
// =============================================================================

/// Z-scores: `(x - mean) / std_dev`. Returns all zeros if `std_dev` is zero.
#[must_use]
pub fn z_scores(values: &[f64]) -> Vec<f64> {
    let m = mean(values);
    let s = std_dev(values);
    if s == 0.0 {
        return vec![0.0; values.len()];
    }
    values.iter().map(|&v| (v - m) / s).collect()
}

/// Min-max normalization to `[0, 1]`. Returns all `0.5` if range is zero.
#[must_use]
pub fn normalize(values: &[f64]) -> Vec<f64> {
    let mn = min_val(values);
    let mx = max_val(values);
    let rng = mx - mn;
    if rng == 0.0 {
        return vec![0.5; values.len()];
    }
    values.iter().map(|&v| (v - mn) / rng).collect()
}

// =============================================================================
// Kernel Functions
// =============================================================================

/// Gaussian kernel: `(1/sqrt(2pi)) * exp(-u^2/2)`.
#[must_use]
pub fn gaussian_kernel(u: f64) -> f64 {
    (-0.5 * u * u).exp() / (2.0 * PI).sqrt()
}

/// Epanechnikov kernel: `(3/4)(1 - u^2)` for `|u| <= 1`, else `0`.
#[must_use]
pub fn epanechnikov_kernel(u: f64) -> f64 {
    if u.abs() > 1.0 {
        0.0
    } else {
        0.75 * (1.0 - u * u)
    }
}

/// Triangular kernel: `(1 - |u|)` for `|u| <= 1`, else `0`.
#[must_use]
pub fn triangular_kernel(u: f64) -> f64 {
    let abs_u = u.abs();
    if abs_u > 1.0 { 0.0 } else { 1.0 - abs_u }
}

/// Uniform (box) kernel: `0.5` for `|u| <= 1`, else `0`.
#[must_use]
pub fn uniform_kernel(u: f64) -> f64 {
    if u.abs() > 1.0 { 0.0 } else { 0.5 }
}

/// Biweight (quartic) kernel: `(15/16)(1 - u^2)^2` for `|u| <= 1`, else `0`.
#[must_use]
pub fn biweight_kernel(u: f64) -> f64 {
    if u.abs() > 1.0 {
        0.0
    } else {
        let t = 1.0 - u * u;
        (15.0 / 16.0) * t * t
    }
}

/// Resolve a `KernelChoice` to its kernel function pointer.
fn kernel_fn(choice: KernelChoice) -> fn(f64) -> f64 {
    match choice {
        KernelChoice::Gaussian => gaussian_kernel,
        KernelChoice::Epanechnikov => epanechnikov_kernel,
        KernelChoice::Triangular => triangular_kernel,
        KernelChoice::Uniform => uniform_kernel,
        KernelChoice::Biweight => biweight_kernel,
    }
}

// =============================================================================
// Bandwidth Estimators
// =============================================================================

/// Silverman's rule of thumb bandwidth for KDE.
///
/// `h = 1.06 * min(sigma, IQR/1.34) * n^(-1/5)`
///
/// Uses robust IQR estimate to avoid over-smoothing for heavy-tailed
/// distributions. Falls back to `1.0` if all values are identical.
#[must_use]
pub fn silverman_bandwidth(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 1.0;
    }
    let n = values.len() as f64;
    let s = sample_std_dev(values);
    let interquartile_range = iqr(values);

    let robust_iqr = if interquartile_range.is_nan() || interquartile_range == 0.0 {
        f64::INFINITY
    } else {
        interquartile_range / 1.34
    };

    let sigma = if s.is_nan() || s == 0.0 {
        robust_iqr
    } else {
        s.min(robust_iqr)
    };

    // If both stdDev and IQR are 0 (all values identical), return 1
    if !sigma.is_finite() || sigma == 0.0 {
        return 1.0;
    }

    1.06 * sigma * n.powf(-1.0 / 5.0)
}

/// Scott's rule bandwidth.
///
/// `h = 1.059 * sigma * n^(-1/5)`
///
/// Falls back to `1.0` if standard deviation is zero or `NaN`.
#[must_use]
pub fn scott_bandwidth(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 1.0;
    }
    let n = values.len() as f64;
    let s = sample_std_dev(values);

    if s == 0.0 || s.is_nan() {
        return 1.0;
    }

    1.059 * s * n.powf(-1.0 / 5.0)
}

// =============================================================================
// KDE
// =============================================================================

/// Kernel Density Estimation.
///
/// Estimates the probability density function of a continuous random variable.
/// Useful for violin plots, density plots, and smoothed histograms.
#[must_use]
pub fn kde(values: &[f64], options: &KdeOptions) -> KdeResult {
    if values.is_empty() {
        return KdeResult {
            x: vec![],
            y: vec![],
        };
    }

    let bandwidth = options
        .bandwidth
        .unwrap_or_else(|| silverman_bandwidth(values));
    let num_points = options.points.unwrap_or(100);
    let kern = kernel_fn(options.kernel.unwrap_or(KernelChoice::Gaussian));

    let data_min = min_val(values);
    let data_max = max_val(values);
    let padding = 3.0 * bandwidth;

    let x_min = options.min_x.unwrap_or(data_min - padding);
    let x_max = options.max_x.unwrap_or(data_max + padding);

    // Generate x values
    let step = if num_points > 1 {
        (x_max - x_min) / (num_points - 1) as f64
    } else {
        0.0
    };

    let n = values.len() as f64;
    let x: Vec<f64> = (0..num_points).map(|i| x_min + i as f64 * step).collect();
    let y: Vec<f64> = x
        .iter()
        .map(|&xi| {
            let density: f64 = values.iter().map(|&val| kern((xi - val) / bandwidth)).sum();
            density / (n * bandwidth)
        })
        .collect();

    KdeResult { x, y }
}

// =============================================================================
// Binning Statistics
// =============================================================================

/// Sturges' rule for optimal bin count: `ceil(log2(n) + 1)`.
///
/// Returns `1` for `n == 0`.
#[must_use]
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn sturges_bins(n: usize) -> usize {
    if n == 0 {
        return 1;
    }
    ((n as f64).log2() + 1.0).ceil() as usize
}

/// Freedman-Diaconis rule for optimal bin count.
///
/// `bin_width = 2 * IQR * n^(-1/3)`, then `ceil(range / bin_width)`.
///
/// Falls back to Sturges' rule if IQR is zero.
#[must_use]
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn freedman_diaconis_bins(values: &[f64]) -> usize {
    if values.is_empty() {
        return 1;
    }
    let n = values.len();
    let interquartile_range = iqr(values);

    if interquartile_range == 0.0 || interquartile_range.is_nan() {
        return sturges_bins(n);
    }

    let bin_width = 2.0 * interquartile_range * (n as f64).powf(-1.0 / 3.0);
    let data_range = range(values);

    if bin_width == 0.0 {
        return sturges_bins(n);
    }

    1.max((data_range / bin_width).ceil() as usize)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: approximate equality for floats
    fn approx_eq(a: f64, b: f64, eps: f64) -> bool {
        if a.is_nan() && b.is_nan() {
            return true;
        }
        if a.is_infinite() && b.is_infinite() {
            return a.signum() == b.signum();
        }
        (a - b).abs() < eps
    }

    macro_rules! assert_approx {
        ($a:expr, $b:expr) => {
            assert_approx!($a, $b, 1e-10)
        };
        ($a:expr, $b:expr, $eps:expr) => {
            assert!(
                approx_eq($a, $b, $eps),
                "assert_approx failed: left = {:?}, right = {:?} (eps = {:?})",
                $a,
                $b,
                $eps
            );
        };
    }

    // =========================================================================
    // mean
    // =========================================================================

    #[test]
    fn test_mean_empty() {
        assert!(mean(&[]).is_nan());
    }

    #[test]
    fn test_mean_single() {
        assert_approx!(mean(&[42.0]), 42.0);
    }

    #[test]
    fn test_mean_basic() {
        assert_approx!(mean(&[1.0, 2.0, 3.0, 4.0, 5.0]), 3.0);
    }

    #[test]
    fn test_mean_negative() {
        assert_approx!(mean(&[-2.0, -1.0, 0.0, 1.0, 2.0]), 0.0);
    }

    #[test]
    fn test_mean_all_same() {
        assert_approx!(mean(&[7.0, 7.0, 7.0]), 7.0);
    }

    // =========================================================================
    // median
    // =========================================================================

    #[test]
    fn test_median_empty() {
        assert!(median(&[]).is_nan());
    }

    #[test]
    fn test_median_single() {
        assert_approx!(median(&[5.0]), 5.0);
    }

    #[test]
    fn test_median_odd() {
        assert_approx!(median(&[3.0, 1.0, 2.0]), 2.0);
    }

    #[test]
    fn test_median_even() {
        assert_approx!(median(&[1.0, 2.0, 3.0, 4.0]), 2.5);
    }

    // =========================================================================
    // variance / sample_variance / std_dev / sample_std_dev
    // =========================================================================

    #[test]
    fn test_variance_empty() {
        assert!(variance(&[]).is_nan());
    }

    #[test]
    fn test_variance_single() {
        assert_approx!(variance(&[5.0]), 0.0);
    }

    #[test]
    fn test_variance_known() {
        // [2, 4, 4, 4, 5, 5, 7, 9] mean=5, pop_var=4
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        assert_approx!(variance(&data), 4.0);
    }

    #[test]
    fn test_sample_variance_less_than_2() {
        assert!(sample_variance(&[]).is_nan());
        assert!(sample_variance(&[1.0]).is_nan());
    }

    #[test]
    fn test_sample_variance_known() {
        // [2, 4, 4, 4, 5, 5, 7, 9] sample_var = 32/7
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        assert_approx!(sample_variance(&data), 32.0 / 7.0, 1e-10);
    }

    #[test]
    fn test_std_dev_known() {
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        assert_approx!(std_dev(&data), 2.0);
    }

    #[test]
    fn test_sample_std_dev_known() {
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        assert_approx!(sample_std_dev(&data), (32.0_f64 / 7.0).sqrt(), 1e-10);
    }

    #[test]
    fn test_std_dev_empty() {
        assert!(std_dev(&[]).is_nan());
    }

    #[test]
    fn test_variance_all_same() {
        assert_approx!(variance(&[3.0, 3.0, 3.0, 3.0]), 0.0);
    }

    // =========================================================================
    // min_val / max_val / range / sum
    // =========================================================================

    #[test]
    fn test_min_val_empty() {
        assert_eq!(min_val(&[]), f64::INFINITY);
    }

    #[test]
    fn test_max_val_empty() {
        assert_eq!(max_val(&[]), f64::NEG_INFINITY);
    }

    #[test]
    fn test_min_max_basic() {
        let data = [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0];
        assert_approx!(min_val(&data), 1.0);
        assert_approx!(max_val(&data), 9.0);
    }

    #[test]
    fn test_min_max_negative() {
        let data = [-5.0, -1.0, -3.0];
        assert_approx!(min_val(&data), -5.0);
        assert_approx!(max_val(&data), -1.0);
    }

    #[test]
    fn test_range_empty() {
        assert!(range(&[]).is_nan());
    }

    #[test]
    fn test_range_basic() {
        assert_approx!(range(&[1.0, 5.0, 3.0]), 4.0);
    }

    #[test]
    fn test_range_all_same() {
        assert_approx!(range(&[7.0, 7.0, 7.0]), 0.0);
    }

    #[test]
    fn test_sum_empty() {
        assert_approx!(sum(&[]), 0.0);
    }

    #[test]
    fn test_sum_basic() {
        assert_approx!(sum(&[1.0, 2.0, 3.0, 4.0, 5.0]), 15.0);
    }

    // =========================================================================
    // quantile
    // =========================================================================

    #[test]
    fn test_quantile_empty() {
        assert!(quantile(&[], 0.5).is_nan());
    }

    #[test]
    fn test_quantile_single() {
        assert_approx!(quantile(&[42.0], 0.0), 42.0);
        assert_approx!(quantile(&[42.0], 0.5), 42.0);
        assert_approx!(quantile(&[42.0], 1.0), 42.0);
    }

    #[test]
    #[should_panic(expected = "Quantile p must be in range")]
    fn test_quantile_out_of_range_low() {
        let _ = quantile(&[1.0, 2.0], -0.1);
    }

    #[test]
    #[should_panic(expected = "Quantile p must be in range")]
    fn test_quantile_out_of_range_high() {
        let _ = quantile(&[1.0, 2.0], 1.1);
    }

    #[test]
    fn test_quantile_endpoints() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_approx!(quantile(&data, 0.0), 1.0);
        assert_approx!(quantile(&data, 1.0), 5.0);
    }

    #[test]
    fn test_quantile_r7_interpolation() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_approx!(quantile(&data, 0.25), 2.0);
        assert_approx!(quantile(&data, 0.75), 4.0);
    }

    #[test]
    fn test_quantile_interpolation_between() {
        let data = [1.0, 2.0, 3.0, 4.0];
        assert_approx!(quantile(&data, 0.1), 1.3, 1e-10);
    }

    #[test]
    fn test_quantile_unsorted_input() {
        let data = [5.0, 1.0, 3.0, 2.0, 4.0];
        assert_approx!(quantile(&data, 0.5), 3.0);
    }

    // =========================================================================
    // quartiles / iqr
    // =========================================================================

    #[test]
    fn test_quartiles_basic() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let q = quartiles(&data);
        assert_approx!(q.q1, 3.25, 1e-10);
        assert_approx!(q.median, 5.5, 1e-10);
        assert_approx!(q.q3, 7.75, 1e-10);
    }

    #[test]
    fn test_iqr_empty() {
        assert!(iqr(&[]).is_nan());
    }

    #[test]
    fn test_iqr_basic() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        assert_approx!(iqr(&data), 4.5, 1e-10);
    }

    // =========================================================================
    // outlier_bounds / outliers / remove_outliers
    // =========================================================================

    #[test]
    fn test_outlier_bounds_basic() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let bounds = outlier_bounds(&data, 1.5);
        assert_approx!(bounds.lower, -3.5, 1e-10);
        assert_approx!(bounds.upper, 14.5, 1e-10);
    }

    #[test]
    fn test_outliers_with_outlier() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
        let out = outliers(&data, 1.5);
        assert!(out.contains(&100.0));
    }

    #[test]
    fn test_remove_outliers_basic() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
        let clean = remove_outliers(&data, 1.5);
        assert!(!clean.contains(&100.0));
        for v in &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0] {
            assert!(clean.contains(v), "Expected {} in cleaned data", v);
        }
    }

    #[test]
    fn test_outliers_with_larger_multiplier() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
        let out = outliers(&data, 3.0);
        assert!(out.contains(&100.0));
    }

    // =========================================================================
    // covariance / sample_covariance / correlation
    // =========================================================================

    #[test]
    fn test_covariance_empty() {
        assert!(covariance(&[], &[]).is_nan());
    }

    #[test]
    fn test_covariance_mismatched_length() {
        assert!(covariance(&[1.0, 2.0], &[1.0]).is_nan());
    }

    #[test]
    fn test_covariance_perfect_positive() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [2.0, 4.0, 6.0, 8.0, 10.0];
        let cov = covariance(&x, &y);
        assert_approx!(cov, 4.0, 1e-10);
    }

    #[test]
    fn test_sample_covariance_length_1() {
        assert!(sample_covariance(&[1.0], &[2.0]).is_nan());
    }

    #[test]
    fn test_sample_covariance_basic() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [2.0, 4.0, 6.0, 8.0, 10.0];
        assert_approx!(sample_covariance(&x, &y), 5.0, 1e-10);
    }

    #[test]
    fn test_correlation_perfect_positive() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [2.0, 4.0, 6.0, 8.0, 10.0];
        assert_approx!(correlation(&x, &y), 1.0, 1e-10);
    }

    #[test]
    fn test_correlation_perfect_negative() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [10.0, 8.0, 6.0, 4.0, 2.0];
        assert_approx!(correlation(&x, &y), -1.0, 1e-10);
    }

    #[test]
    fn test_correlation_zero_std_dev() {
        let x = [3.0, 3.0, 3.0];
        let y = [1.0, 2.0, 3.0];
        assert!(correlation(&x, &y).is_nan());
    }

    #[test]
    fn test_correlation_empty() {
        assert!(correlation(&[], &[]).is_nan());
    }

    // =========================================================================
    // z_scores / normalize
    // =========================================================================

    #[test]
    fn test_z_scores_basic() {
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        let z = z_scores(&data);
        assert_eq!(z.len(), data.len());
        assert_approx!(z[0], (2.0 - 5.0) / 2.0);
        assert_approx!(z[7], (9.0 - 5.0) / 2.0);
    }

    #[test]
    fn test_z_scores_all_same() {
        let z = z_scores(&[5.0, 5.0, 5.0]);
        assert!(z.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn test_z_scores_empty() {
        assert!(z_scores(&[]).is_empty());
    }

    #[test]
    fn test_normalize_basic() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        let n = normalize(&data);
        assert_approx!(n[0], 0.0);
        assert_approx!(n[4], 1.0);
        assert_approx!(n[2], 0.5);
    }

    #[test]
    fn test_normalize_all_same() {
        let n = normalize(&[7.0, 7.0, 7.0]);
        assert!(n.iter().all(|&v| approx_eq(v, 0.5, 1e-10)));
    }

    #[test]
    fn test_normalize_empty() {
        assert!(normalize(&[]).is_empty());
    }

    #[test]
    fn test_normalize_negative() {
        let data = [-10.0, 0.0, 10.0];
        let n = normalize(&data);
        assert_approx!(n[0], 0.0);
        assert_approx!(n[1], 0.5);
        assert_approx!(n[2], 1.0);
    }

    // =========================================================================
    // Kernel functions
    // =========================================================================

    #[test]
    fn test_gaussian_kernel_at_zero() {
        assert_approx!(gaussian_kernel(0.0), 1.0 / (2.0 * PI).sqrt(), 1e-10);
    }

    #[test]
    fn test_gaussian_kernel_symmetric() {
        assert_approx!(gaussian_kernel(1.0), gaussian_kernel(-1.0), 1e-15);
    }

    #[test]
    fn test_gaussian_kernel_tails() {
        assert!(gaussian_kernel(3.0) > 0.0);
        assert!(gaussian_kernel(3.0) < 0.01);
    }

    #[test]
    fn test_epanechnikov_kernel_at_zero() {
        assert_approx!(epanechnikov_kernel(0.0), 0.75);
    }

    #[test]
    fn test_epanechnikov_kernel_at_boundary() {
        assert_approx!(epanechnikov_kernel(1.0), 0.0);
        assert_approx!(epanechnikov_kernel(-1.0), 0.0);
    }

    #[test]
    fn test_epanechnikov_kernel_outside() {
        assert_approx!(epanechnikov_kernel(1.5), 0.0);
        assert_approx!(epanechnikov_kernel(-2.0), 0.0);
    }

    #[test]
    fn test_triangular_kernel_at_zero() {
        assert_approx!(triangular_kernel(0.0), 1.0);
    }

    #[test]
    fn test_triangular_kernel_at_boundary() {
        assert_approx!(triangular_kernel(1.0), 0.0);
        assert_approx!(triangular_kernel(-1.0), 0.0);
    }

    #[test]
    fn test_triangular_kernel_outside() {
        assert_approx!(triangular_kernel(1.5), 0.0);
    }

    #[test]
    fn test_triangular_kernel_midpoint() {
        assert_approx!(triangular_kernel(0.5), 0.5);
    }

    #[test]
    fn test_uniform_kernel_inside() {
        assert_approx!(uniform_kernel(0.0), 0.5);
        assert_approx!(uniform_kernel(0.5), 0.5);
        assert_approx!(uniform_kernel(-0.99), 0.5);
    }

    #[test]
    fn test_uniform_kernel_outside() {
        assert_approx!(uniform_kernel(1.5), 0.0);
        assert_approx!(uniform_kernel(-1.5), 0.0);
    }

    #[test]
    fn test_uniform_kernel_at_boundary() {
        assert_approx!(uniform_kernel(1.0), 0.5);
        assert_approx!(uniform_kernel(-1.0), 0.5);
    }

    #[test]
    fn test_biweight_kernel_at_zero() {
        assert_approx!(biweight_kernel(0.0), 15.0 / 16.0);
    }

    #[test]
    fn test_biweight_kernel_at_boundary() {
        assert_approx!(biweight_kernel(1.0), 0.0);
        assert_approx!(biweight_kernel(-1.0), 0.0);
    }

    #[test]
    fn test_biweight_kernel_outside() {
        assert_approx!(biweight_kernel(2.0), 0.0);
    }

    // =========================================================================
    // Bandwidth estimators
    // =========================================================================

    #[test]
    fn test_silverman_bandwidth_empty() {
        assert_approx!(silverman_bandwidth(&[]), 1.0);
    }

    #[test]
    fn test_silverman_bandwidth_all_same() {
        assert_approx!(silverman_bandwidth(&[5.0, 5.0, 5.0, 5.0]), 1.0);
    }

    #[test]
    fn test_silverman_bandwidth_positive() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let h = silverman_bandwidth(&data);
        assert!(h > 0.0);
        assert!(h.is_finite());
    }

    #[test]
    fn test_scott_bandwidth_empty() {
        assert_approx!(scott_bandwidth(&[]), 1.0);
    }

    #[test]
    fn test_scott_bandwidth_all_same() {
        assert_approx!(scott_bandwidth(&[3.0, 3.0, 3.0]), 1.0);
    }

    #[test]
    fn test_scott_bandwidth_positive() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let h = scott_bandwidth(&data);
        assert!(h > 0.0);
        assert!(h.is_finite());
    }

    // =========================================================================
    // KDE
    // =========================================================================

    #[test]
    fn test_kde_empty() {
        let result = kde(&[], &KdeOptions::default());
        assert!(result.x.is_empty());
        assert!(result.y.is_empty());
    }

    #[test]
    fn test_kde_single_value() {
        let result = kde(&[5.0], &KdeOptions::default());
        assert_eq!(result.x.len(), 100);
        assert_eq!(result.y.len(), 100);
        assert!(result.y.iter().all(|&v| v >= 0.0));
    }

    #[test]
    fn test_kde_bell_shape() {
        let data: Vec<f64> = vec![1.0, 2.0, 2.0, 3.0, 3.0, 3.0, 4.0, 4.0, 5.0];
        let result = kde(
            &data,
            &KdeOptions {
                points: Some(200),
                ..KdeOptions::default()
            },
        );
        assert_eq!(result.x.len(), 200);
        assert_eq!(result.y.len(), 200);

        let max_y = result.y.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let peak_idx = result.y.iter().position(|&v| v == max_y).unwrap();
        let peak_x = result.x[peak_idx];

        assert!(
            (peak_x - 3.0).abs() < 1.5,
            "Peak at x={}, expected near 3.0",
            peak_x
        );
    }

    #[test]
    fn test_kde_with_epanechnikov() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        let result = kde(
            &data,
            &KdeOptions {
                kernel: Some(KernelChoice::Epanechnikov),
                points: Some(50),
                ..KdeOptions::default()
            },
        );
        assert_eq!(result.x.len(), 50);
        assert!(result.y.iter().all(|&v| v >= 0.0));
    }

    #[test]
    fn test_kde_custom_bandwidth() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        let result = kde(
            &data,
            &KdeOptions {
                bandwidth: Some(0.5),
                points: Some(50),
                ..KdeOptions::default()
            },
        );
        assert_eq!(result.x.len(), 50);
    }

    #[test]
    fn test_kde_custom_extent() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        let result = kde(
            &data,
            &KdeOptions {
                min_x: Some(0.0),
                max_x: Some(6.0),
                points: Some(20),
                ..KdeOptions::default()
            },
        );
        assert_approx!(result.x[0], 0.0);
        assert_approx!(*result.x.last().unwrap(), 6.0);
    }

    #[test]
    fn test_kde_density_integrates_near_one() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let result = kde(
            &data,
            &KdeOptions {
                points: Some(500),
                ..KdeOptions::default()
            },
        );
        let step = (result.x.last().unwrap() - result.x[0]) / (result.x.len() - 1) as f64;
        let integral: f64 = result.y.iter().sum::<f64>() * step;
        assert!(
            (integral - 1.0).abs() < 0.1,
            "KDE integral = {}, expected ~1.0",
            integral
        );
    }

    #[test]
    fn test_kde_all_kernels() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0];
        let kernels = [
            KernelChoice::Gaussian,
            KernelChoice::Epanechnikov,
            KernelChoice::Triangular,
            KernelChoice::Uniform,
            KernelChoice::Biweight,
        ];
        for k in &kernels {
            let result = kde(
                &data,
                &KdeOptions {
                    kernel: Some(*k),
                    points: Some(20),
                    ..KdeOptions::default()
                },
            );
            assert_eq!(result.x.len(), 20, "kernel {:?}", k);
            assert!(
                result.y.iter().all(|&v| v >= 0.0),
                "Negative density for kernel {:?}",
                k
            );
        }
    }

    // =========================================================================
    // Binning statistics
    // =========================================================================

    #[test]
    fn test_sturges_bins_zero() {
        assert_eq!(sturges_bins(0), 1);
    }

    #[test]
    fn test_sturges_bins_one() {
        assert_eq!(sturges_bins(1), 1);
    }

    #[test]
    fn test_sturges_bins_typical() {
        assert_eq!(sturges_bins(100), 8);
    }

    #[test]
    fn test_sturges_bins_power_of_2() {
        assert_eq!(sturges_bins(8), 4);
    }

    #[test]
    fn test_freedman_diaconis_bins_empty() {
        assert_eq!(freedman_diaconis_bins(&[]), 1);
    }

    #[test]
    fn test_freedman_diaconis_bins_all_same() {
        assert_eq!(freedman_diaconis_bins(&[5.0; 10]), sturges_bins(10));
    }

    #[test]
    fn test_freedman_diaconis_bins_positive() {
        let data: Vec<f64> = (1..=100).map(|x| x as f64).collect();
        let bins = freedman_diaconis_bins(&data);
        assert!(bins >= 1);
        assert!(bins <= 100);
    }

    // =========================================================================
    // Edge case: single element across various functions
    // =========================================================================

    #[test]
    fn test_single_element_across_functions() {
        let data = [42.0];
        assert_approx!(mean(&data), 42.0);
        assert_approx!(median(&data), 42.0);
        assert_approx!(variance(&data), 0.0);
        assert!(sample_variance(&data).is_nan());
        assert_approx!(std_dev(&data), 0.0);
        assert_approx!(min_val(&data), 42.0);
        assert_approx!(max_val(&data), 42.0);
        assert_approx!(range(&data), 0.0);
        assert_approx!(sum(&data), 42.0);
        assert_approx!(iqr(&data), 0.0);
    }

    // =========================================================================
    // Edge case: two elements
    // =========================================================================

    #[test]
    fn test_two_elements() {
        let data = [10.0, 20.0];
        assert_approx!(mean(&data), 15.0);
        assert_approx!(median(&data), 15.0);
        assert_approx!(variance(&data), 25.0);
        assert_approx!(sample_variance(&data), 50.0);
    }

    // =========================================================================
    // Large dataset smoke test
    // =========================================================================

    #[test]
    fn test_large_dataset() {
        let data: Vec<f64> = (0..10000).map(|i| (i as f64) / 100.0).collect();
        let m = mean(&data);
        assert!(m > 49.0 && m < 51.0);
        let s = std_dev(&data);
        assert!(s > 0.0);
        let h = silverman_bandwidth(&data);
        assert!(h > 0.0 && h.is_finite());
    }

    // =========================================================================
    // Numerical stability (Welford + Kahan upgrades)
    // =========================================================================

    #[test]
    fn test_sum_kahan_compensated() {
        // Without Kahan: 1e15 + 1.0 - 1e15 = 0.0 (catastrophic cancellation).
        assert_approx!(sum(&[1e15, 1.0, -1e15]), 1.0);
    }

    #[test]
    fn test_sum_many_small_values() {
        // 10,000 copies of 0.1 — naive sum accumulates error.
        let data: Vec<f64> = vec![0.1; 10_000];
        assert!((sum(&data) - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn test_mean_kahan_compensated() {
        assert_approx!(mean(&[1e15, 1.0, -1e15]), 1.0 / 3.0, 1e-10);
    }

    #[test]
    fn test_variance_welford_large_offset() {
        // Values close together with large magnitude — naive two-pass fails.
        let data: Vec<f64> = (1..=10).map(|i| 1e12 + i as f64).collect();
        // Population variance of [1,2,...,10] = 8.25
        assert_approx!(variance(&data), 8.25, 1e-6);
    }

    #[test]
    fn test_sample_variance_welford_large_offset() {
        let data: Vec<f64> = (1..=10).map(|i| 1e12 + i as f64).collect();
        // Sample variance = 8.25 * 10/9 ≈ 9.1667
        assert_approx!(sample_variance(&data), 8.25 * 10.0 / 9.0, 1e-6);
    }

    #[test]
    fn test_covariance_kahan_compensated() {
        // Large offset covariance — Kahan helps with the sum of products.
        let x: Vec<f64> = (1..=5).map(|i| 1e12 + i as f64).collect();
        let y: Vec<f64> = (1..=5).map(|i| 1e12 + 2.0 * i as f64).collect();
        let cov = covariance(&x, &y);
        // cov(x, y) = cov([1..5], [2,4,6,8,10]) = 4.0
        assert_approx!(cov, 4.0, 1e-4);
    }

    // =========================================================================
    // First-principles: Covariance (population)
    // =========================================================================

    #[test]
    fn test_covariance_positive_3elem() {
        // X=[1,2,3], Y=[2,4,6]: means 2,4
        // deviations: (-1)(-2)+(0)(0)+(1)(2) = 4; cov = 4/3
        let x = [1.0, 2.0, 3.0];
        let y = [2.0, 4.0, 6.0];
        assert_approx!(covariance(&x, &y), 4.0 / 3.0, 1e-10);
    }

    #[test]
    fn test_covariance_negative_3elem() {
        // X=[1,2,3], Y=[6,4,2]: means 2,4
        // deviations: (-1)(2)+(0)(0)+(1)(-2) = -4; cov = -4/3
        let x = [1.0, 2.0, 3.0];
        let y = [6.0, 4.0, 2.0];
        assert_approx!(covariance(&x, &y), -4.0 / 3.0, 1e-10);
    }

    #[test]
    fn test_covariance_uncorrelated() {
        // X=[1,2,3], Y=[1,1,1]: mean_y=1, all deviations in Y are 0
        let x = [1.0, 2.0, 3.0];
        let y = [1.0, 1.0, 1.0];
        assert_approx!(covariance(&x, &y), 0.0, 1e-10);
    }

    #[test]
    fn test_covariance_single_element() {
        // Single element: both deviations are 0, so cov = 0
        let x = [5.0];
        let y = [10.0];
        assert_approx!(covariance(&x, &y), 0.0, 1e-10);
    }

    #[test]
    fn test_covariance_length_mismatch() {
        assert!(covariance(&[1.0, 2.0, 3.0], &[1.0, 2.0]).is_nan());
    }

    // =========================================================================
    // First-principles: Sample Covariance (N-1)
    // =========================================================================

    #[test]
    fn test_sample_covariance_3elem() {
        // X=[1,2,3], Y=[2,4,6]: sum of deviation products = 4
        // sample_cov = 4 / (3-1) = 2.0
        let x = [1.0, 2.0, 3.0];
        let y = [2.0, 4.0, 6.0];
        assert_approx!(sample_covariance(&x, &y), 2.0, 1e-10);
    }

    #[test]
    fn test_sample_covariance_empty() {
        assert!(sample_covariance(&[], &[]).is_nan());
    }

    #[test]
    fn test_sample_covariance_length_mismatch() {
        assert!(sample_covariance(&[1.0, 2.0], &[1.0]).is_nan());
    }

    // =========================================================================
    // First-principles: Correlation (Pearson)
    // =========================================================================

    #[test]
    fn test_correlation_positive_3elem() {
        // X=[1,2,3], Y=[2,4,6]: perfectly linear => r = 1.0
        let x = [1.0, 2.0, 3.0];
        let y = [2.0, 4.0, 6.0];
        assert_approx!(correlation(&x, &y), 1.0, 1e-10);
    }

    #[test]
    fn test_correlation_negative_3elem() {
        // X=[1,2,3], Y=[6,4,2]: perfectly negative linear => r = -1.0
        let x = [1.0, 2.0, 3.0];
        let y = [6.0, 4.0, 2.0];
        assert_approx!(correlation(&x, &y), -1.0, 1e-10);
    }

    #[test]
    fn test_correlation_constant_y_is_nan() {
        // Y constant => std_y = 0 => NaN
        let x = [1.0, 2.0, 3.0];
        let y = [5.0, 5.0, 5.0];
        assert!(correlation(&x, &y).is_nan());
    }

    #[test]
    fn test_correlation_self() {
        // corr(X, X) should always be 1.0
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_approx!(correlation(&x, &x), 1.0, 1e-10);
    }

    #[test]
    fn test_correlation_self_negative_values() {
        let x = [-10.0, -5.0, 0.0, 5.0, 10.0];
        assert_approx!(correlation(&x, &x), 1.0, 1e-10);
    }

    #[test]
    fn test_correlation_uncorrelated() {
        // Orthogonal data: corr should be 0
        // X = [-1, 0, 1], Y = [0, 1, 0]: mean_x=0, mean_y=1/3
        // cov = (-1)(-1/3) + (0)(2/3) + (1)(-1/3) = 1/3 - 1/3 = 0
        let x = [-1.0, 0.0, 1.0];
        let y = [0.0, 1.0, 0.0];
        assert_approx!(correlation(&x, &y), 0.0, 1e-10);
    }

    // =========================================================================
    // First-principles: Variance edge cases
    // =========================================================================

    #[test]
    fn test_variance_two_elements() {
        // [4, 8]: mean=6, pop_var = ((4-6)^2 + (8-6)^2)/2 = (4+4)/2 = 4.0
        assert_approx!(variance(&[4.0, 8.0]), 4.0, 1e-10);
    }

    #[test]
    fn test_sample_variance_two_elements() {
        // [4, 8]: mean=6, sample_var = ((4-6)^2 + (8-6)^2)/1 = 8.0
        assert_approx!(sample_variance(&[4.0, 8.0]), 8.0, 1e-10);
    }

    #[test]
    fn test_variance_relationship_pop_sample() {
        // sample_var = pop_var * n/(n-1)
        let data = [1.0, 3.0, 5.0, 7.0, 9.0];
        let n = data.len() as f64;
        let pop = variance(&data);
        let samp = sample_variance(&data);
        assert_approx!(samp, pop * n / (n - 1.0), 1e-10);
    }

    // =========================================================================
    // First-principles: Outlier detection (Tukey)
    // =========================================================================

    #[test]
    fn test_outlier_bounds_with_outlier_dataset() {
        // [1,2,3,4,5,6,7,8,9,100]
        // R-7 Q1: index = 9*0.25 = 2.25 => 3 + 0.25*(4-3) = 3.25
        // R-7 Q3: index = 9*0.75 = 6.75 => 7 + 0.75*(8-7) = 7.75
        // IQR = 4.5, lower = 3.25 - 6.75 = -3.5, upper = 7.75 + 6.75 = 14.5
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
        let bounds = outlier_bounds(&data, 1.5);
        assert_approx!(bounds.lower, -3.5, 1e-10);
        assert_approx!(bounds.upper, 14.5, 1e-10);
    }

    #[test]
    fn test_outliers_exact_set() {
        // Only 100 should be an outlier (>14.5). 1 is within [-3.5, 14.5].
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
        let out = outliers(&data, 1.5);
        assert_eq!(out.len(), 1);
        assert_approx!(out[0], 100.0);
    }

    #[test]
    fn test_outliers_none_when_clean() {
        let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let out = outliers(&data, 1.5);
        assert!(out.is_empty());
    }

    // =========================================================================
    // First-principles: Z-scores
    // =========================================================================

    #[test]
    fn test_z_scores_from_first_principles() {
        // [2, 4, 6]: mean=4, pop_var = (4+0+4)/3 = 8/3, std = sqrt(8/3)
        let data = [2.0, 4.0, 6.0];
        let z = z_scores(&data);
        let s = (8.0_f64 / 3.0).sqrt();
        assert_approx!(z[0], (2.0 - 4.0) / s, 1e-10);
        assert_approx!(z[1], 0.0, 1e-10); // middle element always 0
        assert_approx!(z[2], (6.0 - 4.0) / s, 1e-10);
    }

    #[test]
    fn test_z_scores_sum_to_zero() {
        let data = [2.0, 4.0, 6.0];
        let z = z_scores(&data);
        let z_sum: f64 = z.iter().sum();
        assert_approx!(z_sum, 0.0, 1e-10);
    }

    #[test]
    fn test_z_scores_constant_values() {
        // All same => std=0, should return all zeros
        let z = z_scores(&[42.0, 42.0, 42.0, 42.0]);
        assert!(z.iter().all(|&v| v == 0.0));
    }

    // =========================================================================
    // First-principles: Normalize (min-max)
    // =========================================================================

    #[test]
    fn test_normalize_simple_values() {
        // [10, 20, 30]: min=10, max=30, range=20
        // => [(10-10)/20, (20-10)/20, (30-10)/20] = [0.0, 0.5, 1.0]
        let n = normalize(&[10.0, 20.0, 30.0]);
        assert_approx!(n[0], 0.0, 1e-10);
        assert_approx!(n[1], 0.5, 1e-10);
        assert_approx!(n[2], 1.0, 1e-10);
    }

    #[test]
    fn test_normalize_constant_returns_half() {
        // All same => range=0 => all 0.5
        let n = normalize(&[5.0, 5.0, 5.0]);
        for &v in &n {
            assert_approx!(v, 0.5, 1e-10);
        }
    }

    #[test]
    fn test_normalize_two_elements() {
        // [0, 100] => [0.0, 1.0]
        let n = normalize(&[0.0, 100.0]);
        assert_approx!(n[0], 0.0, 1e-10);
        assert_approx!(n[1], 1.0, 1e-10);
    }

    #[test]
    fn test_normalize_single_element() {
        let n = normalize(&[42.0]);
        assert_eq!(n.len(), 1);
        assert_approx!(n[0], 0.5, 1e-10);
    }

    // =========================================================================
    // First-principles: Quantile edge cases
    // =========================================================================

    #[test]
    fn test_quantile_median_4elem() {
        // [1,2,3,4] at p=0.5: index = 3*0.5 = 1.5
        // interpolate between sorted[1]=2 and sorted[2]=3 => 2.5
        let data = [1.0, 2.0, 3.0, 4.0];
        assert_approx!(quantile(&data, 0.5), 2.5, 1e-10);
    }

    #[test]
    #[should_panic(expected = "Quantile p must be in range")]
    fn test_quantile_negative_p() {
        let _ = quantile(&[1.0, 2.0, 3.0], -0.01);
    }

    #[test]
    #[should_panic(expected = "Quantile p must be in range")]
    fn test_quantile_p_above_one() {
        let _ = quantile(&[1.0, 2.0, 3.0], 1.01);
    }

    // =========================================================================
    // First-principles: KDE sanity checks
    // =========================================================================

    #[test]
    fn test_kde_single_point_peak() {
        // KDE of a single point: peak should be at (or very near) that point
        let result = kde(
            &[5.0],
            &KdeOptions {
                points: Some(200),
                ..KdeOptions::default()
            },
        );
        let max_y = result.y.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let peak_idx = result.y.iter().position(|&v| v == max_y).unwrap();
        let peak_x = result.x[peak_idx];
        assert!(
            (peak_x - 5.0).abs() < 0.5,
            "Peak at x={}, expected near 5.0",
            peak_x
        );
    }

    #[test]
    fn test_kde_density_nonnegative() {
        let data = [1.0, 2.0, 3.0, 10.0, 20.0];
        let result = kde(
            &data,
            &KdeOptions {
                points: Some(100),
                ..KdeOptions::default()
            },
        );
        assert!(
            result.y.iter().all(|&v| v >= 0.0),
            "KDE density must be non-negative everywhere"
        );
    }

    #[test]
    fn test_kde_uniform_data_roughly_uniform() {
        // Evenly spaced data should produce roughly uniform density in the middle
        let data: Vec<f64> = (0..20).map(|i| i as f64).collect();
        let result = kde(
            &data,
            &KdeOptions {
                points: Some(200),
                min_x: Some(5.0),
                max_x: Some(14.0),
                ..KdeOptions::default()
            },
        );
        // In the interior, density should not vary too wildly
        let densities: Vec<f64> = result.y[20..180].to_vec();
        let d_min = densities.iter().copied().fold(f64::INFINITY, f64::min);
        let d_max = densities.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        assert!(
            d_max / d_min < 2.0,
            "Uniform data KDE should be roughly uniform in interior, got ratio {}",
            d_max / d_min
        );
    }

    // =========================================================================
    // First-principles: Kernel mathematical properties
    // =========================================================================

    #[test]
    fn test_kernels_maximum_at_zero() {
        // All kernels achieve their maximum at u=0
        assert_approx!(gaussian_kernel(0.0), 1.0 / (2.0 * PI).sqrt(), 1e-10);
        assert_approx!(epanechnikov_kernel(0.0), 0.75, 1e-10);
        assert_approx!(triangular_kernel(0.0), 1.0, 1e-10);
        assert_approx!(uniform_kernel(0.0), 0.5, 1e-10);
        assert_approx!(biweight_kernel(0.0), 15.0 / 16.0, 1e-10);
    }

    #[test]
    fn test_compact_support_kernels_zero_outside() {
        // Epanechnikov, Triangular, Uniform, Biweight all have compact support
        for u in &[1.5, 2.0, 10.0, 100.0] {
            assert_approx!(epanechnikov_kernel(*u), 0.0);
            assert_approx!(epanechnikov_kernel(-*u), 0.0);
            assert_approx!(triangular_kernel(*u), 0.0);
            assert_approx!(triangular_kernel(-*u), 0.0);
            assert_approx!(uniform_kernel(*u), 0.0);
            assert_approx!(uniform_kernel(-*u), 0.0);
            assert_approx!(biweight_kernel(*u), 0.0);
            assert_approx!(biweight_kernel(-*u), 0.0);
        }
    }

    #[test]
    fn test_all_kernels_symmetric() {
        // K(u) = K(-u) for all kernels
        let test_points = [0.0, 0.1, 0.5, 0.99, 1.0, 2.0];
        for &u in &test_points {
            assert_approx!(gaussian_kernel(u), gaussian_kernel(-u), 1e-15);
            assert_approx!(epanechnikov_kernel(u), epanechnikov_kernel(-u), 1e-15);
            assert_approx!(triangular_kernel(u), triangular_kernel(-u), 1e-15);
            assert_approx!(uniform_kernel(u), uniform_kernel(-u), 1e-15);
            assert_approx!(biweight_kernel(u), biweight_kernel(-u), 1e-15);
        }
    }

    // =========================================================================
    // First-principles: Binning
    // =========================================================================

    #[test]
    fn test_sturges_bins_1024() {
        // log2(1024) = 10, ceil(10 + 1) = 11
        assert_eq!(sturges_bins(1024), 11);
    }

    #[test]
    fn test_sturges_bins_8() {
        // log2(8) = 3, ceil(3 + 1) = 4
        assert_eq!(sturges_bins(8), 4);
    }

    #[test]
    fn test_freedman_diaconis_constant_falls_back() {
        // Constant data: IQR=0 => falls back to sturges
        let data = vec![3.0; 50];
        assert_eq!(freedman_diaconis_bins(&data), sturges_bins(50));
    }
}

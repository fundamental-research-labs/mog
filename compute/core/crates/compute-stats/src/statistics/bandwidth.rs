use super::descriptive::sample_std_dev;
use super::quantile::iqr;

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

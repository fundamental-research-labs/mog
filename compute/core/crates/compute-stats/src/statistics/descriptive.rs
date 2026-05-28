use crate::values::{kahan_sum, welford_online};

use super::quantile::quantile;

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

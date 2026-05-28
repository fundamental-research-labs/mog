use std::cmp::Ordering;

use super::types::Quartiles;

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
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
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

use super::quantile::quartiles;
use super::types::OutlierBounds;

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

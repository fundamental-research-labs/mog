use crate::values::kahan_sum;

use super::descriptive::{mean, std_dev};

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

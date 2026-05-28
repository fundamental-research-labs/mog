use super::descriptive::range;
use super::quantile::iqr;

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

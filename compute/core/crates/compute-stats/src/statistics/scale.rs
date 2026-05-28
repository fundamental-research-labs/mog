use super::descriptive::{max_val, mean, min_val, std_dev};

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

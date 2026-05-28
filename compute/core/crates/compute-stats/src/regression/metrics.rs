use crate::Point;

/// Arithmetic mean of a slice (delegates to `crate::statistics::mean`).
fn mean(values: &[f64]) -> f64 {
    crate::statistics::mean(values)
}

/// Calculate R-squared (coefficient of determination).
///
/// R^2 = 1 - `SS_res` / `SS_tot`, clamped to [0, 1] for Excel compatibility.
pub(super) fn calculate_r_squared(data: &[Point], predict: &dyn Fn(f64) -> f64) -> f64 {
    if data.is_empty() {
        return f64::NAN;
    }

    let y_values: Vec<f64> = data.iter().map(|p| p.y).collect();
    let y_mean = mean(&y_values);

    let mut ss_tot = 0.0;
    let mut ss_res = 0.0;

    for p in data {
        let predicted = predict(p.x);
        ss_tot += (p.y - y_mean).powi(2);
        ss_res += (p.y - predicted).powi(2);
    }

    if ss_tot == 0.0 {
        return 1.0; // All y values are the same
    }

    (1.0 - ss_res / ss_tot).clamp(0.0, 1.0)
}

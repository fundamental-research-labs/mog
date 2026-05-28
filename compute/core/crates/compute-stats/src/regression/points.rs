use crate::Point;

use super::types::RegressionOptions;

/// Safe min of a slice (no stack overflow for large slices).
pub(super) fn safe_min(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::INFINITY, f64::min)
}

/// Safe max of a slice.
pub(super) fn safe_max(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
}

/// Generate evenly-spaced predicted points for rendering a trendline.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
pub(super) fn generate_points(
    data: &[Point],
    predict: &dyn Fn(f64) -> f64,
    options: &RegressionOptions,
) -> Vec<Point> {
    if data.is_empty() {
        return vec![];
    }

    let num_points = options.num_points.unwrap_or(50);
    let x_values: Vec<f64> = data.iter().map(|p| p.x).collect();
    let min_x = options.min_x.unwrap_or_else(|| safe_min(&x_values));
    let max_x = options.max_x.unwrap_or_else(|| safe_max(&x_values));

    if num_points <= 1 {
        let y = predict(min_x);
        return if y.is_finite() {
            vec![Point { x: min_x, y }]
        } else {
            vec![]
        };
    }

    let step = (max_x - min_x) / (num_points - 1) as f64;
    let mut points = Vec::with_capacity(num_points);

    for i in 0..num_points {
        let x = min_x + i as f64 * step;
        let y = predict(x);
        if y.is_finite() {
            points.push(Point { x, y });
        }
    }

    points
}

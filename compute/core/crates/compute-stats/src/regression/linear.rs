use crate::{Point, RegressionMethod, RegressionOutput};

use super::format::round_coef;
use super::metrics::calculate_r_squared;
use super::points::generate_points;
use super::types::RegressionOptions;

/// Linear regression: y = mx + b
///
/// Uses the least-squares method.
/// Coefficients: `[b, m]` (intercept, slope).
#[must_use]
pub fn linear_regression(data: &[Point], options: &RegressionOptions) -> RegressionOutput {
    let precision = options.precision.unwrap_or(4);

    if data.is_empty() {
        return RegressionOutput {
            method: RegressionMethod::Linear,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN".to_string(),
        };
    }

    if data.len() == 1 {
        let b = data[0].y;
        return RegressionOutput {
            method: RegressionMethod::Linear,
            order: None,
            coefficients: vec![b, 0.0],
            r_squared: 1.0,
            points: vec![data[0]],
            equation: format!("y = {}", round_coef(b, precision)),
        };
    }

    let n = data.len() as f64;
    let sum_x: f64 = data.iter().map(|p| p.x).sum();
    let sum_y: f64 = data.iter().map(|p| p.y).sum();
    let sum_xy: f64 = data.iter().map(|p| p.x * p.y).sum();
    let sum_x2: f64 = data.iter().map(|p| p.x * p.x).sum();

    let denominator = n * sum_x2 - sum_x * sum_x;

    // Degenerate case: all x values are the same
    if denominator.abs() < 1e-15 {
        let avg_y = sum_y / n;
        return RegressionOutput {
            method: RegressionMethod::Linear,
            order: None,
            coefficients: vec![avg_y, 0.0],
            r_squared: 0.0,
            points: data.iter().map(|p| Point { x: p.x, y: avg_y }).collect(),
            equation: format!("y = {}", round_coef(avg_y, precision)),
        };
    }

    let m = (n * sum_xy - sum_x * sum_y) / denominator;
    let b = (sum_y - m * sum_x) / n;

    let predict = |x: f64| -> f64 { m * x + b };

    let r_squared = calculate_r_squared(data, &predict);
    let points = generate_points(data, &predict, options);

    // Equation string
    let m_str = round_coef(m, precision);
    let b_abs_str = round_coef(b.abs(), precision);
    let equation = if b == 0.0 {
        format!("y = {m_str}x")
    } else {
        let sign = if b >= 0.0 { "+" } else { "-" };
        format!("y = {m_str}x {sign} {b_abs_str}")
    };

    RegressionOutput {
        method: RegressionMethod::Linear,
        order: None,
        coefficients: vec![b, m],
        r_squared,
        points,
        equation,
    }
}

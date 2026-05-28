use crate::{Point, RegressionMethod, RegressionOutput};

use super::format::{build_poly_equation, round_coef};
use super::linear::linear_regression;
use super::metrics::calculate_r_squared;
use super::points::generate_points;
use super::solver::{gaussian_elimination, poly_eval};
use super::types::RegressionOptions;

fn mean(values: &[f64]) -> f64 {
    crate::statistics::mean(values)
}

/// Polynomial regression: y = a0 + a1*x + a2*x^2 + ... + an*x^n
///
/// Uses Vandermonde normal equations (X^T X a = X^T y) with Gaussian elimination.
/// Degree 1 delegates to [`linear_regression`].
/// Degree is clamped to `[2, 6]` for numerical stability.
/// Coefficients: `[a0, a1, ..., an]`.
#[must_use]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::needless_range_loop
)]
pub fn polynomial_regression(
    data: &[Point],
    degree: u32,
    options: &RegressionOptions,
) -> RegressionOutput {
    let precision = options.precision.unwrap_or(4);

    // Degree 1 -> delegate
    if degree <= 1 {
        return linear_regression(data, options);
    }

    // Clamp to [2, 6]
    let clamped = degree.clamp(2, 6) as usize;

    if data.is_empty() {
        return RegressionOutput {
            method: if clamped == 2 {
                RegressionMethod::Quad
            } else {
                RegressionMethod::Poly
            },
            order: Some(clamped as u32),
            coefficients: vec![f64::NAN; clamped + 1],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN".to_string(),
        };
    }

    let num_coeffs = clamped + 1;

    // Build X^T * X matrix (normal equations)
    let mut xtx = vec![vec![0.0; num_coeffs]; num_coeffs];
    for i in 0..num_coeffs {
        for j in 0..num_coeffs {
            let mut s = 0.0;
            for p in data {
                s += p.x.powi((i + j) as i32);
            }
            xtx[i][j] = s;
        }
    }

    // Build X^T * y vector
    let mut xty = vec![0.0; num_coeffs];
    for i in 0..num_coeffs {
        let mut s = 0.0;
        for p in data {
            s += p.x.powi(i as i32) * p.y;
        }
        xty[i] = s;
    }

    // Solve
    let method = if clamped == 2 {
        RegressionMethod::Quad
    } else {
        RegressionMethod::Poly
    };

    if let Some(coefficients) = gaussian_elimination(&mut xtx, &mut xty) {
        let coeffs_clone = coefficients.clone();
        let predict = move |x: f64| -> f64 { poly_eval(&coeffs_clone, x) };
        let r_squared = calculate_r_squared(data, &predict);
        let points = generate_points(data, &predict, options);
        let equation = build_poly_equation(&coefficients, precision);

        RegressionOutput {
            method,
            order: Some(clamped as u32),
            coefficients,
            r_squared,
            points,
            equation,
        }
    } else {
        // Singular matrix -> return average y
        let y_values: Vec<f64> = data.iter().map(|p| p.y).collect();
        let avg_y = mean(&y_values);
        RegressionOutput {
            method,
            order: Some(clamped as u32),
            coefficients: vec![0.0; clamped + 1],
            r_squared: 0.0,
            points: data.iter().map(|p| Point { x: p.x, y: avg_y }).collect(),
            equation: format!("y = {}", round_coef(avg_y, precision)),
        }
    }
}

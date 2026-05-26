//! Regression functions for chart trendlines.
//!
//! Supports linear, polynomial, exponential, logarithmic, and power
//! regression, plus simple moving average.
//!
//! Ported from `charts/src/math/regression.ts`.
//! All functions are pure — no closures in output (wire-safe for WASM).

use serde::{Deserialize, Serialize};

use crate::{Point, RegressionMethod, RegressionOutput};

// =============================================================================
// Public types
// =============================================================================

/// Options for regression calculations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegressionOptions {
    /// Number of points to generate for rendering (default: 50).
    pub num_points: Option<usize>,
    /// Minimum x value for generated points (default: min of data).
    pub min_x: Option<f64>,
    /// Maximum x value for generated points (default: max of data).
    pub max_x: Option<f64>,
    /// Precision for equation display (default: 4 significant digits).
    pub precision: Option<usize>,
}

impl Default for RegressionOptions {
    fn default() -> Self {
        Self {
            num_points: Some(50),
            min_x: None,
            max_x: None,
            precision: Some(4),
        }
    }
}

/// Result of a moving-average computation.
#[derive(Debug, Clone)]
pub struct MovingAverageResult {
    /// Points representing the moving average.
    pub points: Vec<Point>,
}

// =============================================================================
// Private helpers
// =============================================================================

/// Safe min of a slice (no stack overflow for large slices).
fn safe_min(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::INFINITY, f64::min)
}

/// Safe max of a slice.
fn safe_max(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
}

/// Arithmetic mean of a slice (delegates to `crate::statistics::mean`).
fn mean(values: &[f64]) -> f64 {
    crate::statistics::mean(values)
}

/// Format a coefficient with `precision` significant digits.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn round_coef(value: f64, precision: usize) -> String {
    if value.abs() < 10_f64.powi(-(precision as i32)) {
        return "0".to_string();
    }
    format_significant(value, precision)
}

/// Emulate JavaScript's `Number.prototype.toPrecision(n)`.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss
)]
fn format_significant(value: f64, precision: usize) -> String {
    if precision == 0 || value == 0.0 {
        return "0".to_string();
    }

    let abs = value.abs();
    let exp = abs.log10().floor() as i32;
    let decimal_places = if (precision as i32) > exp + 1 {
        (precision as i32 - exp - 1) as usize
    } else {
        0
    };

    // For very small numbers use exponential notation
    if exp < -(precision as i32) {
        return format!("{:.*e}", precision.saturating_sub(1), value);
    }

    format!("{value:.decimal_places$}")
}

/// Gaussian elimination with partial pivoting.
///
/// Solves the system Ax = b in-place.
/// Returns `None` if the matrix is singular.
#[allow(clippy::many_single_char_names, clippy::needless_range_loop)]
fn gaussian_elimination(a: &mut [Vec<f64>], b: &mut [f64]) -> Option<Vec<f64>> {
    let n = a.len();
    if n == 0 {
        return Some(vec![]);
    }

    // Build augmented matrix [A | b]
    let mut aug: Vec<Vec<f64>> = a
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let mut r = row.clone();
            r.push(b[i]);
            r
        })
        .collect();

    // Forward elimination with partial pivoting
    for col in 0..n {
        // Find pivot row
        let mut max_row = col;
        for row in (col + 1)..n {
            if aug[row][col].abs() > aug[max_row][col].abs() {
                max_row = row;
            }
        }
        aug.swap(col, max_row);

        // Singular check
        if aug[col][col].abs() < 1e-10 {
            return None;
        }

        // Eliminate below pivot
        for row in (col + 1)..n {
            let factor = aug[row][col] / aug[col][col];
            for j in col..=n {
                aug[row][j] -= factor * aug[col][j];
            }
        }
    }

    // Back substitution
    let mut x = vec![0.0; n];
    for row in (0..n).rev() {
        let mut s = aug[row][n];
        for col in (row + 1)..n {
            s -= aug[row][col] * x[col];
        }
        if aug[row][row].abs() < 1e-10 {
            return None;
        }
        x[row] = s / aug[row][row];
    }

    Some(x)
}

/// Calculate R-squared (coefficient of determination).
///
/// R^2 = 1 - `SS_res` / `SS_tot`, clamped to [0, 1] for Excel compatibility.
fn calculate_r_squared(data: &[Point], predict: &dyn Fn(f64) -> f64) -> f64 {
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

/// Generate evenly-spaced predicted points for rendering a trendline.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn generate_points(
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

/// Evaluate a polynomial with coefficients [a0, a1, ..., an] at x.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn poly_eval(coefficients: &[f64], x: f64) -> f64 {
    let mut y = 0.0;
    for (i, &c) in coefficients.iter().enumerate() {
        y += c * x.powi(i as i32);
    }
    y
}

/// Build a polynomial equation string from coefficients.
fn build_poly_equation(coefficients: &[f64], precision: usize) -> String {
    let mut terms = Vec::new();

    for i in (0..coefficients.len()).rev() {
        let coef = coefficients[i];
        if coef.abs() < 1e-10 {
            continue;
        }
        let coef_str = round_coef(coef.abs(), precision);
        let sign = if coef >= 0.0 { "+" } else { "-" };

        if i == 0 {
            terms.push(format!("{sign} {coef_str}"));
        } else if i == 1 {
            terms.push(format!("{sign} {coef_str}x"));
        } else {
            terms.push(format!("{sign} {coef_str}x^{i}"));
        }
    }

    if terms.is_empty() {
        return "y = 0".to_string();
    }

    let joined = terms.join(" ");
    let trimmed = joined.trim_start_matches("+ ").trim_start();
    format!("y = {trimmed}")
}

// =============================================================================
// Public regression functions
// =============================================================================

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

/// Exponential regression: y = a * e^(bx)
///
/// Linearises via ln(y) = ln(a) + b*x, then delegates to [`linear_regression`].
/// Non-positive y values are filtered out.
/// Coefficients: `[a, b]`.
#[must_use]
pub fn exponential_regression(data: &[Point], options: &RegressionOptions) -> RegressionOutput {
    let precision = options.precision.unwrap_or(4);

    if data.is_empty() {
        return RegressionOutput {
            method: RegressionMethod::Exp,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN".to_string(),
        };
    }

    // Filter out non-positive y
    let valid: Vec<Point> = data.iter().filter(|p| p.y > 0.0).copied().collect();
    if valid.len() < 2 {
        return RegressionOutput {
            method: RegressionMethod::Exp,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN (requires positive y values)".to_string(),
        };
    }

    // Transform: ln(y) = ln(a) + b*x
    let transformed: Vec<Point> = valid
        .iter()
        .map(|p| Point {
            x: p.x,
            y: p.y.ln(),
        })
        .collect();

    let linear = linear_regression(&transformed, &RegressionOptions::default());
    let ln_a = linear.coefficients[0]; // intercept
    let b = linear.coefficients[1]; // slope
    let a = ln_a.exp();

    let predict = move |x: f64| -> f64 { a * (b * x).exp() };
    let r_squared = calculate_r_squared(&valid, &predict);
    let points = generate_points(data, &predict, options);

    let a_str = round_coef(a, precision);
    let b_str = round_coef(b, precision);
    let equation = format!("y = {a_str} * e^({b_str}x)");

    RegressionOutput {
        method: RegressionMethod::Exp,
        order: None,
        coefficients: vec![a, b],
        r_squared,
        points,
        equation,
    }
}

/// Logarithmic regression: y = a + b * ln(x)
///
/// Linearises by substituting ln(x) for x, then delegates to [`linear_regression`].
/// Non-positive x values are filtered out.
/// Coefficients: `[a, b]`.
#[must_use]
pub fn logarithmic_regression(data: &[Point], options: &RegressionOptions) -> RegressionOutput {
    let precision = options.precision.unwrap_or(4);

    if data.is_empty() {
        return RegressionOutput {
            method: RegressionMethod::Log,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN".to_string(),
        };
    }

    // Filter out non-positive x
    let valid: Vec<Point> = data.iter().filter(|p| p.x > 0.0).copied().collect();
    if valid.len() < 2 {
        return RegressionOutput {
            method: RegressionMethod::Log,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN (requires positive x values)".to_string(),
        };
    }

    // Transform: y = a + b * ln(x) -> linear with ln(x) as x
    let transformed: Vec<Point> = valid
        .iter()
        .map(|p| Point {
            x: p.x.ln(),
            y: p.y,
        })
        .collect();

    let linear = linear_regression(&transformed, &RegressionOptions::default());
    let a = linear.coefficients[0]; // intercept
    let b = linear.coefficients[1]; // slope

    let predict = move |x: f64| -> f64 {
        if x <= 0.0 {
            return f64::NAN;
        }
        a + b * x.ln()
    };

    let r_squared = calculate_r_squared(&valid, &predict);

    // Generate points — only for positive x
    let x_values: Vec<f64> = data.iter().filter(|p| p.x > 0.0).map(|p| p.x).collect();
    let min_x = options
        .min_x
        .unwrap_or_else(|| safe_min(&x_values).max(0.001));
    let max_x = options.max_x.unwrap_or_else(|| safe_max(&x_values));
    let gen_opts = RegressionOptions {
        min_x: Some(min_x),
        max_x: Some(max_x),
        ..options.clone()
    };
    let points = generate_points(data, &predict, &gen_opts);

    let a_str = round_coef(a, precision);
    let b_abs_str = round_coef(b.abs(), precision);
    let sign = if b >= 0.0 { "+" } else { "-" };
    let equation = format!("y = {a_str} {sign} {b_abs_str} * ln(x)");

    RegressionOutput {
        method: RegressionMethod::Log,
        order: None,
        coefficients: vec![a, b],
        r_squared,
        points,
        equation,
    }
}

/// Power regression: y = a * x^b
///
/// Linearises via ln(y) = ln(a) + b*ln(x), then delegates to [`linear_regression`].
/// Non-positive x or y values are filtered out.
/// Coefficients: `[a, b]`.
#[must_use]
pub fn power_regression(data: &[Point], options: &RegressionOptions) -> RegressionOutput {
    let precision = options.precision.unwrap_or(4);

    if data.is_empty() {
        return RegressionOutput {
            method: RegressionMethod::Pow,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN".to_string(),
        };
    }

    // Filter out non-positive x or y
    let valid: Vec<Point> = data
        .iter()
        .filter(|p| p.x > 0.0 && p.y > 0.0)
        .copied()
        .collect();
    if valid.len() < 2 {
        return RegressionOutput {
            method: RegressionMethod::Pow,
            order: None,
            coefficients: vec![f64::NAN, f64::NAN],
            r_squared: f64::NAN,
            points: vec![],
            equation: "y = NaN (requires positive x and y values)".to_string(),
        };
    }

    // Transform: ln(y) = ln(a) + b * ln(x)
    let transformed: Vec<Point> = valid
        .iter()
        .map(|p| Point {
            x: p.x.ln(),
            y: p.y.ln(),
        })
        .collect();

    let linear = linear_regression(&transformed, &RegressionOptions::default());
    let ln_a = linear.coefficients[0];
    let b = linear.coefficients[1];
    let a = ln_a.exp();

    let predict = move |x: f64| -> f64 {
        if x <= 0.0 {
            return f64::NAN;
        }
        a * x.powf(b)
    };

    let r_squared = calculate_r_squared(&valid, &predict);

    // Generate points — only for positive x
    let x_values: Vec<f64> = data.iter().filter(|p| p.x > 0.0).map(|p| p.x).collect();
    let min_x = options
        .min_x
        .unwrap_or_else(|| safe_min(&x_values).max(0.001));
    let max_x = options.max_x.unwrap_or_else(|| safe_max(&x_values));
    let gen_opts = RegressionOptions {
        min_x: Some(min_x),
        max_x: Some(max_x),
        ..options.clone()
    };
    let points = generate_points(data, &predict, &gen_opts);

    let a_str = round_coef(a, precision);
    let b_str = round_coef(b, precision);
    let equation = format!("y = {a_str} * x^{b_str}");

    RegressionOutput {
        method: RegressionMethod::Pow,
        order: None,
        coefficients: vec![a, b],
        r_squared,
        points,
        equation,
    }
}

/// Simple Moving Average (SMA) with trailing window.
///
/// Returns empty if `data.len() < period` or `period < 1`.
#[must_use]
pub fn moving_average(data: &[Point], period: usize) -> MovingAverageResult {
    if period < 1 || data.len() < period {
        return MovingAverageResult { points: vec![] };
    }

    let mut points = Vec::with_capacity(data.len() - period + 1);

    for i in (period - 1)..data.len() {
        let mut sum_y = 0.0;
        for j in 0..period {
            sum_y += data[i - j].y;
        }
        // Trailing x (the current point's x) for Excel compatibility
        points.push(Point {
            x: data[i].x,
            y: sum_y / period as f64,
        });
    }

    MovingAverageResult { points }
}

/// Dispatch to the appropriate regression function based on method.
#[must_use]
pub fn create_regression(
    data: &[Point],
    method: RegressionMethod,
    degree: u32,
    options: &RegressionOptions,
) -> RegressionOutput {
    match method {
        RegressionMethod::Linear => linear_regression(data, options),
        RegressionMethod::Log => logarithmic_regression(data, options),
        RegressionMethod::Exp => exponential_regression(data, options),
        RegressionMethod::Pow => power_regression(data, options),
        RegressionMethod::Quad => polynomial_regression(data, 2, options),
        RegressionMethod::Poly => polynomial_regression(data, degree, options),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f64 = 1e-6;

    fn pts(pairs: &[(f64, f64)]) -> Vec<Point> {
        pairs.iter().map(|&(x, y)| Point { x, y }).collect()
    }

    fn default_opts() -> RegressionOptions {
        RegressionOptions::default()
    }

    // -------------------------------------------------------------------------
    // Linear regression
    // -------------------------------------------------------------------------

    #[test]
    fn linear_perfect_line() {
        // y = 2x + 1
        let data = pts(&[(1.0, 3.0), (2.0, 5.0), (3.0, 7.0), (4.0, 9.0)]);
        let result = linear_regression(&data, &default_opts());

        assert!(
            (result.coefficients[0] - 1.0).abs() < EPS,
            "intercept should be 1"
        );
        assert!(
            (result.coefficients[1] - 2.0).abs() < EPS,
            "slope should be 2"
        );
        assert!((result.r_squared - 1.0).abs() < EPS, "R^2 should be 1");
        assert_eq!(result.method, RegressionMethod::Linear);
    }

    #[test]
    fn linear_horizontal_line() {
        // y = 5 (constant)
        let data = pts(&[(1.0, 5.0), (2.0, 5.0), (3.0, 5.0)]);
        let result = linear_regression(&data, &default_opts());

        assert!(
            (result.coefficients[0] - 5.0).abs() < EPS,
            "intercept should be 5"
        );
        assert!(
            (result.coefficients[1] - 0.0).abs() < EPS,
            "slope should be 0"
        );
        assert!(
            (result.r_squared - 1.0).abs() < EPS,
            "R^2 should be 1 (perfect constant)"
        );
    }

    #[test]
    fn linear_single_point() {
        let data = pts(&[(3.0, 7.0)]);
        let result = linear_regression(&data, &default_opts());

        assert!((result.coefficients[0] - 7.0).abs() < EPS);
        assert!((result.coefficients[1] - 0.0).abs() < EPS);
        assert!((result.r_squared - 1.0).abs() < EPS);
        assert_eq!(result.points.len(), 1);
    }

    #[test]
    fn linear_empty_data() {
        let data: Vec<Point> = vec![];
        let result = linear_regression(&data, &default_opts());

        assert!(result.coefficients[0].is_nan());
        assert!(result.coefficients[1].is_nan());
        assert!(result.r_squared.is_nan());
        assert!(result.points.is_empty());
    }

    #[test]
    fn linear_same_x_values() {
        // All x = 2, y varies -> degenerate
        let data = pts(&[(2.0, 1.0), (2.0, 3.0), (2.0, 5.0)]);
        let result = linear_regression(&data, &default_opts());

        // Should return average y = 3
        assert!((result.coefficients[0] - 3.0).abs() < EPS);
        assert!((result.coefficients[1] - 0.0).abs() < EPS);
        assert!((result.r_squared - 0.0).abs() < EPS);
    }

    #[test]
    fn linear_noisy_data() {
        // Roughly y = x + noise
        let data = pts(&[(1.0, 1.2), (2.0, 1.9), (3.0, 3.1), (4.0, 3.8), (5.0, 5.2)]);
        let result = linear_regression(&data, &default_opts());

        // R^2 should be high but not exactly 1
        assert!(result.r_squared > 0.98);
        assert!(result.r_squared <= 1.0);
        // Slope should be close to 1
        assert!((result.coefficients[1] - 1.0).abs() < 0.1);
    }

    #[test]
    fn linear_generates_50_points_by_default() {
        let data = pts(&[(0.0, 0.0), (10.0, 10.0)]);
        let result = linear_regression(&data, &default_opts());
        assert_eq!(result.points.len(), 50);
    }

    // -------------------------------------------------------------------------
    // Polynomial regression
    // -------------------------------------------------------------------------

    #[test]
    fn poly_perfect_quadratic() {
        // y = x^2
        let data = pts(&[(0.0, 0.0), (1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0)]);
        let result = polynomial_regression(&data, 2, &default_opts());

        // coefficients: [a0, a1, a2] ~ [0, 0, 1]
        assert!((result.coefficients[0] - 0.0).abs() < EPS, "a0 should be 0");
        assert!((result.coefficients[1] - 0.0).abs() < EPS, "a1 should be 0");
        assert!((result.coefficients[2] - 1.0).abs() < EPS, "a2 should be 1");
        assert!((result.r_squared - 1.0).abs() < EPS);
        assert_eq!(result.method, RegressionMethod::Quad);
        assert_eq!(result.order, Some(2));
    }

    #[test]
    fn poly_known_cubic() {
        // y = x^3 - 2x^2 + x + 1
        let data: Vec<Point> = (0..=5)
            .map(|i| {
                let x = i as f64;
                let y = x.powi(3) - 2.0 * x.powi(2) + x + 1.0;
                Point { x, y }
            })
            .collect();
        let result = polynomial_regression(&data, 3, &default_opts());

        // coefficients: [1, 1, -2, 1]
        assert!((result.coefficients[0] - 1.0).abs() < 1e-4, "a0 ~ 1");
        assert!((result.coefficients[1] - 1.0).abs() < 1e-4, "a1 ~ 1");
        assert!((result.coefficients[2] - (-2.0)).abs() < 1e-4, "a2 ~ -2");
        assert!((result.coefficients[3] - 1.0).abs() < 1e-4, "a3 ~ 1");
        assert!((result.r_squared - 1.0).abs() < EPS);
        assert_eq!(result.method, RegressionMethod::Poly);
        assert_eq!(result.order, Some(3));
    }

    #[test]
    fn poly_degree_1_delegates_to_linear() {
        let data = pts(&[(1.0, 3.0), (2.0, 5.0), (3.0, 7.0)]);
        let result = polynomial_regression(&data, 1, &default_opts());

        assert_eq!(result.method, RegressionMethod::Linear);
        assert!((result.coefficients[1] - 2.0).abs() < EPS);
    }

    #[test]
    fn poly_empty_data() {
        let data: Vec<Point> = vec![];
        let result = polynomial_regression(&data, 3, &default_opts());

        assert!(result.coefficients[0].is_nan());
        assert!(result.r_squared.is_nan());
        assert!(result.points.is_empty());
    }

    #[test]
    fn poly_degree_clamped_to_6() {
        // degree=10 should be clamped to 6
        let data: Vec<Point> = (0..=10)
            .map(|i| {
                let x = i as f64;
                Point { x, y: x * x }
            })
            .collect();
        let result = polynomial_regression(&data, 10, &default_opts());
        assert_eq!(result.order, Some(6));
    }

    #[test]
    fn poly_quadratic_with_intercept() {
        // y = 2x^2 + 3x + 1
        let data: Vec<Point> = (0..=4)
            .map(|i| {
                let x = i as f64;
                Point {
                    x,
                    y: 2.0 * x * x + 3.0 * x + 1.0,
                }
            })
            .collect();
        let result = polynomial_regression(&data, 2, &default_opts());

        assert!((result.coefficients[0] - 1.0).abs() < 1e-4, "a0 ~ 1");
        assert!((result.coefficients[1] - 3.0).abs() < 1e-4, "a1 ~ 3");
        assert!((result.coefficients[2] - 2.0).abs() < 1e-4, "a2 ~ 2");
    }

    // -------------------------------------------------------------------------
    // Exponential regression
    // -------------------------------------------------------------------------

    #[test]
    fn exp_known_curve() {
        // y = 2 * e^(0.5x)
        let data: Vec<Point> = (0..=5)
            .map(|i| {
                let x = i as f64;
                Point {
                    x,
                    y: 2.0 * (0.5 * x).exp(),
                }
            })
            .collect();
        let result = exponential_regression(&data, &default_opts());

        assert!((result.coefficients[0] - 2.0).abs() < 0.01, "a ~ 2");
        assert!((result.coefficients[1] - 0.5).abs() < 0.01, "b ~ 0.5");
        assert!((result.r_squared - 1.0).abs() < 1e-4);
        assert_eq!(result.method, RegressionMethod::Exp);
    }

    #[test]
    fn exp_empty_data() {
        let result = exponential_regression(&[], &default_opts());
        assert!(result.r_squared.is_nan());
        assert!(result.points.is_empty());
    }

    #[test]
    fn exp_filters_negative_y() {
        // Mix of positive and negative y; negatives are filtered
        let data = pts(&[(1.0, -1.0), (2.0, 4.0), (3.0, 8.0), (4.0, 16.0)]);
        let result = exponential_regression(&data, &default_opts());
        // Should still compute (3 valid points)
        assert!(!result.r_squared.is_nan());
    }

    #[test]
    fn exp_all_negative_y_returns_nan() {
        let data = pts(&[(1.0, -1.0), (2.0, -2.0)]);
        let result = exponential_regression(&data, &default_opts());
        assert!(result.r_squared.is_nan());
    }

    // -------------------------------------------------------------------------
    // Logarithmic regression
    // -------------------------------------------------------------------------

    #[test]
    fn log_known_curve() {
        // y = 3 + 2 * ln(x)
        let data: Vec<Point> = (1..=6)
            .map(|i| {
                let x = i as f64;
                Point {
                    x,
                    y: 3.0 + 2.0 * x.ln(),
                }
            })
            .collect();
        let result = logarithmic_regression(&data, &default_opts());

        assert!((result.coefficients[0] - 3.0).abs() < 0.01, "a ~ 3");
        assert!((result.coefficients[1] - 2.0).abs() < 0.01, "b ~ 2");
        assert!((result.r_squared - 1.0).abs() < 1e-4);
        assert_eq!(result.method, RegressionMethod::Log);
    }

    #[test]
    fn log_empty_data() {
        let result = logarithmic_regression(&[], &default_opts());
        assert!(result.r_squared.is_nan());
    }

    #[test]
    fn log_filters_nonpositive_x() {
        let data = pts(&[(-1.0, 5.0), (0.0, 3.0), (1.0, 3.0), (2.0, 4.4)]);
        let result = logarithmic_regression(&data, &default_opts());
        // Only 2 valid points (x=1, x=2) — just enough
        assert!(!result.r_squared.is_nan());
    }

    // -------------------------------------------------------------------------
    // Power regression
    // -------------------------------------------------------------------------

    #[test]
    fn pow_known_curve() {
        // y = 2 * x^3
        let data: Vec<Point> = (1..=5)
            .map(|i| {
                let x = i as f64;
                Point {
                    x,
                    y: 2.0 * x.powi(3),
                }
            })
            .collect();
        let result = power_regression(&data, &default_opts());

        assert!((result.coefficients[0] - 2.0).abs() < 0.01, "a ~ 2");
        assert!((result.coefficients[1] - 3.0).abs() < 0.01, "b ~ 3");
        assert!((result.r_squared - 1.0).abs() < 1e-4);
        assert_eq!(result.method, RegressionMethod::Pow);
    }

    #[test]
    fn pow_empty_data() {
        let result = power_regression(&[], &default_opts());
        assert!(result.r_squared.is_nan());
    }

    #[test]
    fn pow_filters_nonpositive() {
        let data = pts(&[(-1.0, 5.0), (0.0, 0.0), (1.0, 2.0), (2.0, 16.0)]);
        let result = power_regression(&data, &default_opts());
        // Only x=1 and x=2 are valid (positive x and y)
        assert!(!result.r_squared.is_nan());
    }

    #[test]
    fn pow_all_invalid_returns_nan() {
        let data = pts(&[(-1.0, -5.0), (0.0, 0.0)]);
        let result = power_regression(&data, &default_opts());
        assert!(result.r_squared.is_nan());
    }

    // -------------------------------------------------------------------------
    // Moving average
    // -------------------------------------------------------------------------

    #[test]
    fn ma_period_3() {
        let data = pts(&[
            (1.0, 10.0),
            (2.0, 20.0),
            (3.0, 30.0),
            (4.0, 40.0),
            (5.0, 50.0),
        ]);
        let result = moving_average(&data, 3);

        assert_eq!(result.points.len(), 3);
        // First window: (10+20+30)/3 = 20
        assert!((result.points[0].x - 3.0).abs() < EPS);
        assert!((result.points[0].y - 20.0).abs() < EPS);
        // Second window: (20+30+40)/3 = 30
        assert!((result.points[1].x - 4.0).abs() < EPS);
        assert!((result.points[1].y - 30.0).abs() < EPS);
        // Third window: (30+40+50)/3 = 40
        assert!((result.points[2].x - 5.0).abs() < EPS);
        assert!((result.points[2].y - 40.0).abs() < EPS);
    }

    #[test]
    fn ma_period_greater_than_data() {
        let data = pts(&[(1.0, 10.0), (2.0, 20.0)]);
        let result = moving_average(&data, 5);
        assert!(result.points.is_empty());
    }

    #[test]
    fn ma_period_equal_to_data() {
        let data = pts(&[(1.0, 2.0), (2.0, 4.0), (3.0, 6.0)]);
        let result = moving_average(&data, 3);
        assert_eq!(result.points.len(), 1);
        assert!((result.points[0].y - 4.0).abs() < EPS);
    }

    #[test]
    fn ma_period_1_returns_identity() {
        let data = pts(&[(1.0, 5.0), (2.0, 10.0), (3.0, 15.0)]);
        let result = moving_average(&data, 1);
        assert_eq!(result.points.len(), 3);
        assert!((result.points[0].y - 5.0).abs() < EPS);
        assert!((result.points[1].y - 10.0).abs() < EPS);
        assert!((result.points[2].y - 15.0).abs() < EPS);
    }

    // -------------------------------------------------------------------------
    // create_regression dispatch
    // -------------------------------------------------------------------------

    #[test]
    fn dispatch_linear() {
        let data = pts(&[(1.0, 2.0), (2.0, 4.0), (3.0, 6.0)]);
        let result = create_regression(&data, RegressionMethod::Linear, 0, &default_opts());
        assert_eq!(result.method, RegressionMethod::Linear);
        assert!((result.coefficients[1] - 2.0).abs() < EPS);
    }

    #[test]
    fn dispatch_quad() {
        let data = pts(&[(0.0, 0.0), (1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0)]);
        let result = create_regression(&data, RegressionMethod::Quad, 2, &default_opts());
        assert_eq!(result.method, RegressionMethod::Quad);
        assert_eq!(result.order, Some(2));
    }

    #[test]
    fn dispatch_poly() {
        let data: Vec<Point> = (0..=5)
            .map(|i| {
                let x = i as f64;
                Point { x, y: x.powi(3) }
            })
            .collect();
        let result = create_regression(&data, RegressionMethod::Poly, 3, &default_opts());
        assert_eq!(result.method, RegressionMethod::Poly);
        assert_eq!(result.order, Some(3));
    }

    #[test]
    fn dispatch_exp() {
        let data: Vec<Point> = (0..=3)
            .map(|i| {
                let x = i as f64;
                Point {
                    x,
                    y: (0.5 * x).exp(),
                }
            })
            .collect();
        let result = create_regression(&data, RegressionMethod::Exp, 0, &default_opts());
        assert_eq!(result.method, RegressionMethod::Exp);
    }

    #[test]
    fn dispatch_log() {
        let data: Vec<Point> = (1..=5)
            .map(|i| {
                let x = i as f64;
                Point { x, y: x.ln() }
            })
            .collect();
        let result = create_regression(&data, RegressionMethod::Log, 0, &default_opts());
        assert_eq!(result.method, RegressionMethod::Log);
    }

    #[test]
    fn dispatch_pow() {
        let data: Vec<Point> = (1..=5)
            .map(|i| {
                let x = i as f64;
                Point { x, y: x.powi(2) }
            })
            .collect();
        let result = create_regression(&data, RegressionMethod::Pow, 0, &default_opts());
        assert_eq!(result.method, RegressionMethod::Pow);
    }

    // -------------------------------------------------------------------------
    // Gaussian elimination
    // -------------------------------------------------------------------------

    #[test]
    fn gauss_simple_2x2() {
        // 2x + y = 5
        // x + 3y = 10
        // Solution: x = 1, y = 3
        let mut a = vec![vec![2.0, 1.0], vec![1.0, 3.0]];
        let mut b = vec![5.0, 10.0];
        let x = gaussian_elimination(&mut a, &mut b).unwrap();
        assert!((x[0] - 1.0).abs() < EPS);
        assert!((x[1] - 3.0).abs() < EPS);
    }

    #[test]
    fn gauss_singular_returns_none() {
        // Singular: rows are multiples
        let mut a = vec![vec![1.0, 2.0], vec![2.0, 4.0]];
        let mut b = vec![3.0, 6.0];
        assert!(gaussian_elimination(&mut a, &mut b).is_none());
    }

    // -------------------------------------------------------------------------
    // Edge cases and R^2 validation
    // -------------------------------------------------------------------------

    #[test]
    fn r_squared_clamped_to_0_1() {
        // Test that R^2 never goes negative (poor fit clamped to 0)
        let data = pts(&[(1.0, 100.0), (2.0, -50.0), (3.0, 200.0)]);
        let result = linear_regression(&data, &default_opts());
        assert!(result.r_squared >= 0.0);
        assert!(result.r_squared <= 1.0);
    }

    #[test]
    fn generate_points_custom_num() {
        let opts = RegressionOptions {
            num_points: Some(10),
            ..Default::default()
        };
        let data = pts(&[(0.0, 0.0), (10.0, 10.0)]);
        let result = linear_regression(&data, &opts);
        assert_eq!(result.points.len(), 10);
    }

    #[test]
    fn equation_string_format() {
        let data = pts(&[(1.0, 3.0), (2.0, 5.0), (3.0, 7.0)]);
        let result = linear_regression(&data, &default_opts());
        // y = 2x + 1 (approximately)
        assert!(result.equation.starts_with("y = "));
        assert!(result.equation.contains('x'));
    }

    // -------------------------------------------------------------------------
    // format_significant helper
    // -------------------------------------------------------------------------

    #[test]
    fn format_significant_basic() {
        assert_eq!(format_significant(1234.5, 4), "1234");
        assert_eq!(format_significant(1.2345, 4), "1.234");
        assert_eq!(format_significant(0.001234, 4), "0.001234");
        assert_eq!(format_significant(0.0, 4), "0");
    }

    #[test]
    fn round_coef_zero_threshold() {
        // Very small values should be "0"
        assert_eq!(round_coef(1e-10, 4), "0");
        // Normal values should show precision
        assert_eq!(round_coef(3.14159, 4), "3.142");
    }

    // -------------------------------------------------------------------------
    // Polynomial equation string
    // -------------------------------------------------------------------------

    #[test]
    fn poly_equation_string() {
        let data = pts(&[(0.0, 0.0), (1.0, 1.0), (2.0, 4.0), (3.0, 9.0), (4.0, 16.0)]);
        let result = polynomial_regression(&data, 2, &default_opts());
        // Should contain x^2
        assert!(
            result.equation.contains("x^2"),
            "equation: {}",
            result.equation
        );
    }

    // -------------------------------------------------------------------------
    // Options: min_x, max_x
    // -------------------------------------------------------------------------

    #[test]
    fn custom_min_max_x() {
        let data = pts(&[(1.0, 1.0), (5.0, 5.0)]);
        let opts = RegressionOptions {
            num_points: Some(5),
            min_x: Some(0.0),
            max_x: Some(10.0),
            precision: Some(4),
        };
        let result = linear_regression(&data, &opts);
        // First point should be at x=0
        assert!((result.points[0].x - 0.0).abs() < EPS);
        // Last point should be at x=10
        assert!((result.points.last().unwrap().x - 10.0).abs() < EPS);
    }
}

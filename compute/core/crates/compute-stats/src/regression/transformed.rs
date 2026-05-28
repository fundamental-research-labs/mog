use crate::{Point, RegressionMethod, RegressionOutput};

use super::format::round_coef;
use super::linear::linear_regression;
use super::metrics::calculate_r_squared;
use super::points::{generate_points, safe_max, safe_min};
use super::types::RegressionOptions;

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

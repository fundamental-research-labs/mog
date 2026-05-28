use crate::{Point, RegressionMethod};

use super::super::{exponential_regression, logarithmic_regression, power_regression};
use super::fixtures::{default_opts, pts};

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

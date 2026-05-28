use crate::{Point, RegressionMethod};

use super::super::polynomial_regression;
use super::fixtures::{EPS, default_opts, pts};

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

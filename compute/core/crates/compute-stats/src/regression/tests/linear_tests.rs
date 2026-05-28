use crate::{Point, RegressionMethod};

use super::super::linear_regression;
use super::fixtures::{EPS, default_opts, pts};

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

use crate::{Point, RegressionMethod};

use super::super::create_regression;
use super::fixtures::{EPS, default_opts, pts};

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

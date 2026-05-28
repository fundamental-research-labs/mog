use super::super::{RegressionOptions, linear_regression};
use super::fixtures::{EPS, pts};

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

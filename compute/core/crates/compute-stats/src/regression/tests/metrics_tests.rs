use super::super::linear_regression;
use super::fixtures::{default_opts, pts};

#[test]
fn r_squared_clamped_to_0_1() {
    // Test that R^2 never goes negative (poor fit clamped to 0)
    let data = pts(&[(1.0, 100.0), (2.0, -50.0), (3.0, 200.0)]);
    let result = linear_regression(&data, &default_opts());
    assert!(result.r_squared >= 0.0);
    assert!(result.r_squared <= 1.0);
}

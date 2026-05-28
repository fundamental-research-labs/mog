use super::super::format::{format_significant, round_coef};
use super::super::linear_regression;
use super::fixtures::{default_opts, pts};

#[test]
fn equation_string_format() {
    let data = pts(&[(1.0, 3.0), (2.0, 5.0), (3.0, 7.0)]);
    let result = linear_regression(&data, &default_opts());
    // y = 2x + 1 (approximately)
    assert!(result.equation.starts_with("y = "));
    assert!(result.equation.contains('x'));
}

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

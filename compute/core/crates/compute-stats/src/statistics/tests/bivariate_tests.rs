use super::*;

#[test]
fn test_covariance_empty() {
    assert!(covariance(&[], &[]).is_nan());
}

#[test]
fn test_covariance_mismatched_length() {
    assert!(covariance(&[1.0, 2.0], &[1.0]).is_nan());
}

#[test]
fn test_covariance_perfect_positive() {
    let x = [1.0, 2.0, 3.0, 4.0, 5.0];
    let y = [2.0, 4.0, 6.0, 8.0, 10.0];
    let cov = covariance(&x, &y);
    assert_approx!(cov, 4.0, 1e-10);
}

#[test]
fn test_sample_covariance_length_1() {
    assert!(sample_covariance(&[1.0], &[2.0]).is_nan());
}

#[test]
fn test_sample_covariance_basic() {
    let x = [1.0, 2.0, 3.0, 4.0, 5.0];
    let y = [2.0, 4.0, 6.0, 8.0, 10.0];
    assert_approx!(sample_covariance(&x, &y), 5.0, 1e-10);
}

#[test]
fn test_correlation_perfect_positive() {
    let x = [1.0, 2.0, 3.0, 4.0, 5.0];
    let y = [2.0, 4.0, 6.0, 8.0, 10.0];
    assert_approx!(correlation(&x, &y), 1.0, 1e-10);
}

#[test]
fn test_correlation_perfect_negative() {
    let x = [1.0, 2.0, 3.0, 4.0, 5.0];
    let y = [10.0, 8.0, 6.0, 4.0, 2.0];
    assert_approx!(correlation(&x, &y), -1.0, 1e-10);
}

#[test]
fn test_correlation_zero_std_dev() {
    let x = [3.0, 3.0, 3.0];
    let y = [1.0, 2.0, 3.0];
    assert!(correlation(&x, &y).is_nan());
}

#[test]
fn test_correlation_empty() {
    assert!(correlation(&[], &[]).is_nan());
}

// =========================================================================

#[test]
fn test_covariance_kahan_compensated() {
    // Large offset covariance — Kahan helps with the sum of products.
    let x: Vec<f64> = (1..=5).map(|i| 1e12 + i as f64).collect();
    let y: Vec<f64> = (1..=5).map(|i| 1e12 + 2.0 * i as f64).collect();
    let cov = covariance(&x, &y);
    // cov(x, y) = cov([1..5], [2,4,6,8,10]) = 4.0
    assert_approx!(cov, 4.0, 1e-4);
}

// =========================================================================
// First-principles: Covariance (population)
// =========================================================================

#[test]
fn test_covariance_positive_3elem() {
    // X=[1,2,3], Y=[2,4,6]: means 2,4
    // deviations: (-1)(-2)+(0)(0)+(1)(2) = 4; cov = 4/3
    let x = [1.0, 2.0, 3.0];
    let y = [2.0, 4.0, 6.0];
    assert_approx!(covariance(&x, &y), 4.0 / 3.0, 1e-10);
}

#[test]
fn test_covariance_negative_3elem() {
    // X=[1,2,3], Y=[6,4,2]: means 2,4
    // deviations: (-1)(2)+(0)(0)+(1)(-2) = -4; cov = -4/3
    let x = [1.0, 2.0, 3.0];
    let y = [6.0, 4.0, 2.0];
    assert_approx!(covariance(&x, &y), -4.0 / 3.0, 1e-10);
}

#[test]
fn test_covariance_uncorrelated() {
    // X=[1,2,3], Y=[1,1,1]: mean_y=1, all deviations in Y are 0
    let x = [1.0, 2.0, 3.0];
    let y = [1.0, 1.0, 1.0];
    assert_approx!(covariance(&x, &y), 0.0, 1e-10);
}

#[test]
fn test_covariance_single_element() {
    // Single element: both deviations are 0, so cov = 0
    let x = [5.0];
    let y = [10.0];
    assert_approx!(covariance(&x, &y), 0.0, 1e-10);
}

#[test]
fn test_covariance_length_mismatch() {
    assert!(covariance(&[1.0, 2.0, 3.0], &[1.0, 2.0]).is_nan());
}

// =========================================================================
// First-principles: Sample Covariance (N-1)
// =========================================================================

#[test]
fn test_sample_covariance_3elem() {
    // X=[1,2,3], Y=[2,4,6]: sum of deviation products = 4
    // sample_cov = 4 / (3-1) = 2.0
    let x = [1.0, 2.0, 3.0];
    let y = [2.0, 4.0, 6.0];
    assert_approx!(sample_covariance(&x, &y), 2.0, 1e-10);
}

#[test]
fn test_sample_covariance_empty() {
    assert!(sample_covariance(&[], &[]).is_nan());
}

#[test]
fn test_sample_covariance_length_mismatch() {
    assert!(sample_covariance(&[1.0, 2.0], &[1.0]).is_nan());
}

// =========================================================================
// First-principles: Correlation (Pearson)
// =========================================================================

#[test]
fn test_correlation_positive_3elem() {
    // X=[1,2,3], Y=[2,4,6]: perfectly linear => r = 1.0
    let x = [1.0, 2.0, 3.0];
    let y = [2.0, 4.0, 6.0];
    assert_approx!(correlation(&x, &y), 1.0, 1e-10);
}

#[test]
fn test_correlation_negative_3elem() {
    // X=[1,2,3], Y=[6,4,2]: perfectly negative linear => r = -1.0
    let x = [1.0, 2.0, 3.0];
    let y = [6.0, 4.0, 2.0];
    assert_approx!(correlation(&x, &y), -1.0, 1e-10);
}

#[test]
fn test_correlation_constant_y_is_nan() {
    // Y constant => std_y = 0 => NaN
    let x = [1.0, 2.0, 3.0];
    let y = [5.0, 5.0, 5.0];
    assert!(correlation(&x, &y).is_nan());
}

#[test]
fn test_correlation_self() {
    // corr(X, X) should always be 1.0
    let x = [1.0, 2.0, 3.0, 4.0, 5.0];
    assert_approx!(correlation(&x, &x), 1.0, 1e-10);
}

#[test]
fn test_correlation_self_negative_values() {
    let x = [-10.0, -5.0, 0.0, 5.0, 10.0];
    assert_approx!(correlation(&x, &x), 1.0, 1e-10);
}

#[test]
fn test_correlation_uncorrelated() {
    // Orthogonal data: corr should be 0
    // X = [-1, 0, 1], Y = [0, 1, 0]: mean_x=0, mean_y=1/3
    // cov = (-1)(-1/3) + (0)(2/3) + (1)(-1/3) = 1/3 - 1/3 = 0
    let x = [-1.0, 0.0, 1.0];
    let y = [0.0, 1.0, 0.0];
    assert_approx!(correlation(&x, &y), 0.0, 1e-10);
}

// =========================================================================
// First-principles: Variance edge cases
// =========================================================================

use super::*;
use std::f64::consts::PI;

#[test]
fn test_gaussian_kernel_at_zero() {
    assert_approx!(gaussian_kernel(0.0), 1.0 / (2.0 * PI).sqrt(), 1e-10);
}

#[test]
fn test_gaussian_kernel_symmetric() {
    assert_approx!(gaussian_kernel(1.0), gaussian_kernel(-1.0), 1e-15);
}

#[test]
fn test_gaussian_kernel_tails() {
    assert!(gaussian_kernel(3.0) > 0.0);
    assert!(gaussian_kernel(3.0) < 0.01);
}

#[test]
fn test_epanechnikov_kernel_at_zero() {
    assert_approx!(epanechnikov_kernel(0.0), 0.75);
}

#[test]
fn test_epanechnikov_kernel_at_boundary() {
    assert_approx!(epanechnikov_kernel(1.0), 0.0);
    assert_approx!(epanechnikov_kernel(-1.0), 0.0);
}

#[test]
fn test_epanechnikov_kernel_outside() {
    assert_approx!(epanechnikov_kernel(1.5), 0.0);
    assert_approx!(epanechnikov_kernel(-2.0), 0.0);
}

#[test]
fn test_triangular_kernel_at_zero() {
    assert_approx!(triangular_kernel(0.0), 1.0);
}

#[test]
fn test_triangular_kernel_at_boundary() {
    assert_approx!(triangular_kernel(1.0), 0.0);
    assert_approx!(triangular_kernel(-1.0), 0.0);
}

#[test]
fn test_triangular_kernel_outside() {
    assert_approx!(triangular_kernel(1.5), 0.0);
}

#[test]
fn test_triangular_kernel_midpoint() {
    assert_approx!(triangular_kernel(0.5), 0.5);
}

#[test]
fn test_uniform_kernel_inside() {
    assert_approx!(uniform_kernel(0.0), 0.5);
    assert_approx!(uniform_kernel(0.5), 0.5);
    assert_approx!(uniform_kernel(-0.99), 0.5);
}

#[test]
fn test_uniform_kernel_outside() {
    assert_approx!(uniform_kernel(1.5), 0.0);
    assert_approx!(uniform_kernel(-1.5), 0.0);
}

#[test]
fn test_uniform_kernel_at_boundary() {
    assert_approx!(uniform_kernel(1.0), 0.5);
    assert_approx!(uniform_kernel(-1.0), 0.5);
}

#[test]
fn test_biweight_kernel_at_zero() {
    assert_approx!(biweight_kernel(0.0), 15.0 / 16.0);
}

#[test]
fn test_biweight_kernel_at_boundary() {
    assert_approx!(biweight_kernel(1.0), 0.0);
    assert_approx!(biweight_kernel(-1.0), 0.0);
}

#[test]
fn test_biweight_kernel_outside() {
    assert_approx!(biweight_kernel(2.0), 0.0);
}

// =========================================================================
// Bandwidth estimators

#[test]
fn test_kernels_maximum_at_zero() {
    // All kernels achieve their maximum at u=0
    assert_approx!(gaussian_kernel(0.0), 1.0 / (2.0 * PI).sqrt(), 1e-10);
    assert_approx!(epanechnikov_kernel(0.0), 0.75, 1e-10);
    assert_approx!(triangular_kernel(0.0), 1.0, 1e-10);
    assert_approx!(uniform_kernel(0.0), 0.5, 1e-10);
    assert_approx!(biweight_kernel(0.0), 15.0 / 16.0, 1e-10);
}

#[test]
fn test_compact_support_kernels_zero_outside() {
    // Epanechnikov, Triangular, Uniform, Biweight all have compact support
    for u in &[1.5, 2.0, 10.0, 100.0] {
        assert_approx!(epanechnikov_kernel(*u), 0.0);
        assert_approx!(epanechnikov_kernel(-*u), 0.0);
        assert_approx!(triangular_kernel(*u), 0.0);
        assert_approx!(triangular_kernel(-*u), 0.0);
        assert_approx!(uniform_kernel(*u), 0.0);
        assert_approx!(uniform_kernel(-*u), 0.0);
        assert_approx!(biweight_kernel(*u), 0.0);
        assert_approx!(biweight_kernel(-*u), 0.0);
    }
}

#[test]
fn test_all_kernels_symmetric() {
    // K(u) = K(-u) for all kernels
    let test_points = [0.0, 0.1, 0.5, 0.99, 1.0, 2.0];
    for &u in &test_points {
        assert_approx!(gaussian_kernel(u), gaussian_kernel(-u), 1e-15);
        assert_approx!(epanechnikov_kernel(u), epanechnikov_kernel(-u), 1e-15);
        assert_approx!(triangular_kernel(u), triangular_kernel(-u), 1e-15);
        assert_approx!(uniform_kernel(u), uniform_kernel(-u), 1e-15);
        assert_approx!(biweight_kernel(u), biweight_kernel(-u), 1e-15);
    }
}

// =========================================================================
// First-principles: Binning
// =========================================================================

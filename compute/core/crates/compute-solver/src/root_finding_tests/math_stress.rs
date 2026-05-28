//! Mathematical stress cases for public root-finding behavior.

use super::fixtures::{DEFAULT_PRECISION, root_config};
use crate::root_finding::solve_root;

#[test]
fn logarithmic() {
    // f(x) = ln(x), target = 2, guess = 5 -> x = e^2 ~ 7.389
    let config = root_config(2.0, 5.0);
    let r = solve_root(|x: &[f64]| x[0].ln(), &config);
    assert!(r.converged);
    assert!((r.x[0] - std::f64::consts::E.powi(2)).abs() < DEFAULT_PRECISION);
}
#[test]
fn hyperbolic() {
    // tanh(x) = 0.5, guess = 0.3 -> x = atanh(0.5) ~ 0.5493
    let config = root_config(0.5, 0.3);
    let r = solve_root(|x: &[f64]| x[0].tanh(), &config);
    assert!(r.converged);
    assert!((r.x[0] - 0.5493).abs() < 0.001);
}
#[test]
fn high_degree_polynomial() {
    // f(x) = x^5 - x - 1, target = 0 -> x ~ 1.1673
    let config = root_config(0.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0].powi(5) - x[0] - 1.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 1.1673).abs() < 0.001);
}
#[test]
fn function_with_asymptote() {
    // tan(x) = 1, guess = 0.5 -> x = pi/4 ~ 0.7854
    let config = root_config(1.0, 0.5);
    let r = solve_root(|x: &[f64]| x[0].tan(), &config);
    assert!(r.converged);
    assert!((r.x[0] - std::f64::consts::FRAC_PI_4).abs() < DEFAULT_PRECISION);
}
#[test]
fn cubic_three_real_roots_near_1_5() {
    // f(x) = x^3 - 6x^2 + 11x - 6 = (x-1)(x-2)(x-3)
    // Roots at x = 1, 2, 3. Starting near 1.5 should find 1 or 2.
    let config = root_config(0.0, 1.5);
    let f = |x: &[f64]| {
        let v = x[0];
        v * v * v - 6.0 * v * v + 11.0 * v - 6.0
    };
    let r = solve_root(f, &config);
    assert!(r.converged, "should converge: {:?}", r);
    let x = r.x[0];
    // Must be a valid root: |f(x)| < tolerance
    let residual = (x * x * x - 6.0 * x * x + 11.0 * x - 6.0).abs();
    assert!(
        residual < DEFAULT_PRECISION,
        "residual {} too large",
        residual
    );
    // Should find root 1 or 2 (nearest to guess 1.5)
    assert!(
        (x - 1.0).abs() < 0.1 || (x - 2.0).abs() < 0.1,
        "expected root near 1 or 2, got {}",
        x
    );
}
#[test]
fn cubic_three_real_roots_near_2_5() {
    // f(x) = (x-1)(x-2)(x-3), starting near 2.5 should find 2 or 3.
    let config = root_config(0.0, 2.5);
    let f = |x: &[f64]| {
        let v = x[0];
        v * v * v - 6.0 * v * v + 11.0 * v - 6.0
    };
    let r = solve_root(f, &config);
    assert!(r.converged, "should converge: {:?}", r);
    let x = r.x[0];
    let residual = (x * x * x - 6.0 * x * x + 11.0 * x - 6.0).abs();
    assert!(
        residual < DEFAULT_PRECISION,
        "residual {} too large",
        residual
    );
    assert!(
        (x - 2.0).abs() < 0.1 || (x - 3.0).abs() < 0.1,
        "expected root near 2 or 3, got {}",
        x
    );
}
#[test]
fn wilkinson_like_close_roots() {
    // f(x) = (x-1)(x-2) = x^2 - 3x + 2. Roots at 1 and 2.
    // Tests numerical stability with close roots. Start from 1.5.
    let config = root_config(0.0, 1.5);
    let f = |x: &[f64]| {
        let v = x[0];
        (v - 1.0) * (v - 2.0)
    };
    let r = solve_root(f, &config);
    assert!(r.converged, "should converge: {:?}", r);
    let x = r.x[0];
    let residual = ((x - 1.0) * (x - 2.0)).abs();
    assert!(
        residual < DEFAULT_PRECISION,
        "residual {} too large",
        residual
    );
    assert!(
        (x - 1.0).abs() < 0.1 || (x - 2.0).abs() < 0.1,
        "expected root 1 or 2, got {}",
        x
    );
}
#[test]
fn very_steep_function_near_root() {
    // f(x) = 1e6 * (x - 1), target = 0. Root at x = 1.
    // Large coefficient tests step-size control.
    let config = root_config(0.0, 0.5);
    let r = solve_root(|x: &[f64]| 1e6 * (x[0] - 1.0), &config);
    assert!(r.converged, "should converge: {:?}", r);
    assert!(
        (r.x[0] - 1.0).abs() < 1e-4,
        "root should be ~1.0, got {}",
        r.x[0]
    );
    let residual = (1e6 * (r.x[0] - 1.0)).abs();
    assert!(
        residual < DEFAULT_PRECISION,
        "residual {} too large",
        residual
    );
}
#[test]
fn oscillating_sin_10x() {
    // f(x) = sin(10x), target = 0. Roots at x = k*pi/10.
    // Starting from 0.1, should find a nearby root.
    let config = root_config(0.0, 0.1);
    let r = solve_root(|x: &[f64]| (10.0 * x[0]).sin(), &config);
    assert!(r.converged, "should converge: {:?}", r);
    let residual = (10.0 * r.x[0]).sin().abs();
    assert!(
        residual < 1e-6,
        "|sin(10*x*)| = {} should be < 1e-6",
        residual
    );
}

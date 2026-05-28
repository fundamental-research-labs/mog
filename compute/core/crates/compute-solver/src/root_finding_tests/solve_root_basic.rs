//! Basic `solve_root` target-solving behavior.

use super::fixtures::{DEFAULT_PRECISION, root_config};
use crate::root_finding::solve_root;
use crate::types::{Objective, SolverConfig};

#[test]
fn linear_simple() {
    // f(x) = 2x, target = 10 -> x = 5
    let config = root_config(10.0, 0.0);
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn quadratic() {
    // f(x) = x^2, target = 9 -> x = 3 or x = -3
    let config = root_config(9.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 3.0).abs() < DEFAULT_PRECISION || (r.x[0] + 3.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn initial_guess_is_solution() {
    // f(x) = x^2, target = 25, guess = 5 -> already at solution
    let config = root_config(25.0, 5.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0], &config);
    assert!(r.converged);
    assert!(r.iters == 0);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn precision_tight() {
    // f(x) = 3x+7, target = 22, precision = 1e-10 -> x = 5
    let config = SolverConfig {
        objective: Objective::Target(22.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: 1e-10,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 3.0 * x[0] + 7.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < 1e-9);
}
#[test]
fn negative_solution() {
    // f(x) = x + 10, target = 3 -> x = -7
    let config = root_config(3.0, 0.0);
    let r = solve_root(|x: &[f64]| x[0] + 10.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - (-7.0)).abs() < DEFAULT_PRECISION);
}
#[test]
fn zero_solution() {
    // f(x) = 3x + 5, target = 5 -> x = 0
    let config = root_config(5.0, 1.0);
    let r = solve_root(|x: &[f64]| 3.0 * x[0] + 5.0, &config);
    assert!(r.converged);
    assert!(r.x[0].abs() < DEFAULT_PRECISION);
}
#[test]
fn large_solution() {
    // f(x) = x/1000, target = 500 -> x = 500000
    let config = SolverConfig {
        objective: Objective::Target(500.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: 1e-6,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0] / 1000.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 500_000.0).abs() < 1.0);
}
#[test]
fn custom_params() {
    let config = SolverConfig {
        objective: Objective::Target(11.0),
        x0: vec![0.0],
        max_evals: 50,
        ftol: 1e-8,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0] + 1.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < 1e-7);
}
#[test]
fn trigonometric() {
    // sin(x) = 0.5, guess = 0.3 -> x = pi/6 ~ 0.5236
    let config = root_config(0.5, 0.3);
    let r = solve_root(|x: &[f64]| x[0].sin(), &config);
    assert!(r.converged);
    assert!((r.fun - 0.5).abs() < DEFAULT_PRECISION);
}
#[test]
fn exponential() {
    // e^x = 10 -> x = ln(10) ~ 2.3026
    let config = root_config(10.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0].exp(), &config);
    assert!(r.converged);
    assert!((r.x[0] - 10.0_f64.ln()).abs() < DEFAULT_PRECISION);
}
#[test]
fn linear_negative_slope() {
    // -3x + 12 = 0 -> x = 4
    let config = root_config(0.0, 1.0);
    let r = solve_root(|x: &[f64]| -3.0 * x[0] + 12.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 4.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn reciprocal() {
    // 1/x = 0.25, guess = 3 -> x = 4
    let config = root_config(0.25, 3.0);
    let r = solve_root(|x: &[f64]| 1.0 / x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 4.0).abs() < 1e-4);
    assert!((r.fun - 0.25).abs() < DEFAULT_PRECISION);
}
#[test]
fn zero_guess() {
    // 2x + 1 = 11, guess = 0 -> x = 5
    let config = root_config(11.0, 0.0);
    let r = solve_root(|x: &[f64]| 2.0 * x[0] + 1.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn target_zero_true_root() {
    // f(x) = x^2 - 4, target = 0 -> x = 2 or x = -2
    let config = root_config(0.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] - 4.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 2.0).abs() < DEFAULT_PRECISION || (r.x[0] + 2.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn very_tight_precision() {
    // f(x) = x - 7, target = 0, precision = 1e-12
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![1.0],
        max_evals: 100,
        ftol: 1e-12,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0] - 7.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 7.0).abs() < 1e-11);
}
#[test]
fn multiple_roots_near_guess() {
    // sin(x) = 0, guess = 3.0 -> should find pi ~ 3.14159
    let config = root_config(0.0, 3.0);
    let r = solve_root(|x: &[f64]| x[0].sin(), &config);
    assert!(r.converged);
    assert!((r.x[0] - std::f64::consts::PI).abs() < DEFAULT_PRECISION);
}
#[test]
fn very_small_target() {
    // f(x) = 1000*x, target = 0.001 -> x = 1e-6
    let config = root_config(0.001, 0.0);
    let r = solve_root(|x: &[f64]| 1000.0 * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 1e-6).abs() < DEFAULT_PRECISION);
}
#[test]
fn cubic() {
    // f(x) = x^3, target = 27 -> x = 3
    let config = root_config(27.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 3.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn piecewise_linear() {
    // f(x) = max(x, 0), target = 5 -> x = 5
    let config = root_config(5.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0].max(0.0), &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
}
#[test]
fn solve_root_with_nonzero_target() {
    // f(x) = x^2, Target(9.0). Should find x=3 or x=-3 where f(x)=9.
    let config = root_config(9.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0], &config);
    assert!(r.converged, "should converge: {:?}", r);
    let achieved = r.x[0] * r.x[0];
    assert!(
        (achieved - 9.0).abs() < DEFAULT_PRECISION,
        "|f(x*) - 9| = {} should be < {}",
        (achieved - 9.0).abs(),
        DEFAULT_PRECISION
    );
}

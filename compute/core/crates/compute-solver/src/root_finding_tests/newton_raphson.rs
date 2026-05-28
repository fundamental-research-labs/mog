//! Newton-Raphson behavior with public `solve_root_nr`.

use super::fixtures::nr_config;
use crate::root_finding::solve_root_nr;
use crate::types::{Bound, Objective, SolverConfig};

#[test]
fn nr_cubic_root() {
    // x^3 - 8 = 0, f'(x) = 3x^2, root at x = 2
    let config = nr_config(1.0, 1e-12);
    let r = solve_root_nr(|x| x * x * x - 8.0, |x| 3.0 * x * x, &config, &[]);
    assert!(r.converged, "should converge: {:?}", r);
    assert!(
        (r.x[0] - 2.0).abs() < 1e-10,
        "root should be ~2.0, got {}",
        r.x[0]
    );
}
#[test]
fn nr_exponential() {
    // e^x - 10 = 0, f'(x) = e^x, root at x = ln(10)
    let config = nr_config(1.0, 1e-10);
    let r = solve_root_nr(|x| x.exp() - 10.0, |x| x.exp(), &config, &[]);
    assert!(r.converged);
    assert!((r.x[0] - 10.0_f64.ln()).abs() < 1e-8);
}
#[test]
fn nr_bad_guess_brent_fallback() {
    // x^2 - 4 = 0, root at x = 2. Start from 100.0 — NR may overshoot/diverge.
    // Brent fallback should find the root via probe grid.
    let config = nr_config(100.0, 1e-8);
    let r = solve_root_nr(|x| x * x - 4.0, |x| 2.0 * x, &config, &[]);
    assert!(r.converged, "should converge via Brent fallback: {:?}", r);
    assert!(
        (r.x[0] - 2.0).abs() < 1e-6 || (r.x[0] + 2.0).abs() < 1e-6,
        "root should be ±2, got {}",
        r.x[0]
    );
}
#[test]
fn nr_scale_adaptive_ftol() {
    // f(x) = 1000*x - 500, root at x = 0.5
    // With ftol = 1e-6, a residual of 1e-8 should be accepted
    let config = nr_config(0.0, 1e-6);
    let r = solve_root_nr(|x| 1000.0 * x - 500.0, |_| 1000.0, &config, &[]);
    assert!(r.converged);
    assert!((r.x[0] - 0.5).abs() < 1e-8);
}
#[test]
fn nr_multi_guess_finds_root() {
    // f(x) = x^3 - x + 0.1, has a root near x ≈ -1.046
    // Primary guess 10.0 diverges, but extra guess at -1.0 converges
    let config = nr_config(10.0, 1e-10);
    let r = solve_root_nr(
        |x| x * x * x - x + 0.1,
        |x| 3.0 * x * x - 1.0,
        &config,
        &[-1.0, 0.0, 1.0],
    );
    assert!(r.converged, "multi-guess should find root: {:?}", r);
}
#[test]
fn nr_already_at_root() {
    // f(0) = 0, should return immediately
    let config = nr_config(0.0, 1e-10);
    let r = solve_root_nr(|x| x * x, |x| 2.0 * x, &config, &[]);
    assert!(r.converged);
    assert!(r.x[0].abs() < 1e-10);
}
#[test]
fn nr_exact_derivative_cube_root_of_2() {
    // f(x) = x^3 - 2, f'(x) = 3x^2. Root at x = 2^(1/3) ~ 1.2599.
    // Newton-Raphson with exact derivative should converge very fast.
    let config = nr_config(1.0, 1e-12);
    let r = solve_root_nr(|x| x * x * x - 2.0, |x| 3.0 * x * x, &config, &[]);
    assert!(r.converged, "should converge: {:?}", r);
    let expected = 2.0_f64.powf(1.0 / 3.0);
    assert!(
        (r.x[0] - expected).abs() < 1e-10,
        "root should be 2^(1/3) ~ {}, got {}",
        expected,
        r.x[0]
    );
}
#[test]
fn nr_quadratic_convergence_sqrt2() {
    // f(x) = x^2 - 2, f'(x) = 2x. Root at sqrt(2) ~ 1.41421356.
    // With x0=2, NR converges quadratically.
    let config = nr_config(2.0, 1e-14);
    let r = solve_root_nr(|x| x * x - 2.0, |x| 2.0 * x, &config, &[]);
    assert!(r.converged, "should converge: {:?}", r);
    let expected = std::f64::consts::SQRT_2;
    assert!(
        (r.x[0] - expected).abs() < 1e-12,
        "root should be sqrt(2) ~ {}, got {}",
        expected,
        r.x[0]
    );
}
// f(x) = x^3 - 3x, f'(x) = 3x^2 - 3. f'(1) = 0 exactly.
// Starting NR from x0 = 1.0 should fail (zero derivative) and fall back.
// Roots at x = 0, +/-sqrt(3).
#[test]
fn nr_derivative_zero_fallback() {
    let config = nr_config(1.0, 1e-8);
    let r = solve_root_nr(|x| x * x * x - 3.0 * x, |x| 3.0 * x * x - 3.0, &config, &[]);
    assert!(r.converged, "should converge via Brent fallback: {:?}", r);
    let x = r.x[0];
    let residual = (x * x * x - 3.0 * x).abs();
    assert!(
        residual < 1e-6,
        "residual {} too large at x={}",
        residual,
        x
    );
}
// Variant: root IS in bounds but NR overshoots on first step, then Brent finds it.
// f(x) = x^3 - 3, f'(x) = 3x^2. Bounds [0, 20]. Root at x = 3^(1/3) ~ 1.4422.
// From x0 = 0.1: NR step = 0.1 - (0.001-3)/0.03 = 0.1 + 99.97 -> out of [0,20].
// NR fails, Brent probe grid has sign change: f(1)=-2 < 0, f(2)=5 > 0.
#[test]
fn nr_overshoot_brent_recovers() {
    let mut config = nr_config(0.1, 1e-8);
    config.bounds = vec![Bound::bounded(0.0, 20.0)];
    let r = solve_root_nr(|x| x * x * x - 3.0, |x| 3.0 * x * x, &config, &[]);
    let expected = 3.0_f64.powf(1.0 / 3.0);
    assert!(r.converged, "Brent should recover: {:?}", r);
    assert!(
        (r.x[0] - expected).abs() < 1e-6,
        "root should be ~{}, got {}",
        expected,
        r.x[0]
    );
}
// f(x) = x, f'(x) = 1. With probe grid including 0.0, f(0) = 0 exactly.
// brent_on_bracket should detect |fa| < ftol at the bracket endpoint.
#[test]
fn nr_brent_endpoint_already_converged() {
    let config = nr_config(5.0, 1e-8);
    // Primary NR from 5.0: f(5)=5, f'(5)=1, x1 = 5 - 5/1 = 0. f(0)=0. Converges immediately.
    let r = solve_root_nr(|x| x, |_x| 1.0, &config, &[]);
    assert!(r.converged, "should converge: {:?}", r);
    assert!(r.x[0].abs() < 1e-8, "root should be 0, got {}", r.x[0]);
}
// f(x) = x^5 - x - 1, f'(x) = 5x^4 - 1. Root ~ 1.1673.
// Start from x0=5.0 (far away). Extra guesses also far. NR may diverge,
// Brent finds bracket from probe grid and gets close, NR polishes.
#[test]
fn nr_brent_finds_then_nr_polishes() {
    let mut config = nr_config(5.0, 1e-12);
    config.bounds = vec![Bound::bounded(0.0, 10.0)];
    let r = solve_root_nr(
        |x| x.powi(5) - x - 1.0,
        |x| 5.0 * x.powi(4) - 1.0,
        &config,
        &[8.0, 9.0],
    );
    assert!(r.converged, "should converge: {:?}", r);
    let expected = 1.1673039782614187;
    assert!(
        (r.x[0] - expected).abs() < 1e-6,
        "root should be ~{}, got {}",
        expected,
        r.x[0]
    );
}
#[test]
fn nr_exact_zero_residual() {
    // f(x) = x^2 - 1, f'(x) = 2x. From x0 = 2: x1 = 2 - 3/4 = 1.25,
    // x2 = 1.25 - 0.5625/2.5 = 1.025, ... eventually lands on x=1 exactly.
    // But more directly: from x0 = 1.0, f(1) = 0 exactly.
    let config = nr_config(1.0, 1e-12);
    let r = solve_root_nr(|x| x * x - 1.0, |x| 2.0 * x, &config, &[]);
    assert!(r.converged, "should converge: {:?}", r);
    assert!(
        (r.x[0] - 1.0).abs() < 1e-12,
        "root should be exactly 1.0, got {}",
        r.x[0]
    );
}
#[test]
fn nr_unbounded_config() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.5],
        ftol: 1e-10,
        xtol: 1e-14,
        bounds: vec![], // no bounds at all
        max_evals: 2000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root_nr(|x| x * x - 9.0, |x| 2.0 * x, &config, &[]);
    assert!(r.converged, "should converge unbounded: {:?}", r);
    assert!(
        (r.x[0] - 3.0).abs() < 1e-8 || (r.x[0] + 3.0).abs() < 1e-8,
        "root should be +/-3, got {}",
        r.x[0]
    );
}

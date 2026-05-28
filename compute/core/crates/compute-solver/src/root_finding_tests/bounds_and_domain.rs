//! Bounds, singular domains, and financial-domain root finding behavior.

use super::fixtures::nr_config;
use crate::root_finding::{solve_root, solve_root_nr};
use crate::types::{Bound, Objective, SolverConfig};

#[test]
fn nr_domain_bounds_respected() {
    // f(x) = (1+x)^10 - 2, f'(x) = 10*(1+x)^9, root at x = 2^(1/10) - 1 ≈ 0.0718
    // Domain: x > -1 (singularity at x = -1)
    let mut config = nr_config(0.5, 1e-10);
    config.bounds = vec![Bound::lower(-1.0 + 1e-10)];
    let r = solve_root_nr(
        |x| (1.0 + x).powi(10) - 2.0,
        |x| 10.0 * (1.0 + x).powi(9),
        &config,
        &[],
    );
    assert!(r.converged);
    let expected = 2.0_f64.powf(0.1) - 1.0;
    assert!(
        (r.x[0] - expected).abs() < 1e-8,
        "got {} expected {}",
        r.x[0],
        expected
    );
    assert!(r.x[0] > -1.0, "should stay in domain");
}
#[test]
fn nr_cancellation_stress_xirr_like() {
    // Simulate XIRR-like cancellation: large terms summing to near-zero at root.
    //
    // f(x) = -10000 + 5000/(1+x)^0.5 + 8000/(1+x)^1.5
    // At x ≈ -0.453, this cancels to ~0. Individual terms are O(10000).
    //
    // With ftol = 1e-10 * 10000 = 1e-6, the scale-adaptive tolerance
    // should accept the root even if the residual is O(1e-10).
    let f = |x: f64| -> f64 {
        let base = 1.0 + x;
        if base <= 0.0 {
            return f64::NAN;
        }
        -10000.0 + 5000.0 / base.powf(0.5) + 8000.0 / base.powf(1.5)
    };
    let df = |x: f64| -> f64 {
        let base = 1.0 + x;
        if base <= 0.0 {
            return f64::NAN;
        }
        -0.5 * 5000.0 / base.powf(1.5) - 1.5 * 8000.0 / base.powf(2.5)
    };

    let scale = 10000.0;
    let mut config = nr_config(0.1, 1e-10 * scale);
    config.bounds = vec![Bound::lower(-1.0 + 1e-10)];

    let r = solve_root_nr(f, df, &config, &[-0.1, -0.3, -0.5, -0.7, -0.9]);
    assert!(r.converged, "cancellation stress: {:?}", r);
    // Verify the root makes f(root) ≈ 0
    let residual = f(r.x[0]).abs();
    assert!(residual < 1e-6 * scale, "residual {} too large", residual);
}
#[test]
fn financial_irr_like() {
    // f(r) = -1000 + 500/(1+r) + 600/(1+r)^2, find r where f(r) = 0.
    // Algebraically: 500(1+r) + 600 = 1000(1+r)^2
    // => 1000r^2 + 1500r - 100 = 0
    // => r = (-1500 + sqrt(1500^2 + 4*1000*100)) / (2*1000)
    //      = (-1500 + sqrt(2250000 + 400000)) / 2000
    //      = (-1500 + sqrt(2650000)) / 2000
    let discriminant = (1500.0_f64).powi(2) + 4.0 * 1000.0 * 100.0;
    let expected_r = (-1500.0 + discriminant.sqrt()) / 2000.0;

    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.1],
        max_evals: 200,
        ftol: 1e-8,
        max_time_ms: 0,
        root_finding_step_limit: 0.1,
        ..Default::default()
    };
    let f = |x: &[f64]| {
        let r = x[0];
        let d1 = 1.0 + r;
        -1000.0 + 500.0 / d1 + 600.0 / (d1 * d1)
    };
    let r = solve_root(f, &config);
    assert!(r.converged, "should converge: {:?}", r);
    assert!(
        (r.x[0] - expected_r).abs() < 1e-4,
        "expected IRR ~ {}, got {}",
        expected_r,
        r.x[0]
    );
    // Verify it's actually a root
    let d1 = 1.0 + r.x[0];
    let residual = (-1000.0 + 500.0 / d1 + 600.0 / (d1 * d1)).abs();
    assert!(residual < 1e-4, "residual {} too large", residual);
}
// f(x) = x - 10, f'(x) = 1. Bounds [0, 5].
// NR from x0 = 1: x1 = 1 - (1-10)/1 = 10, which is outside [0, 5].
// NR returns None, Brent fallback kicks in.
// The root x = 10 is OUTSIDE bounds, so no root exists in domain.
// Solver should not converge (or find the closest point).
#[test]
fn nr_step_out_of_bounds() {
    let mut config = nr_config(1.0, 1e-8);
    config.bounds = vec![Bound::bounded(0.0, 5.0)];
    let r = solve_root_nr(|x| x - 10.0, |_x| 1.0, &config, &[]);
    // Root at x=10 is outside [0, 5], so should not converge
    assert!(
        !r.converged,
        "should NOT converge when root is outside bounds, got x={:?}",
        r.x
    );
}
// f(x) = x^2 - 1, f'(x) = 2x. Bounds [0, 5]. Root at x = 1.
// Extra guesses [-10, -5] are out of bounds and should be skipped.
// Guess 0.5 is in bounds and should help find the root.
#[test]
fn nr_extra_guesses_out_of_bounds_skipped() {
    let mut config = nr_config(3.0, 1e-10);
    config.bounds = vec![Bound::bounded(0.0, 5.0)];
    let r = solve_root_nr(|x| x * x - 1.0, |x| 2.0 * x, &config, &[-10.0, -5.0, 0.5]);
    assert!(r.converged, "should converge: {:?}", r);
    assert!(
        (r.x[0] - 1.0).abs() < 1e-8,
        "root should be 1.0, got {}",
        r.x[0]
    );
}
// f(x) = ln(x), f'(x) = 1/x. Starting from x0 = -1 (outside domain of ln).
// f(-1) = NaN. NR should fail, Brent fallback via probe grid should find root.
// ln(x) = 0 at x = 1.
#[test]
fn nr_non_finite_function_at_guess() {
    let mut config = nr_config(-1.0, 1e-8);
    config.bounds = vec![Bound::lower(-2.0)];
    let r = solve_root_nr(|x| x.ln(), |x| 1.0 / x, &config, &[0.5, 2.0]);
    assert!(
        r.converged,
        "should converge via Brent or extra guess: {:?}",
        r
    );
    assert!(
        (r.x[0] - 1.0).abs() < 1e-6,
        "root should be 1.0 (ln(1)=0), got {}",
        r.x[0]
    );
}
#[test]
fn nr_primary_guess_outside_bounds() {
    let mut config = nr_config(100.0, 1e-10);
    config.bounds = vec![Bound::bounded(0.0, 10.0)];
    let r = solve_root_nr(|x| x * x - 4.0, |x| 2.0 * x, &config, &[1.5]);
    assert!(r.converged, "should converge from extra guess: {:?}", r);
    assert!(
        (r.x[0] - 2.0).abs() < 1e-8,
        "root should be 2.0, got {}",
        r.x[0]
    );
}

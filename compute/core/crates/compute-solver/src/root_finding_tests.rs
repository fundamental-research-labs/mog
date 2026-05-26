//! Tests for root finding algorithm.
//!
//! Ported from compute-core's solver/root_finding_tests.rs (sections 1-3: pure math).
//! Bridge tests (sections 4-5 using CellId) remain in compute-core.

use crate::root_finding::solve_root;
use crate::types::{Objective, SolverConfig, TerminationReason};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PRECISION: f64 = 1e-6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a SolverConfig for root finding with Target objective.
fn root_config(target: f64, guess: f64) -> SolverConfig {
    SolverConfig {
        objective: Objective::Target(target),
        x0: vec![guess],
        max_evals: 100,
        ftol: DEFAULT_PRECISION,
        max_time_ms: 0,
        ..Default::default()
    }
}

// ===========================================================================
// Section 1: Basic root finding tests (ported from compute-core)
// ===========================================================================

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
fn non_finite_initial() {
    // Function always returns NaN
    let config = root_config(10.0, 1.0);
    let r = solve_root(|_: &[f64]| f64::NAN, &config);
    assert!(!r.converged);
    assert_eq!(r.termination, TerminationReason::NumericalError);
}

#[test]
fn max_iterations_limited() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.0],
        max_evals: 5,
        ftol: 1e-15, // very tight
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0] * x[0] * x[0] - 2.0 * x[0] - 5.0, &config);
    // Should either not converge or maybe converge if fast enough
    if !r.converged {
        assert!(
            r.termination == TerminationReason::MaxEvaluations
                || r.termination == TerminationReason::Stagnation
        );
    }
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
fn brent_convergence() {
    // f(x) = x^3 - 2x - 5, target = 0 -> x ~ 2.0946
    let config = root_config(0.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] * x[0] - 2.0 * x[0] - 5.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 2.0946).abs() < 0.001);
}

#[test]
fn secant_fallback() {
    // Discontinuous step function near x = 5
    let config = root_config(5.0, 3.0);
    let r = solve_root(|x: &[f64]| if x[0] < 5.0 { 0.0 } else { 10.0 }, &config);
    // May or may not converge; just verify no panic
    assert!(r.converged || r.termination != TerminationReason::Converged);
}

#[test]
fn stagnation_detection() {
    // Constant function f(x) = 42, target = 100
    let config = root_config(100.0, 0.0);
    let r = solve_root(|_: &[f64]| 42.0, &config);
    assert!(!r.converged);
    assert_eq!(r.termination, TerminationReason::Stagnation);
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
fn no_sign_change_possible() {
    // x^2 + 1 is always >= 1, target = -1 is unreachable
    let config = root_config(-1.0, 0.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] + 1.0, &config);
    assert!(!r.converged);
    assert!(
        r.termination == TerminationReason::Stagnation
            || r.termination == TerminationReason::MaxEvaluations
    );
}

#[test]
fn zero_guess() {
    // 2x + 1 = 11, guess = 0 -> x = 5
    let config = root_config(11.0, 0.0);
    let r = solve_root(|x: &[f64]| 2.0 * x[0] + 1.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
}

// ===========================================================================
// Section 2: Parameter edge cases
// ===========================================================================

#[test]
fn max_evals_zero_uses_default() {
    let config = SolverConfig {
        objective: Objective::Target(10.0),
        x0: vec![0.0],
        max_evals: 0,
        ftol: DEFAULT_PRECISION,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
}

#[test]
fn ftol_zero_uses_default() {
    let config = SolverConfig {
        objective: Objective::Target(10.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: 0.0,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < 1e-5);
}

#[test]
fn negative_ftol_uses_default() {
    let config = SolverConfig {
        objective: Objective::Target(10.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: -1.0,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < 1e-5);
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

// ===========================================================================
// Section 3: Algorithm stress tests
// ===========================================================================

#[test]
fn cubic() {
    // f(x) = x^3, target = 27 -> x = 3
    let config = root_config(27.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] * x[0], &config);
    assert!(r.converged);
    assert!((r.x[0] - 3.0).abs() < DEFAULT_PRECISION);
}

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
fn piecewise_linear() {
    // f(x) = max(x, 0), target = 5 -> x = 5
    let config = root_config(5.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0].max(0.0), &config);
    assert!(r.converged);
    assert!((r.x[0] - 5.0).abs() < DEFAULT_PRECISION);
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

// ===========================================================================
// Section 4: solve_root API tests
// ===========================================================================

#[test]
fn non_target_objective_returns_error() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![0.0],
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(!r.converged);
    assert_eq!(r.termination, TerminationReason::NumericalError);
    assert!(r.message.contains("requires Objective::Target"));
}

#[test]
fn maximize_objective_returns_error() {
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![0.0],
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(!r.converged);
    assert_eq!(r.termination, TerminationReason::NumericalError);
}

#[test]
fn empty_x0_uses_zero_guess() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![],
        max_evals: 100,
        ftol: DEFAULT_PRECISION,
        max_time_ms: 0,
        ..Default::default()
    };
    // f(0) = 2*0 = 0 = target, so converges immediately
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
}

#[test]
fn result_fields_populated() {
    let config = root_config(10.0, 0.0);
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
    assert_eq!(r.x.len(), 1);
    assert!(r.evals > 0);
    assert!(!r.message.is_empty());
    assert_eq!(r.termination, TerminationReason::Converged);
}

#[test]
fn elapsed_ms_reasonable() {
    let config = root_config(10.0, 0.0);
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(r.converged);
    assert!(r.elapsed_ms < 10_000);
}

// ===========================================================================
// Section 5: solve_root_nr tests (Newton-Raphson with Brent fallback)
// ===========================================================================

use crate::root_finding::solve_root_nr;
use crate::types::Bound;

fn nr_config(guess: f64, ftol: f64) -> SolverConfig {
    SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![guess],
        ftol,
        xtol: 1e-14,
        max_evals: 2000,
        max_time_ms: 0,
        ..Default::default()
    }
}

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
fn nr_already_at_root() {
    // f(0) = 0, should return immediately
    let config = nr_config(0.0, 1e-10);
    let r = solve_root_nr(|x| x * x, |x| 2.0 * x, &config, &[]);
    assert!(r.converged);
    assert!(r.x[0].abs() < 1e-10);
}

// ===========================================================================
// Section 6: First-principles mathematical tests
// ===========================================================================

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
fn no_real_root_x_squared_plus_one() {
    // f(x) = x^2 + 1 has no real roots (minimum value is 1).
    // Target = 0. Solver should NOT claim convergence.
    let config = root_config(0.0, 0.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] + 1.0, &config);
    assert!(
        !r.converged,
        "should not converge for x^2+1=0 (no real roots), but got x={:?}",
        r.x
    );
}

#[test]
fn double_root_tangent() {
    // f(x) = (x-3)^2, target = 0. Double root at x=3.
    // The function touches zero without crossing — Brent needs a sign change.
    // The solver may or may not converge; if it does, verify correctness.
    let config = root_config(0.0, 2.0);
    let r = solve_root(|x: &[f64]| (x[0] - 3.0).powi(2), &config);
    if r.converged {
        let residual = (r.x[0] - 3.0).powi(2);
        assert!(
            residual < DEFAULT_PRECISION,
            "if converged, residual should be small, got {}",
            residual
        );
    }
    // Either way, no panic — test that the solver handles this gracefully.
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

// ===========================================================================
// Section 7: Coverage gap tests — first-principles derived
// ===========================================================================

// ---- 1. Brent inverse quadratic interpolation branch ----
// Requires three points a, b, c with meaningfully different f-values.
// f(x) = x^3 - x has roots at -1, 0, 1. Bracket [-0.5, 2.0]:
// f(-0.5) = -0.125 + 0.5 = 0.375, f(2.0) = 8 - 2 = 6.
// The distinct values at a, b, c should trigger the IQI branch.
#[test]
fn brent_inverse_quadratic_interpolation() {
    let config = root_config(0.0, -0.5);
    let r = solve_root(
        |x: &[f64]| {
            let v = x[0];
            v * v * v - v
        },
        &config,
    );
    assert!(r.converged, "should converge: {:?}", r);
    let x = r.x[0];
    let residual = (x * x * x - x).abs();
    assert!(
        residual < DEFAULT_PRECISION,
        "residual {} too large at x={}",
        residual,
        x
    );
}

// ---- 2. Brent convergence by midpoint tolerance (very flat function) ----
// f(x) = x * 1e-15 is extremely flat. The bracket shrinks faster than
// |f(b)| approaches ftol, so the midpoint tolerance triggers first.
#[test]
fn brent_convergence_by_midpoint_tolerance() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![1.0],
        max_evals: 200,
        ftol: 1e-6,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0] * 1e-15, &config);
    assert!(
        r.converged,
        "should converge for very flat function: {:?}",
        r
    );
    // Root is at x = 0; the solver should get close
    // With such a flat function the residual is tiny regardless
}

// ---- 3. Brent rejection conditions (asymmetric curvature) ----
// f(x) = x^3 is strongly asymmetric around 0. Bracket [-2, 0.1]:
// f(-2) = -8, f(0.1) = 0.001. The huge curvature asymmetry should
// trigger bisection fallback (cond2-cond5) on some iterations.
#[test]
fn brent_rejection_conditions_asymmetric() {
    let config = root_config(0.0, -2.0);
    let r = solve_root(|x: &[f64]| x[0].powi(3), &config);
    assert!(r.converged, "should converge: {:?}", r);
    // Verify it's actually a root: |f(x*)| < precision
    let residual = r.x[0].powi(3).abs();
    assert!(
        residual < DEFAULT_PRECISION,
        "residual {} too large at x={}",
        residual,
        r.x[0]
    );
}

// ---- 5. Secant method non-finite fallback ----
// f(x) = 1/(x - 100) - 1, root at x = 101. Near x = 100, f -> +/-inf.
// A secant step that overshoots toward x = 100 produces non-finite f,
// triggering the 0.1*step fallback.
#[test]
fn secant_non_finite_fallback() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![90.0],
        max_evals: 200,
        ftol: 1e-6,
        max_time_ms: 0,
        root_finding_step_limit: 50.0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 1.0 / (x[0] - 100.0) - 1.0, &config);
    // The function has a singularity at x=100 and root at x=101.
    // Whether Brent or secant handles it, we just verify no panic
    // and check if it converged.
    if r.converged {
        let residual = (1.0 / (r.x[0] - 100.0) - 1.0).abs();
        assert!(
            residual < 1e-4,
            "residual {} too large at x={}",
            residual,
            r.x[0]
        );
    }
}

// ---- 6. Secant stagnation (denominator near zero) ----
// f(x) = tanh(1000*x), target = 0, root at x = 0.
// For |x| > ~0.01, tanh(1000*x) ~ +/-1, so when two consecutive
// secant iterates are both far from 0, f(x1) - f(x0) ~ 0.
#[test]
fn secant_stagnation_tanh() {
    // Use a large step limit to encourage secant to take big steps on a plateau
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![5.0],
        max_evals: 200,
        ftol: 1e-6,
        max_time_ms: 0,
        root_finding_step_limit: 10.0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| (1000.0 * x[0]).tanh(), &config);
    // Brent should bracket it; secant may stagnate. Either way, check correctness.
    if r.converged {
        let residual = (1000.0 * r.x[0]).tanh().abs();
        assert!(
            residual < 1e-4,
            "residual {} too large at x={}",
            residual,
            r.x[0]
        );
    }
}

// ---- 7. Newton-Raphson derivative zero -> Brent fallback ----
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

// ---- 8. Newton-Raphson step out of bounds -> Brent fallback ----
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

// ---- 9. brent_on_bracket endpoint already converged ----
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

// ---- 10. solve_root_nr Brent finds near-solution, NR polishes ----
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

// ---- 11. find_bracket delta grows too large (constant function) ----
// f(x) = 1 (constant). Target(0.0). No sign change ever. find_bracket
// expands delta beyond 1e12 and gives up. Solver should not converge.
#[test]
fn find_bracket_constant_function_no_convergence() {
    let config = root_config(0.0, 0.0);
    let r = solve_root(|_x: &[f64]| 1.0, &config);
    assert!(
        !r.converged,
        "constant function f(x)=1 should not converge to target 0"
    );
}

// ---- 12. solve_root with Minimize objective (error path) ----
// Already tested in Section 4 but we verify termination reason precisely.
#[test]
fn solve_root_minimize_objective_error_details() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0],
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0] * x[0], &config);
    assert!(!r.converged);
    assert_eq!(r.termination, TerminationReason::NumericalError);
    assert!(r.x.is_empty(), "x should be empty for error result");
    assert!(r.fun.is_nan(), "fun should be NaN for error result");
    assert_eq!(r.evals, 0);
    assert_eq!(r.iters, 0);
}

// ---- 13. solve_root_nr with extra guesses out of bounds ----
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

// ---- Additional coverage: large step limit enables secant convergence ----
// With a large root_finding_step_limit, secant can take bigger steps.
// f(x) = x - 1000, target = 0, guess = 0. Needs large steps to reach x = 1000.
#[test]
fn secant_large_step_limit() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.0],
        max_evals: 200,
        ftol: 1e-6,
        max_time_ms: 0,
        root_finding_step_limit: 100.0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0] - 1000.0, &config);
    assert!(
        r.converged,
        "should converge with large step limit: {:?}",
        r
    );
    assert!(
        (r.x[0] - 1000.0).abs() < 1.0,
        "root should be ~1000, got {}",
        r.x[0]
    );
}

// ---- NR: non-finite function value at guess ----
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

// ---- NR: x0 outside bounds is skipped, extra guess inside succeeds ----
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

// ---- NR: f(x) = 0 exactly at some iterate (early exit on fx == 0.0) ----
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

// ---- Brent max iterations reached ----
// Use very tight precision with limited iterations on a hard function.
#[test]
fn brent_max_iterations_reached() {
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.5],
        max_evals: 3, // very few iterations
        ftol: 1e-15,  // extremely tight
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| x[0].powi(5) - x[0] - 0.1, &config);
    if !r.converged {
        assert!(
            r.termination == TerminationReason::MaxEvaluations
                || r.termination == TerminationReason::Stagnation,
            "expected MaxEvaluations or Stagnation, got {:?}",
            r.termination
        );
    }
}

// ---- solve_root: root_finding_step_limit <= 0 uses default ----
#[test]
fn step_limit_zero_uses_default() {
    let config = SolverConfig {
        objective: Objective::Target(10.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: 1e-6,
        max_time_ms: 0,
        root_finding_step_limit: 0.0, // should use DEFAULT_MAX_CHANGE
        ..Default::default()
    };
    let r = solve_root(|x: &[f64]| 2.0 * x[0], &config);
    assert!(
        r.converged,
        "should converge with default step limit: {:?}",
        r
    );
    assert!(
        (r.x[0] - 5.0).abs() < 1e-4,
        "root should be ~5, got {}",
        r.x[0]
    );
}

// ---- NR with unbounded config (no bounds specified) ----
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

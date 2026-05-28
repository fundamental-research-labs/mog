//! Secant fallback and no-sign-change behavior through `solve_root`.

use super::fixtures::{DEFAULT_PRECISION, root_config};
use crate::root_finding::solve_root;
use crate::types::{Objective, SolverConfig, TerminationReason};

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

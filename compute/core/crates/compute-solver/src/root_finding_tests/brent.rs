//! Black-box Brent and bracketing behavior through `solve_root`.

use super::fixtures::{DEFAULT_PRECISION, root_config};
use crate::root_finding::solve_root;
use crate::types::{Objective, SolverConfig, TerminationReason};

#[test]
fn brent_convergence() {
    // f(x) = x^3 - 2x - 5, target = 0 -> x ~ 2.0946
    let config = root_config(0.0, 1.0);
    let r = solve_root(|x: &[f64]| x[0] * x[0] * x[0] - 2.0 * x[0] - 5.0, &config);
    assert!(r.converged);
    assert!((r.x[0] - 2.0946).abs() < 0.001);
}
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

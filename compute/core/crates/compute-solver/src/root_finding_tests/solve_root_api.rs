//! `solve_root` API, configuration fallback, and result-shape behavior.

use super::fixtures::{DEFAULT_PRECISION, root_config};
use crate::root_finding::solve_root;
use crate::types::{Objective, SolverConfig, TerminationReason};

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

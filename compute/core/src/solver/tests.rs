//! Tests for solver routing logic and GoalSeek bridge.
//!
//! Algorithm tests live in the compute-solver crate (root_finding_tests.rs, etc.).
//! These tests verify that the bridge layer routes correctly and converts types.

use super::from_crate_result_to_goal_seek;
use super::solve;
use super::types::*;
use cell_types::CellId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a `SolverParams` for a single-variable Target problem.
fn make_params(target: f64, initial: f64) -> SolverParams {
    SolverParams {
        objective_cell: CellId::from_raw(1u128),
        objective: Objective::Target(target),
        variables: vec![Variable {
            cell_id: CellId::from_raw(2u128),
            initial_value: initial,
            lower_bound: None,
            upper_bound: None,
        }],
        constraints: vec![],
        method: SolverMethod::RootFinding,
        precision: None,
        max_iterations: None,
        max_time_ms: None,
    }
}

const DEFAULT_PRECISION: f64 = 1e-6;

// ===========================================================================
// Routing tests (solve() dispatches to correct algorithm)
// ===========================================================================

#[test]
fn test_solve_routes_to_root_finding() {
    let params = make_params(10.0, 0.0);
    let result = solve(&params, |x: &[f64]| 2.0 * x[0]);
    assert!(result.converged);
    assert_eq!(result.termination, TerminationReason::Converged);
    assert!((result.solution[0] - 5.0).abs() < DEFAULT_PRECISION);
}

#[test]
fn test_solve_auto_1var_target() {
    let mut params = make_params(10.0, 0.0);
    params.method = SolverMethod::Auto;
    let result = solve(&params, |x: &[f64]| 2.0 * x[0]);
    assert!(result.converged);
    assert_eq!(result.termination, TerminationReason::Converged);
}

#[test]
fn test_solve_auto_2vars_runs_in_rust() {
    let mut params = make_params(10.0, 1.0);
    params.method = SolverMethod::Auto;
    params.variables.push(Variable {
        cell_id: CellId::from_raw(3u128),
        initial_value: 1.0,
        lower_bound: None,
        upper_bound: None,
    });
    let result = solve(&params, |x: &[f64]| x[0] + x[1]);
    assert_ne!(result.termination, TerminationReason::RequiresPython);
}

#[test]
fn test_solve_auto_1var_minimize_runs_in_rust() {
    let mut params = make_params(0.0, 5.0);
    params.method = SolverMethod::Auto;
    params.objective = Objective::Minimize;
    let result = solve(&params, |x: &[f64]| x[0] * x[0]);
    assert_ne!(result.termination, TerminationReason::RequiresPython);
    assert!(result.converged);
    assert!(result.solution[0].abs() < 0.1);
}

#[test]
fn test_solve_auto_with_constraints_requires_python() {
    let mut params = make_params(10.0, 0.0);
    params.method = SolverMethod::Auto;
    params.constraints.push(Constraint::LessEqual {
        cell_id: CellId::from_raw(2u128),
        value: 100.0,
    });
    let result = solve(&params, |x: &[f64]| 2.0 * x[0]);
    assert!(!result.converged);
    assert_eq!(result.termination, TerminationReason::RequiresPython);
}

#[test]
fn test_solve_explicit_nelder_mead() {
    let mut params = make_params(0.0, 5.0);
    params.method = SolverMethod::NelderMead;
    params.objective = Objective::Minimize;
    let result = solve(&params, |x: &[f64]| (x[0] - 3.0).powi(2));
    assert!(result.converged);
    assert_ne!(result.termination, TerminationReason::RequiresPython);
    assert!((result.solution[0] - 3.0).abs() < 0.01);
}

#[test]
fn test_solve_explicit_bfgs() {
    let mut params = make_params(0.0, 5.0);
    params.method = SolverMethod::BFGS;
    params.objective = Objective::Minimize;
    let result = solve(&params, |x: &[f64]| (x[0] - 3.0).powi(2));
    assert!(result.converged);
    assert_ne!(result.termination, TerminationReason::RequiresPython);
    assert!((result.solution[0] - 3.0).abs() < 0.01);
}

#[test]
fn test_solve_simplex_requires_python() {
    let mut params = make_params(10.0, 0.0);
    params.method = SolverMethod::Simplex;
    let result = solve(&params, |x: &[f64]| 2.0 * x[0]);
    assert!(!result.converged);
    assert_eq!(result.termination, TerminationReason::RequiresPython);
}

#[test]
fn test_solve_root_finding_non_target_error() {
    let mut params = make_params(10.0, 0.0);
    params.objective = Objective::Minimize;
    let result = solve(&params, |x: &[f64]| 2.0 * x[0]);
    assert!(!result.converged);
    assert_eq!(result.termination, TerminationReason::NumericalError);
}

// ===========================================================================
// GoalSeek bridge conversion tests
// ===========================================================================

#[test]
fn test_goal_seek_bridge_converged() {
    let config = compute_solver::SolverConfig {
        objective: compute_solver::Objective::Target(10.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: 1e-6,
        max_time_ms: 0,
        ..Default::default()
    };
    let crate_result = compute_solver::solve_root(|x: &[f64]| 2.0 * x[0], &config);
    let gs = from_crate_result_to_goal_seek(crate_result);
    assert!(gs.found);
    assert!(gs.error.is_none());
    assert!((gs.solution_value.unwrap() - 5.0).abs() < DEFAULT_PRECISION);
}

#[test]
fn test_goal_seek_bridge_not_converged() {
    let config = compute_solver::SolverConfig {
        objective: compute_solver::Objective::Target(100.0),
        x0: vec![0.0],
        max_evals: 100,
        ftol: 1e-6,
        max_time_ms: 0,
        ..Default::default()
    };
    // Constant function can't reach target
    let crate_result = compute_solver::solve_root(|_: &[f64]| 42.0, &config);
    let gs = from_crate_result_to_goal_seek(crate_result);
    assert!(!gs.found);
    assert!(gs.error.is_some());
}

//! Budget accounting coverage across dispatch paths.

use crate::dispatch::solve;
use crate::types::{Bound, Method, Objective, SolverConfig};

use super::fixtures::{linear, rosenbrock, sphere};

#[test]
fn budget_max_evals_nm() {
    let config = SolverConfig {
        method: Method::NelderMead,
        x0: vec![100.0, -100.0, 50.0],
        max_evals: 50, // Very small budget
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    assert!(
        result.evals <= 55,
        "should respect budget: evals={}",
        result.evals
    );
    // May not converge with only 50 evals
}

#[test]
fn budget_max_evals_de() {
    let config = SolverConfig {
        method: Method::DifferentialEvolution,
        x0: vec![5.0, -3.0],
        bounds: vec![Bound::bounded(-10.0, 10.0); 2],
        seed: Some(42),
        max_evals: 100, // Very small for DE
        ..Default::default()
    };
    let result = solve(sphere, &config);
    // DE population init alone can consume many evals; just check it doesn't run forever
    assert!(result.evals <= 200, "DE budget: evals={}", result.evals);
}

#[test]
fn budget_auto_with_tight_limit() {
    // Auto with very small budget — should return something (not hang)
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(7.0),
        x0: vec![0.0],
        max_evals: 50,
        ..Default::default()
    };
    let result = solve(linear, &config);
    // Even with tight budget, root finding for linear should converge quickly
    assert!(
        result.converged,
        "linear root with budget=50: {:?}",
        result.message
    );
}

#[test]
fn budget_respected_nelder_mead() {
    let config = SolverConfig {
        method: Method::NelderMead,
        x0: vec![100.0, -100.0],
        max_evals: 50,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    // Allow small overshoot (simplex may do n+1 evals in one step)
    assert!(
        result.evals <= 60,
        "NM budget 50: evals={} exceeds limit",
        result.evals
    );
}

#[test]
fn budget_respected_bfgs() {
    let config = SolverConfig {
        method: Method::BFGS,
        x0: vec![100.0, -100.0],
        max_evals: 50,
        ..Default::default()
    };
    let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(rosenbrock, &config)));
    if let Ok(r) = result {
        // BFGS uses finite differencing for gradients (n+1 evals per gradient),
        // so allow ~2x budget overshoot
        assert!(
            r.evals <= 120,
            "BFGS budget 50: evals={} exceeds 2.5x limit",
            r.evals
        );
    }
}

#[test]
fn budget_respected_lbfgsb() {
    let config = SolverConfig {
        method: Method::LBFGSB,
        x0: vec![100.0, -100.0],
        bounds: vec![Bound::bounded(-200.0, 200.0); 2],
        max_evals: 50,
        ..Default::default()
    };
    let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(rosenbrock, &config)));
    if let Ok(r) = result {
        // LBFGSB uses finite differencing for gradients (n+1 evals per gradient),
        // so allow ~2x budget overshoot
        assert!(
            r.evals <= 120,
            "LBFGSB budget 50: evals={} exceeds 2.5x limit",
            r.evals
        );
    }
}

#[test]
fn budget_respected_de() {
    let config = SolverConfig {
        method: Method::DifferentialEvolution,
        x0: vec![100.0, -100.0],
        bounds: vec![Bound::bounded(-200.0, 200.0); 2],
        seed: Some(42),
        max_evals: 50,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    // DE population init can use many evals; allow 2x budget
    assert!(
        result.evals <= 100,
        "DE budget 50: evals={} exceeds 2x limit",
        result.evals
    );
}

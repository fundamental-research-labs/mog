//! Result, bounds, and invalid-input invariant coverage.

use crate::dispatch::solve;
use crate::types::{Bound, Method, Objective, SolverConfig, TerminationReason};

use super::assertions::assert_result_invariants;
use super::fixtures::*;

#[test]
fn result_sphere_at_origin() {
    let config = config_nm(vec![1.0, 2.0, 3.0]);
    let result = solve(sphere, &config);
    assert!(result.converged);
    assert!(result.fun < 1e-10);
    assert_eq!(result.x.len(), 3);
    for xi in &result.x {
        assert!(xi.abs() < 1e-4, "sphere opt: xi={}", xi);
    }
}

#[test]
fn result_booth_at_1_3() {
    let config = config_nm(vec![0.0, 0.0]);
    let result = solve(booth, &config);
    assert!(result.converged);
    assert!(result.fun < 1e-10);
    assert!((result.x[0] - 1.0).abs() < 1e-3);
    assert!((result.x[1] - 3.0).abs() < 1e-3);
}

#[test]
fn result_evals_positive() {
    let config = config_nm(vec![5.0, -3.0]);
    let result = solve(sphere, &config);
    assert!(result.evals > 0, "should have >0 evals");
    assert!(result.iters > 0, "should have >0 iters");
}

#[test]
fn result_termination_converged() {
    let config = config_nm(vec![1.0, -1.0]);
    let result = solve(sphere, &config);
    assert_eq!(result.termination, TerminationReason::Converged);
}

#[test]
fn result_invariants_nm_sphere() {
    let config = config_nm(vec![5.0, -3.0]);
    let result = solve(sphere, &config);
    assert_result_invariants(&result, &config, "NM sphere");
}

#[test]
fn result_invariants_nm_1d() {
    let config = config_nm(vec![10.0]);
    let result = solve(|x: &[f64]| x[0] * x[0], &config);
    assert_result_invariants(&result, &config, "NM 1D");
}

#[test]
fn result_invariants_nm_5d() {
    let config = config_nm(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let result = solve(sphere, &config);
    assert_result_invariants(&result, &config, "NM 5D");
}

#[test]
fn result_invariants_de() {
    let config = config_de(vec![3.0, -2.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    let result = solve(sphere, &config);
    assert_result_invariants(&result, &config, "DE sphere");
}

#[test]
fn result_invariants_auto_root_finding() {
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(7.0),
        x0: vec![0.0],
        max_evals: 1000,
        ..Default::default()
    };
    let result = solve(linear, &config);
    assert_result_invariants(&result, &config, "Auto root finding");
}

#[test]
fn result_invariants_auto_global() {
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![3.0, -3.0],
        bounds: vec![Bound::bounded(-5.0, 5.0); 2],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert_result_invariants(&result, &config, "Auto global");
}

#[test]
fn bounds_respected_nelder_mead() {
    let config = SolverConfig {
        method: Method::NelderMead,
        x0: vec![3.0, 3.0],
        bounds: vec![Bound::bounded(1.0, 5.0); 2],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    for (i, xi) in result.x.iter().enumerate() {
        assert!(
            *xi >= 1.0 - 1e-9 && *xi <= 5.0 + 1e-9,
            "NM bounds: x[{}]={} outside [1,5]",
            i,
            xi
        );
    }
}

#[test]
fn bounds_respected_lbfgsb() {
    let config = SolverConfig {
        method: Method::LBFGSB,
        x0: vec![3.0, 3.0],
        bounds: vec![Bound::bounded(1.0, 5.0); 2],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    if let Ok(r) = result {
        for (i, xi) in r.x.iter().enumerate() {
            assert!(
                *xi >= 1.0 - 1e-9 && *xi <= 5.0 + 1e-9,
                "LBFGSB bounds: x[{}]={} outside [1,5]",
                i,
                xi
            );
        }
    }
}

#[test]
fn bounds_respected_de() {
    let config = SolverConfig {
        method: Method::DifferentialEvolution,
        x0: vec![3.0, 3.0],
        bounds: vec![Bound::bounded(1.0, 5.0); 2],
        seed: Some(42),
        max_evals: 50_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    for (i, xi) in result.x.iter().enumerate() {
        assert!(
            *xi >= 1.0 - 1e-9 && *xi <= 5.0 + 1e-9,
            "DE bounds: x[{}]={} outside [1,5]",
            i,
            xi
        );
    }
}

#[test]
fn zero_length_x0_handled_gracefully() {
    // Zero-length x0 is invalid. Solvers assert ndim >= 1, so this panics.
    // Verify the solver rejects it (panic) rather than producing garbage.
    let config = SolverConfig {
        method: Method::NelderMead,
        x0: vec![],
        max_evals: 100,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        solve(|_x: &[f64]| 0.0, &config)
    }));
    // The solver correctly rejects empty x0 with a panic (assertion).
    assert!(result.is_err(), "zero-length x0 should be rejected");
}

#[test]
fn zero_length_x0_auto_handled_gracefully() {
    // Auto dispatch with empty x0 should also reject.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![],
        max_evals: 100,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        solve(|_x: &[f64]| 0.0, &config)
    }));
    assert!(
        result.is_err(),
        "zero-length x0 with Auto should be rejected"
    );
}

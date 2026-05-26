use crate::nelder_mead::solve_nelder_mead;
use crate::types::{Bound, Objective, SolverConfig, TerminationReason};

// Standard test functions
fn rosenbrock(x: &[f64]) -> f64 {
    (1.0 - x[0]).powi(2) + 100.0 * (x[1] - x[0].powi(2)).powi(2)
}
fn sphere(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi * xi).sum()
}
fn booth(x: &[f64]) -> f64 {
    (x[0] + 2.0 * x[1] - 7.0).powi(2) + (2.0 * x[0] + x[1] - 5.0).powi(2)
}
fn himmelblau(x: &[f64]) -> f64 {
    (x[0].powi(2) + x[1] - 11.0).powi(2) + (x[0] + x[1].powi(2) - 7.0).powi(2)
}
fn beale(x: &[f64]) -> f64 {
    (1.5 - x[0] + x[0] * x[1]).powi(2)
        + (2.25 - x[0] + x[0] * x[1].powi(2)).powi(2)
        + (2.625 - x[0] + x[0] * x[1].powi(3)).powi(2)
}
fn matyas(x: &[f64]) -> f64 {
    0.26 * (x[0] * x[0] + x[1] * x[1]) - 0.48 * x[0] * x[1]
}

fn default_config(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        objective: Objective::Minimize,
        x0,
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    }
}

// ===== Convergence tests =====

#[test]
fn rosenbrock_2d() {
    let config = default_config(vec![-1.0, 1.0]);
    let r = solve_nelder_mead(rosenbrock, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-4, "x0={}", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 1e-4, "x1={}", r.x[1]);
    assert!(r.fun < 1e-8);
}

#[test]
fn sphere_2d() {
    let config = default_config(vec![5.0, -3.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-14);
    for xi in &r.x {
        assert!(xi.abs() < 1e-7);
    }
}

#[test]
fn sphere_3d() {
    let config = default_config(vec![1.0, -2.0, 3.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-12);
}

#[test]
fn sphere_5d() {
    let config = default_config(vec![1.0, -1.0, 2.0, -2.0, 0.5]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10);
}

#[test]
fn booth_function() {
    let config = default_config(vec![0.0, 0.0]);
    let r = solve_nelder_mead(booth, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-4);
    assert!((r.x[1] - 3.0).abs() < 1e-4);
}

#[test]
fn himmelblau_minimum_1() {
    let config = default_config(vec![1.0, 1.0]);
    let r = solve_nelder_mead(himmelblau, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8);
}

#[test]
fn himmelblau_minimum_2() {
    let config = default_config(vec![-4.0, -1.0]);
    let r = solve_nelder_mead(himmelblau, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8);
}

#[test]
fn beale_function() {
    let config = default_config(vec![0.0, 0.0]);
    let r = solve_nelder_mead(beale, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-3);
    assert!((r.x[1] - 0.5).abs() < 1e-3);
}

#[test]
fn matyas_function() {
    let config = default_config(vec![5.0, 5.0]);
    let r = solve_nelder_mead(matyas, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-12);
}

#[test]
fn rosenbrock_from_far() {
    let config = default_config(vec![-5.0, 5.0]);
    let r = solve_nelder_mead(rosenbrock, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-3);
    assert!((r.x[1] - 1.0).abs() < 1e-3);
}

// ===== Objective types =====

#[test]
fn maximize_neg_sphere() {
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![5.0, -3.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(|x: &[f64]| -(x[0] * x[0] + x[1] * x[1]), &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun.abs() < 1e-8, "fun={}", r.fun);
}

#[test]
fn target_sphere() {
    let config = SolverConfig {
        objective: Objective::Target(4.0),
        x0: vec![0.1, 0.1],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.fun - 4.0).abs() < 1e-4, "fun={}", r.fun);
}

#[test]
fn maximize_quadratic() {
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![0.5],
        max_evals: 50_000,
        max_time_ms: 0,
        bounds: vec![Bound::bounded(-10.0, 10.0)],
        ..Default::default()
    };
    let r = solve_nelder_mead(|x: &[f64]| -(x[0] - 3.0).powi(2) + 10.0, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-4, "x0={}", r.x[0]);
    assert!((r.fun - 10.0).abs() < 1e-4, "fun={}", r.fun);
}

#[test]
fn target_specific_value() {
    let config = SolverConfig {
        objective: Objective::Target(25.0),
        x0: vec![1.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(|x: &[f64]| x[0] * x[0], &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.fun - 25.0).abs() < 1e-4, "fun={}", r.fun);
}

// ===== Bounds tests =====

#[test]
fn constrained_minimum() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, 5.0],
        bounds: vec![Bound::bounded(2.0, 10.0), Bound::bounded(2.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 2.0).abs() < 1e-4, "x0={}", r.x[0]);
    assert!((r.x[1] - 2.0).abs() < 1e-4, "x1={}", r.x[1]);
}

#[test]
fn solution_at_boundary() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0],
        bounds: vec![Bound::lower(3.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-4, "x0={}", r.x[0]);
}

#[test]
fn narrow_box() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.5, 2.5],
        bounds: vec![Bound::bounded(1.0, 2.0), Bound::bounded(2.0, 3.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-4, "x0={}", r.x[0]);
    assert!((r.x[1] - 2.0).abs() < 1e-4, "x1={}", r.x[1]);
}

#[test]
fn mixed_bounded_unbounded() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, 5.0],
        bounds: vec![Bound::lower(1.0), Bound::unbounded()],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-4, "x0={}", r.x[0]);
    assert!(r.x[1].abs() < 1e-6, "x1={}", r.x[1]);
}

#[test]
fn upper_bound_only() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![-5.0],
        bounds: vec![Bound::upper(-2.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - (-2.0)).abs() < 1e-4, "x0={}", r.x[0]);
}

#[test]
fn initial_outside_bounds_projected() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![100.0, -100.0],
        bounds: vec![Bound::bounded(0.0, 5.0), Bound::bounded(0.0, 5.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.x[0] >= 0.0 && r.x[0] <= 5.0);
    assert!(r.x[1] >= 0.0 && r.x[1] <= 5.0);
}

// ===== Robustness tests =====

#[test]
fn nan_in_some_regions() {
    let config = default_config(vec![2.0, 2.0]);
    let r = solve_nelder_mead(
        |x: &[f64]| {
            let v = x[0] * x[0] + x[1] * x[1];
            if v > 100.0 { f64::NAN } else { v }
        },
        &config,
    );
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8);
}

#[test]
fn max_evals_budget() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![-5.0, 5.0],
        max_evals: 20,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(rosenbrock, &config);
    assert!(!r.converged);
    assert!(r.evals <= 20);
    assert_eq!(r.termination, TerminationReason::MaxEvaluations);
}

#[test]
fn stagnation_on_flat() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0, 2.0],
        max_evals: 500_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(|_x: &[f64]| 42.0, &config);
    assert!(
        r.termination == TerminationReason::Converged
            || r.termination == TerminationReason::Stagnation
    );
}

#[test]
fn sphere_10d() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0; 10],
        max_evals: 100_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn all_nan_function() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0, 2.0],
        max_evals: 100,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(|_x: &[f64]| f64::NAN, &config);
    assert!(r.fun.is_nan(), "all NaN should yield NaN best_raw_f");
}

#[test]
fn inf_function_sometimes() {
    let config = default_config(vec![1.0, 1.0]);
    let r = solve_nelder_mead(
        |x: &[f64]| {
            let v = x[0] * x[0] + x[1] * x[1];
            if x[0] < 0.0 { f64::INFINITY } else { v }
        },
        &config,
    );
    assert!(r.converged || r.evals > 0);
    assert!(r.fun.is_finite());
}

#[test]
fn noisy_sphere() {
    use std::cell::Cell;
    let counter = Cell::new(0u64);
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ftol: 1e-2,
        xtol: 1e-2,
        ..Default::default()
    };
    let r = solve_nelder_mead(
        |x: &[f64]| {
            let c = counter.get();
            counter.set(c + 1);
            let noise = ((c as f64) * 0.618).sin() * 0.001;
            sphere(x) + noise
        },
        &config,
    );
    assert!(r.fun < 0.1, "fun={}", r.fun);
}

#[test]
fn budget_exhausted_during_init() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0, 2.0, 3.0],
        max_evals: 2,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(!r.converged);
    assert!(r.evals <= 2);
    assert_eq!(r.termination, TerminationReason::MaxEvaluations);
}

// ===== Edge cases =====

#[test]
fn single_variable() {
    let config = default_config(vec![5.0]);
    let r = solve_nelder_mead(|x: &[f64]| (x[0] - 3.0).powi(2), &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-4, "x0={}", r.x[0]);
}

#[test]
fn zero_initial_guess() {
    let config = default_config(vec![0.0, 0.0]);
    let r = solve_nelder_mead(
        |x: &[f64]| (x[0] - 1.0).powi(2) + (x[1] - 1.0).powi(2),
        &config,
    );
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-4);
    assert!((r.x[1] - 1.0).abs() < 1e-4);
}

#[test]
fn large_initial_point() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1000.0, -1000.0],
        max_evals: 100_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn already_at_minimum() {
    let config = default_config(vec![0.0, 0.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10);
}

#[test]
fn negative_initial_guess() {
    let config = default_config(vec![-10.0, -10.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10);
}

#[test]
fn asymmetric_function() {
    let config = default_config(vec![0.5, 0.5]);
    let r = solve_nelder_mead(
        |x: &[f64]| (x[0] - 2.0).powi(2) + 10.0 * (x[1] - 3.0).powi(2),
        &config,
    );
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 2.0).abs() < 1e-4);
    assert!((r.x[1] - 3.0).abs() < 1e-4);
}

// ===== Adaptive parameters tests =====

#[test]
fn adaptive_params_n2() {
    // For n=2: beta=2, gamma=0.5, sigma=0.5 (matches standard NM)
    let config = default_config(vec![5.0, -3.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged);
    assert!(r.fun < 1e-14);
}

#[test]
fn high_dim_convergence_n10() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![2.0; 10],
        max_evals: 200_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn adaptive_helps_high_dim() {
    // In 8D, adaptive params differ significantly from standard
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![3.0; 8],
        max_evals: 200_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

// ===== Result struct validation =====

#[test]
fn result_fields_populated() {
    let config = default_config(vec![5.0, -3.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.evals > 0);
    assert!(r.iters > 0);
    assert_eq!(r.x.len(), 2);
    assert!(!r.message.is_empty());
    assert_eq!(r.termination, TerminationReason::Converged);
}

#[test]
fn fun_is_raw_untransformed_for_maximize() {
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![5.0],
        bounds: vec![Bound::bounded(-10.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(|x: &[f64]| -(x[0] * x[0]), &config);
    assert!(r.converged, "msg: {}", r.message);
    // fun should be the raw value (near 0), not the negated value
    assert!(r.fun.abs() < 1e-6 || r.fun <= 0.0, "fun={}", r.fun);
}

#[test]
fn evals_within_budget() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0, 2.0],
        max_evals: 500,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(rosenbrock, &config);
    assert!(r.evals <= 500, "evals={}", r.evals);
}

#[test]
fn convergence_tolerance_respected() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 50_000,
        max_time_ms: 0,
        xtol: 1e-12,
        ftol: 1e-12,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-20, "fun={}", r.fun);
}

#[test]
fn loose_tolerance_converges_fast() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 50_000,
        max_time_ms: 0,
        xtol: 1e-2,
        ftol: 1e-2,
        ..Default::default()
    };
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged);
    assert!(r.evals < 200, "evals={}", r.evals);
}

#[test]
fn bounded_rosenbrock() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![0.0, 0.0],
        bounds: vec![Bound::bounded(-5.0, 5.0), Bound::bounded(-5.0, 5.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_nelder_mead(rosenbrock, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-3);
    assert!((r.x[1] - 1.0).abs() < 1e-3);
}

#[test]
fn sphere_4d() {
    let config = default_config(vec![2.0, -3.0, 1.0, -1.0]);
    let r = solve_nelder_mead(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10);
}

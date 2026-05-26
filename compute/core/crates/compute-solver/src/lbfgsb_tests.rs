//! Comprehensive tests for the L-BFGS-B limited-memory quasi-Newton optimizer.

use crate::lbfgsb::solve_lbfgsb;
use crate::types::{Bound, Objective, SolverConfig, TerminationReason};

// ---------------------------------------------------------------------------
// Standard test functions
// ---------------------------------------------------------------------------

fn sphere(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi * xi).sum()
}

fn rosenbrock(x: &[f64]) -> f64 {
    (1.0 - x[0]).powi(2) + 100.0 * (x[1] - x[0].powi(2)).powi(2)
}

fn booth(x: &[f64]) -> f64 {
    (x[0] + 2.0 * x[1] - 7.0).powi(2) + (2.0 * x[0] + x[1] - 5.0).powi(2)
}

fn matyas(x: &[f64]) -> f64 {
    0.26 * (x[0] * x[0] + x[1] * x[1]) - 0.48 * x[0] * x[1]
}

fn himmelblau(x: &[f64]) -> f64 {
    (x[0].powi(2) + x[1] - 11.0).powi(2) + (x[0] + x[1].powi(2) - 7.0).powi(2)
}

fn beale(x: &[f64]) -> f64 {
    (1.5 - x[0] + x[0] * x[1]).powi(2)
        + (2.25 - x[0] + x[0] * x[1].powi(2)).powi(2)
        + (2.625 - x[0] + x[0] * x[1].powi(3)).powi(2)
}

// ---------------------------------------------------------------------------
// Helper config builders
// ---------------------------------------------------------------------------

fn default_config(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        objective: Objective::Minimize,
        x0,
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    }
}

fn bounded_config(x0: Vec<f64>, bounds: Vec<Bound>) -> SolverConfig {
    SolverConfig {
        objective: Objective::Minimize,
        x0,
        bounds,
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    }
}

fn config_with_gtol(x0: Vec<f64>, gtol: f64) -> SolverConfig {
    SolverConfig {
        objective: Objective::Minimize,
        x0,
        max_evals: 50_000,
        max_time_ms: 0,
        gtol,
        ..Default::default()
    }
}

// ===================================================================
// 1. Convergence tests
// ===================================================================

#[test]
fn sphere_2d() {
    let r = solve_lbfgsb(sphere, &default_config(vec![5.0, -3.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 1e-4, "xi={}", xi);
    }
}

#[test]
fn sphere_5d() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1.0, -1.0, 2.0, -2.0, 0.5]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

#[test]
fn sphere_10d() {
    let x0: Vec<f64> = (0..10).map(|i| (i as f64) - 5.0).collect();
    let r = solve_lbfgsb(sphere, &default_config(x0));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn sphere_20d() {
    // L-BFGS-B should handle higher dimensions well (memory-limited)
    let x0: Vec<f64> = (0..20).map(|i| (i as f64) - 10.0).collect();
    let r = solve_lbfgsb(sphere, &default_config(x0));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-4, "fun={}", r.fun);
}

#[test]
fn rosenbrock_2d() {
    let r = solve_lbfgsb(rosenbrock, &default_config(vec![-1.0, 1.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-3, "x0={}", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 1e-3, "x1={}", r.x[1]);
    assert!(r.fun < 1e-5, "fun={}", r.fun);
}

#[test]
fn rosenbrock_2d_far_start() {
    let r = solve_lbfgsb(rosenbrock, &default_config(vec![-5.0, 5.0]));
    assert!(r.fun < 1.0, "fun={}", r.fun);
}

#[test]
fn booth_function() {
    let r = solve_lbfgsb(booth, &default_config(vec![0.0, 0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-3, "x0={}", r.x[0]);
    assert!((r.x[1] - 3.0).abs() < 1e-3, "x1={}", r.x[1]);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn matyas_function() {
    let r = solve_lbfgsb(matyas, &default_config(vec![5.0, -5.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 1e-3, "xi={}", xi);
    }
}

#[test]
fn himmelblau_minimum() {
    let r = solve_lbfgsb(himmelblau, &default_config(vec![1.0, 1.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn beale_function() {
    let r = solve_lbfgsb(beale, &default_config(vec![0.0, 0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 0.1, "x0={}", r.x[0]);
    assert!((r.x[1] - 0.5).abs() < 0.1, "x1={}", r.x[1]);
    assert!(r.fun < 1e-4, "fun={}", r.fun);
}

// ===================================================================
// 2. Bound handling tests (L-BFGS-B specialty)
// ===================================================================

#[test]
fn bounded_sphere_constrained_away_from_optimum() {
    // Optimum at (0,0), but bounds keep it at (1,1).
    let config = bounded_config(
        vec![5.0, 5.0],
        vec![Bound::bounded(1.0, 10.0), Bound::bounded(1.0, 10.0)],
    );
    let r = solve_lbfgsb(sphere, &config);
    assert!((r.x[0] - 1.0).abs() < 0.1, "x0={}", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 0.1, "x1={}", r.x[1]);
}

#[test]
fn lower_bounded_only() {
    let config = bounded_config(vec![5.0], vec![Bound::lower(2.0)]);
    let r = solve_lbfgsb(sphere, &config);
    assert!((r.x[0] - 2.0).abs() < 0.1, "x0={}", r.x[0]);
}

#[test]
fn upper_bounded_only() {
    let f = |x: &[f64]| -> f64 { (x[0] - 10.0).powi(2) };
    let config = bounded_config(vec![5.0], vec![Bound::upper(7.0)]);
    let r = solve_lbfgsb(f, &config);
    assert!((r.x[0] - 7.0).abs() < 0.1, "x0={}", r.x[0]);
}

#[test]
fn mixed_bounds_per_dimension() {
    // x0 bounded [1,5], x1 bounded [-5,-1], minimum of sphere is at (1,-1)
    let config = bounded_config(
        vec![3.0, -3.0],
        vec![Bound::bounded(1.0, 5.0), Bound::bounded(-5.0, -1.0)],
    );
    let r = solve_lbfgsb(sphere, &config);
    assert!((r.x[0] - 1.0).abs() < 0.1, "x0={}", r.x[0]);
    assert!((r.x[1] - (-1.0)).abs() < 0.1, "x1={}", r.x[1]);
}

#[test]
fn bounds_respected_in_result() {
    let config = bounded_config(
        vec![5.0, 5.0],
        vec![Bound::bounded(2.0, 8.0), Bound::bounded(3.0, 7.0)],
    );
    let r = solve_lbfgsb(sphere, &config);
    assert!(r.x[0] >= 2.0 - 1e-10, "x0={} below lower", r.x[0]);
    assert!(r.x[0] <= 8.0 + 1e-10, "x0={} above upper", r.x[0]);
    assert!(r.x[1] >= 3.0 - 1e-10, "x1={} below lower", r.x[1]);
    assert!(r.x[1] <= 7.0 + 1e-10, "x1={} above upper", r.x[1]);
}

#[test]
fn narrow_bounds_corridor() {
    // Very tight bounds: x in [0.9, 1.1], y in [0.9, 1.1]
    let config = bounded_config(
        vec![1.0, 1.0],
        vec![Bound::bounded(0.9, 1.1), Bound::bounded(0.9, 1.1)],
    );
    let r = solve_lbfgsb(sphere, &config);
    assert!(r.x[0] >= 0.9 - 1e-10 && r.x[0] <= 1.1 + 1e-10);
    assert!(r.x[1] >= 0.9 - 1e-10 && r.x[1] <= 1.1 + 1e-10);
}

#[test]
fn unbounded_dimensions_with_partial_bounds() {
    // x0 unbounded, x1 bounded [1, inf)
    let config = bounded_config(vec![5.0, 5.0], vec![Bound::unbounded(), Bound::lower(1.0)]);
    let r = solve_lbfgsb(sphere, &config);
    assert!(r.x[0].abs() < 0.5, "x0={} should be near 0", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 0.1, "x1={} should be near 1", r.x[1]);
}

// ===================================================================
// 3. Objective type tests
// ===================================================================

#[test]
fn maximize_objective() {
    let f = |x: &[f64]| -> f64 { -(x[0] * x[0] + x[1] * x[1]) + 10.0 };
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![3.0, 4.0],
        bounds: vec![Bound::bounded(-10.0, 10.0), Bound::bounded(-10.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(f, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.fun - 10.0).abs() < 1e-3, "fun={}", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 0.01, "xi={}", xi);
    }
}

#[test]
fn target_objective() {
    let f = |x: &[f64]| -> f64 { (x[0] - 3.0).powi(2) };
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(f, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-3, "x0={}", r.x[0]);
}

#[test]
fn target_nonzero() {
    // Find x where sphere(x) ≈ 5.0
    let config = SolverConfig {
        objective: Objective::Target(5.0),
        x0: vec![0.1, 0.1],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(sphere, &config);
    assert!((r.fun - 5.0).abs() < 0.1, "fun={}, expected ~5.0", r.fun);
}

#[test]
fn result_fun_is_raw_value_for_maximize() {
    let f = |x: &[f64]| -> f64 { -(x[0] * x[0]) + 10.0 };
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![3.0],
        bounds: vec![Bound::bounded(-10.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(f, &config);
    // fun should be the raw value (positive, near 10.0), not negated
    assert!(r.fun > 0.0, "fun={} should be raw positive value", r.fun);
}

// ===================================================================
// 4. Cascade to Nelder-Mead tests
// ===================================================================

#[test]
fn cascade_on_discontinuous_function() {
    let f = |x: &[f64]| -> f64 {
        if x[0] < 2.0 {
            10.0
        } else {
            (x[0] - 3.0).powi(2)
        }
    };
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.5],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(f, &config);
    assert!(r.fun <= 10.0, "fun={}", r.fun);
}

#[test]
fn cascade_on_flat_function() {
    let f = |_x: &[f64]| -> f64 { 42.0 };
    let config = default_config(vec![1.0, 2.0]);
    let r = solve_lbfgsb(f, &config);
    assert!((r.fun - 42.0).abs() < 1e-10, "fun={}", r.fun);
    assert!(!r.message.is_empty());
}

#[test]
fn cascade_on_abs_function() {
    let f = |x: &[f64]| -> f64 { x[0].abs() + x[1].abs() };
    let config = default_config(vec![5.0, -3.0]);
    let r = solve_lbfgsb(f, &config);
    assert!(r.fun < 0.1, "fun={}", r.fun);
}

// ===================================================================
// 5. Budget tests
// ===================================================================

#[test]
fn max_evals_honored() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 20,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(sphere, &config);
    // Budget plus possible NM cascade overhead
    assert!(r.evals <= 30, "evals={} (budget=20 + NM overhead)", r.evals);
}

#[test]
fn very_tight_budget() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 5,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(sphere, &config);
    assert!(!r.message.is_empty());
    assert!(r.evals <= 10, "evals={}", r.evals);
}

// ===================================================================
// 6. Result field validation
// ===================================================================

#[test]
fn result_x_length_matches_input() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1.0, 2.0, 3.0]));
    assert_eq!(r.x.len(), 3);
}

#[test]
fn result_evals_positive() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1.0, 2.0]));
    assert!(r.evals > 0, "evals={}", r.evals);
}

#[test]
fn result_message_not_empty() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1.0, 2.0]));
    assert!(!r.message.is_empty());
}

#[test]
fn result_converged_implies_converged_reason() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1.0, 2.0]));
    if r.converged {
        assert_eq!(r.termination, TerminationReason::Converged);
    }
}

#[test]
fn result_iters_positive_on_nontrivial() {
    let r = solve_lbfgsb(sphere, &default_config(vec![5.0, -3.0]));
    assert!(r.iters > 0, "iters={}", r.iters);
}

// ===================================================================
// 7. Gradient convergence / tolerance tests
// ===================================================================

#[test]
fn tight_gtol_produces_tighter_solution() {
    let r_loose = solve_lbfgsb(sphere, &config_with_gtol(vec![5.0, -3.0], 1e-3));
    let r_tight = solve_lbfgsb(sphere, &config_with_gtol(vec![5.0, -3.0], 1e-10));
    assert!(
        r_tight.fun <= r_loose.fun + 1e-12,
        "tight={} should be <= loose={}",
        r_tight.fun,
        r_loose.fun
    );
}

#[test]
fn very_loose_gtol_converges_fast() {
    let r = solve_lbfgsb(sphere, &config_with_gtol(vec![5.0, -3.0], 1.0));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.iters <= 5, "iters={}", r.iters);
}

// ===================================================================
// 8. Dimension tests
// ===================================================================

#[test]
fn one_dimensional() {
    let f = |x: &[f64]| -> f64 { (x[0] - 7.0).powi(2) };
    let r = solve_lbfgsb(f, &default_config(vec![0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 7.0).abs() < 1e-3, "x0={}", r.x[0]);
}

#[test]
fn three_dimensional() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1.0, -2.0, 3.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

// ===================================================================
// 9. Starting point tests
// ===================================================================

#[test]
fn start_at_optimum() {
    let r = solve_lbfgsb(sphere, &default_config(vec![0.0, 0.0]));
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

#[test]
fn start_near_optimum() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1e-6, 1e-6]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10, "fun={}", r.fun);
}

// ===================================================================
// 10. Efficiency tests (L-BFGS-B vs NM)
// ===================================================================

#[test]
fn lbfgsb_competitive_with_nm_on_sphere() {
    let config = default_config(vec![5.0, -3.0]);
    let lb_r = solve_lbfgsb(sphere, &config);
    let nm_r = crate::nelder_mead::solve_nelder_mead(sphere, &config);
    if lb_r.converged && nm_r.converged {
        assert!(
            lb_r.evals <= nm_r.evals * 2,
            "L-BFGS-B evals={} should be competitive with NM evals={}",
            lb_r.evals,
            nm_r.evals
        );
    }
}

// ===================================================================
// 11. Edge cases
// ===================================================================

#[test]
fn nan_initial_value() {
    let f = |_x: &[f64]| -> f64 { f64::NAN };
    let config = default_config(vec![1.0, 2.0]);
    let r = solve_lbfgsb(f, &config);
    assert!(!r.message.is_empty());
}

#[test]
fn large_initial_values() {
    let r = solve_lbfgsb(sphere, &default_config(vec![1e6, -1e6]));
    assert!(r.fun < 1.0, "fun={}", r.fun);
}

#[test]
fn negative_values_minimize() {
    let f = |x: &[f64]| -> f64 { (x[0] - 5.0).powi(2) - 100.0 };
    let r = solve_lbfgsb(f, &default_config(vec![0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.fun - (-100.0)).abs() < 1e-4, "fun={}", r.fun);
    assert!((r.x[0] - 5.0).abs() < 1e-3, "x0={}", r.x[0]);
}

#[test]
fn nearly_flat_function() {
    let f = |x: &[f64]| -> f64 { 1e-15 * (x[0] * x[0] + x[1] * x[1]) };
    let config = default_config(vec![1.0, 1.0]);
    let r = solve_lbfgsb(f, &config);
    assert!(r.fun < 1e-10, "fun={}", r.fun);
}

// ===================================================================
// 12. First-principles constrained optimization tests
// ===================================================================

#[test]
fn optimum_exactly_on_bound() {
    // f(x,y) = (x-5)^2 + (y-5)^2. Unconstrained min at (5,5).
    // Bounds: x in [0,3], y in [0,3]. Constrained min at corner (3,3).
    // f(3,3) = (3-5)^2 + (3-5)^2 = 4 + 4 = 8.
    let f = |x: &[f64]| -> f64 { (x[0] - 5.0).powi(2) + (x[1] - 5.0).powi(2) };
    let config = bounded_config(
        vec![1.0, 1.0],
        vec![Bound::bounded(0.0, 3.0), Bound::bounded(0.0, 3.0)],
    );
    let r = solve_lbfgsb(f, &config);
    assert!((r.x[0] - 3.0).abs() < 1e-4, "x0={}, expected 3.0", r.x[0]);
    assert!((r.x[1] - 3.0).abs() < 1e-4, "x1={}, expected 3.0", r.x[1]);
    assert!((r.fun - 8.0).abs() < 1e-4, "fun={}, expected 8.0", r.fun);
}

#[test]
fn optimum_on_one_bound_free_on_other() {
    // f(x,y) = (x-1)^2 + (y-5)^2. Unconstrained min at (1,5).
    // Bounds: x in [-10,10], y in [0,3].
    // x=1 is interior (free), y=3 is on upper bound.
    // f(1,3) = 0 + 4 = 4.
    let f = |x: &[f64]| -> f64 { (x[0] - 1.0).powi(2) + (x[1] - 5.0).powi(2) };
    let config = bounded_config(
        vec![0.0, 1.0],
        vec![Bound::bounded(-10.0, 10.0), Bound::bounded(0.0, 3.0)],
    );
    let r = solve_lbfgsb(f, &config);
    assert!((r.x[0] - 1.0).abs() < 1e-4, "x0={}, expected 1.0", r.x[0]);
    assert!((r.x[1] - 3.0).abs() < 1e-4, "x1={}, expected 3.0", r.x[1]);
    assert!((r.fun - 4.0).abs() < 1e-4, "fun={}, expected 4.0", r.fun);
}

#[test]
fn ill_conditioned_bounded_quadratic() {
    // f(x,y) = x^2 + 10000*y^2. Condition number = 10000.
    // Bounds: x in [-100,100], y in [-100,100]. Min at (0,0), interior.
    // L-BFGS-B should handle this because bounds are inactive at solution.
    let f = |x: &[f64]| -> f64 { x[0] * x[0] + 10000.0 * x[1] * x[1] };
    let config = bounded_config(
        vec![50.0, 50.0],
        vec![Bound::bounded(-100.0, 100.0), Bound::bounded(-100.0, 100.0)],
    );
    let r = solve_lbfgsb(f, &config);
    assert!(r.x[0].abs() < 1e-3, "x0={}, expected ~0", r.x[0]);
    assert!(r.x[1].abs() < 1e-3, "x1={}, expected ~0", r.x[1]);
    assert!(r.fun < 1e-4, "fun={}, expected ~0", r.fun);
}

#[test]
fn narrow_feasible_corridor() {
    // f(x,y) = (x-10)^2 + (y-10)^2. Unconstrained min at (10,10).
    // Bounds: x in [0.5,1.5], y in [0.5,1.5]. Closest feasible point: (1.5,1.5).
    // f(1.5,1.5) = (1.5-10)^2 + (1.5-10)^2 = 72.25 + 72.25 = 144.5.
    let f = |x: &[f64]| -> f64 { (x[0] - 10.0).powi(2) + (x[1] - 10.0).powi(2) };
    let config = bounded_config(
        vec![1.0, 1.0],
        vec![Bound::bounded(0.5, 1.5), Bound::bounded(0.5, 1.5)],
    );
    let r = solve_lbfgsb(f, &config);
    assert!((r.x[0] - 1.5).abs() < 1e-4, "x0={}, expected 1.5", r.x[0]);
    assert!((r.x[1] - 1.5).abs() < 1e-4, "x1={}, expected 1.5", r.x[1]);
    assert!(
        (r.fun - 144.5).abs() < 1e-2,
        "fun={}, expected 144.5",
        r.fun
    );
}

#[test]
fn all_bounds_active_corner_solution() {
    // f(x,y) = -x - y (minimize => maximize x+y).
    // Bounds: x in [0,10], y in [0,10]. Min at (10,10), f=-20.
    // Gradient: df/dx = -1, df/dy = -1 (constant, always pointing toward +x,+y).
    let f = |x: &[f64]| -> f64 { -x[0] - x[1] };
    let config = bounded_config(
        vec![5.0, 5.0],
        vec![Bound::bounded(0.0, 10.0), Bound::bounded(0.0, 10.0)],
    );
    let r = solve_lbfgsb(f, &config);
    assert!((r.x[0] - 10.0).abs() < 1e-4, "x0={}, expected 10.0", r.x[0]);
    assert!((r.x[1] - 10.0).abs() < 1e-4, "x1={}, expected 10.0", r.x[1]);
    assert!(
        (r.fun - (-20.0)).abs() < 1e-4,
        "fun={}, expected -20.0",
        r.fun
    );
}

#[test]
fn kkt_conditions_at_solution() {
    // f(x,y) = (x-5)^2 + (y+3)^2. Bounds: x in [0,3], y in [-1,1].
    // Unconstrained min at (5,-3).
    // x: min at 5, but upper bound 3 => x*=3 (upper bound active).
    //   df/dx = 2(x-5) = 2(3-5) = -4. KKT for upper: df/dx <= 0. -4 <= 0 OK.
    // y: min at -3, but lower bound -1 => y*=-1 (lower bound active).
    //   df/dy = 2(y+3) = 2(-1+3) = 4. KKT for lower: df/dy >= 0. 4 >= 0 OK.
    // f(3,-1) = (3-5)^2 + (-1+3)^2 = 4 + 4 = 8. Wait: 4+4=8, not 20.
    // Rechecking: (3-5)^2 = 4, (-1+3)^2 = 4. f = 8.
    // Actually the task says f=20 with (3-5)^2=4 and (-1-(-3))^2=(-1+3)^2=4.
    // That's 4+4=8. The task had a math error; correct value is 8.
    let f = |x: &[f64]| -> f64 { (x[0] - 5.0).powi(2) + (x[1] + 3.0).powi(2) };
    let config = bounded_config(
        vec![1.0, 0.0],
        vec![Bound::bounded(0.0, 3.0), Bound::bounded(-1.0, 1.0)],
    );
    let r = solve_lbfgsb(f, &config);
    let tol = 1e-4;
    assert!((r.x[0] - 3.0).abs() < tol, "x0={}, expected 3.0", r.x[0]);
    assert!(
        (r.x[1] - (-1.0)).abs() < tol,
        "x1={}, expected -1.0",
        r.x[1]
    );
    assert!((r.fun - 8.0).abs() < 1e-3, "fun={}, expected 8.0", r.fun);

    // Verify KKT conditions at solution:
    let grad_x = 2.0 * (r.x[0] - 5.0); // should be ~ -4
    let grad_y = 2.0 * (r.x[1] + 3.0); // should be ~ +4

    // x at upper bound => gradient must be <= 0
    assert!(
        grad_x <= 1e-6,
        "KKT violated: grad_x={} at upper bound",
        grad_x
    );
    // y at lower bound => gradient must be >= 0
    assert!(
        grad_y >= -1e-6,
        "KKT violated: grad_y={} at lower bound",
        grad_y
    );
}

#[test]
fn high_dimensional_sphere_50d() {
    // f(x) = sum(x_i^2). No bounds. Start from all 1s.
    // L-BFGS-B should handle 50D efficiently. Min at origin, f=0.
    let x0 = vec![1.0; 50];
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0,
        max_evals: 100_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(sphere, &config);
    assert!(r.converged, "50D sphere did not converge: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}, expected ~0", r.fun);
    for (i, xi) in r.x.iter().enumerate() {
        assert!(xi.abs() < 1e-3, "x[{}]={}, expected ~0", i, xi);
    }
}

#[test]
fn bound_projection_preserves_feasibility() {
    // f(x) = x^2. Bounds: x in [2,5]. Start from x0=10 (infeasible).
    // Unconstrained min at 0, but closest feasible point is x=2.
    // f(2) = 4.
    let f = |x: &[f64]| -> f64 { x[0] * x[0] };
    let config = bounded_config(vec![10.0], vec![Bound::bounded(2.0, 5.0)]);
    let r = solve_lbfgsb(f, &config);
    assert!((r.x[0] - 2.0).abs() < 1e-4, "x0={}, expected 2.0", r.x[0]);
    assert!((r.fun - 4.0).abs() < 1e-3, "fun={}, expected 4.0", r.fun);
    // Verify feasibility
    assert!(r.x[0] >= 2.0 - 1e-10, "x0={} below lower bound", r.x[0]);
    assert!(r.x[0] <= 5.0 + 1e-10, "x0={} above upper bound", r.x[0]);
}

#[test]
fn symmetric_bounds_symmetric_function() {
    // f(x,y) = x^2 + y^2. Bounds: x in [-5,5], y in [-5,5].
    // Min at (0,0), interior to bounds. Bounds should not interfere.
    let config = bounded_config(
        vec![3.0, -4.0],
        vec![Bound::bounded(-5.0, 5.0), Bound::bounded(-5.0, 5.0)],
    );
    let r = solve_lbfgsb(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.x[0].abs() < 1e-4, "x0={}, expected ~0", r.x[0]);
    assert!(r.x[1].abs() < 1e-4, "x1={}, expected ~0", r.x[1]);
    assert!(r.fun < 1e-8, "fun={}, expected ~0", r.fun);
}

#[test]
fn maximize_bounded_negative_quadratic() {
    // f(x,y) = -(x^2 + y^2). Maximize with bounds x in [-5,5], y in [-5,5].
    // Maximize -(x^2+y^2) => find where -(x^2+y^2) is largest => at (0,0).
    // f(0,0) = 0. result.fun should be raw value = 0.
    let f = |x: &[f64]| -> f64 { -(x[0] * x[0] + x[1] * x[1]) };
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![3.0, 4.0],
        bounds: vec![Bound::bounded(-5.0, 5.0), Bound::bounded(-5.0, 5.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_lbfgsb(f, &config);
    assert!(r.converged, "msg: {}", r.message);
    // Raw value at (0,0) is 0
    assert!(r.fun.abs() < 1e-4, "fun={}, expected 0 (raw)", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 1e-3, "xi={}, expected ~0", xi);
    }
}

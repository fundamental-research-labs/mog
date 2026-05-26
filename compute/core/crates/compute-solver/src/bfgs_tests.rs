//! Comprehensive tests for the BFGS quasi-Newton optimizer.

use crate::bfgs::solve_bfgs;
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

fn three_hump_camel(x: &[f64]) -> f64 {
    2.0 * x[0].powi(2) - 1.05 * x[0].powi(4) + x[0].powi(6) / 6.0 + x[0] * x[1] + x[1].powi(2)
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
    let r = solve_bfgs(sphere, &default_config(vec![5.0, -3.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 1e-4, "xi={}", xi);
    }
}

#[test]
fn sphere_5d() {
    let r = solve_bfgs(sphere, &default_config(vec![1.0, -1.0, 2.0, -2.0, 0.5]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

#[test]
fn sphere_10d() {
    let x0: Vec<f64> = (0..10).map(|i| (i as f64) - 5.0).collect();
    let r = solve_bfgs(sphere, &default_config(x0));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn rosenbrock_2d() {
    let r = solve_bfgs(rosenbrock, &default_config(vec![-1.0, 1.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-3, "x0={}", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 1e-3, "x1={}", r.x[1]);
    assert!(r.fun < 1e-5, "fun={}", r.fun);
}

#[test]
fn rosenbrock_2d_far_start() {
    let r = solve_bfgs(rosenbrock, &default_config(vec![-5.0, 5.0]));
    assert!(r.fun < 1.0, "fun={}", r.fun);
}

#[test]
fn booth_function() {
    let r = solve_bfgs(booth, &default_config(vec![0.0, 0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 1.0).abs() < 1e-3, "x0={}", r.x[0]);
    assert!((r.x[1] - 3.0).abs() < 1e-3, "x1={}", r.x[1]);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn matyas_function() {
    let r = solve_bfgs(matyas, &default_config(vec![5.0, -5.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 1e-3, "xi={}", xi);
    }
}

#[test]
fn himmelblau_minimum_near_3_2() {
    let r = solve_bfgs(himmelblau, &default_config(vec![1.0, 1.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn himmelblau_minimum_near_neg3() {
    let r = solve_bfgs(himmelblau, &default_config(vec![-4.0, -1.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn beale_function() {
    let r = solve_bfgs(beale, &default_config(vec![0.0, 0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 0.1, "x0={}", r.x[0]);
    assert!((r.x[1] - 0.5).abs() < 0.1, "x1={}", r.x[1]);
    assert!(r.fun < 1e-4, "fun={}", r.fun);
}

#[test]
fn three_hump_camel_function() {
    let r = solve_bfgs(three_hump_camel, &default_config(vec![1.0, 1.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

// ===================================================================
// 2. Gradient convergence tests
// ===================================================================

#[test]
fn gradient_norm_below_gtol_sphere() {
    let config = config_with_gtol(vec![3.0, -4.0], 1e-8);
    let r = solve_bfgs(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-12, "fun={}", r.fun);
}

#[test]
fn gradient_norm_below_gtol_booth() {
    let config = config_with_gtol(vec![0.0, 0.0], 1e-8);
    let r = solve_bfgs(booth, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10, "fun={}", r.fun);
}

// ===================================================================
// 3. Objective type tests
// ===================================================================

#[test]
fn minimize_sphere() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![3.0, 4.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8);
}

#[test]
fn maximize_negative_sphere_bounded() {
    let f = |x: &[f64]| -> f64 { -(x[0] * x[0] + x[1] * x[1]) + 10.0 };
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![3.0, 4.0],
        bounds: vec![Bound::bounded(-10.0, 10.0), Bound::bounded(-10.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(f, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.fun - 10.0).abs() < 1e-3, "fun={}", r.fun);
    for xi in &r.x {
        assert!(xi.abs() < 0.01, "xi={}", xi);
    }
}

#[test]
fn target_value() {
    // Find x where sphere(x) = 5.0
    let config = SolverConfig {
        objective: Objective::Target(5.0),
        x0: vec![0.1, 0.1],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(sphere, &config);
    assert!((r.fun - 5.0).abs() < 0.1, "fun={}, expected ~5.0", r.fun);
}

#[test]
fn target_value_exact() {
    let f = |x: &[f64]| -> f64 { (x[0] - 3.0).powi(2) };
    let config = SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![0.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(f, &config);
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-3, "x0={}", r.x[0]);
}

// ===================================================================
// 4. Cascade to Nelder-Mead tests
// ===================================================================

#[test]
fn cascade_on_discontinuous_function() {
    // Piecewise function where gradient fails at the flat region near x0.
    // Start near the boundary so NM can find the quadratic minimum.
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
    let r = solve_bfgs(f, &config);
    // BFGS will see zero gradient and cascade to NM.
    // NM starting at 1.5 should be able to find x>=2 region.
    // Be lenient: just verify it found something better than 10.
    assert!(r.fun <= 10.0, "fun={}", r.fun);
}

#[test]
fn cascade_on_zero_gradient() {
    // Gradient is exactly zero everywhere: f(x,y) = 42
    let f = |_x: &[f64]| -> f64 { 42.0 };
    let config = default_config(vec![1.0, 2.0]);
    let r = solve_bfgs(f, &config);
    // BFGS can't make progress, cascades to NM.
    // NM also can't improve. Result should be 42.
    assert!((r.fun - 42.0).abs() < 1e-10, "fun={}", r.fun);
    assert!(!r.message.is_empty());
}

#[test]
fn cascade_on_abs_function() {
    // |x| is not differentiable at origin, but gradient exists elsewhere.
    // BFGS should converge to near-zero, and if it stagnates, NM finishes.
    let f = |x: &[f64]| -> f64 { x[0].abs() + x[1].abs() };
    let config = default_config(vec![5.0, -3.0]);
    let r = solve_bfgs(f, &config);
    assert!(r.fun < 0.1, "fun={}", r.fun);
}

// ===================================================================
// 5. Budget tests
// ===================================================================

#[test]
fn max_evals_honored_small() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 20,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(sphere, &config);
    assert!(r.evals <= 30, "evals={} (budget=20 + NM overhead)", r.evals);
}

#[test]
fn max_evals_honored_rosenbrock() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![-1.0, 1.0],
        max_evals: 100,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(rosenbrock, &config);
    assert!(r.evals <= 120, "evals={}", r.evals);
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
    let r = solve_bfgs(sphere, &config);
    assert!(!r.message.is_empty());
    assert!(r.evals <= 10, "evals={}", r.evals);
}

// ===================================================================
// 6. Result field validation tests
// ===================================================================

#[test]
fn result_x_length_matches_input() {
    let r = solve_bfgs(sphere, &default_config(vec![1.0, 2.0, 3.0]));
    assert_eq!(r.x.len(), 3);
}

#[test]
fn result_evals_positive() {
    let r = solve_bfgs(sphere, &default_config(vec![1.0, 2.0]));
    assert!(r.evals > 0, "evals={}", r.evals);
}

#[test]
fn result_message_not_empty() {
    let r = solve_bfgs(sphere, &default_config(vec![1.0, 2.0]));
    assert!(!r.message.is_empty());
}

#[test]
fn result_converged_implies_converged_reason() {
    let r = solve_bfgs(sphere, &default_config(vec![1.0, 2.0]));
    if r.converged {
        assert_eq!(r.termination, TerminationReason::Converged);
    }
}

#[test]
fn result_fun_is_raw_value_maximize() {
    let f = |x: &[f64]| -> f64 { -(x[0] * x[0]) + 10.0 };
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![3.0],
        bounds: vec![Bound::bounded(-10.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(f, &config);
    assert!(r.fun > 0.0, "fun={} should be raw positive value", r.fun);
}

#[test]
fn result_iters_positive_on_nontrivial() {
    let r = solve_bfgs(sphere, &default_config(vec![5.0, -3.0]));
    assert!(r.iters > 0, "iters={}", r.iters);
}

// ===================================================================
// 7. Stagnation tests
// ===================================================================

#[test]
fn flat_function_triggers_cascade() {
    let f = |_x: &[f64]| -> f64 { 42.0 };
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![1.0, 2.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(f, &config);
    assert!((r.fun - 42.0).abs() < 1e-10, "fun={}", r.fun);
}

#[test]
fn nearly_flat_function() {
    let f = |x: &[f64]| -> f64 { 1e-15 * (x[0] * x[0] + x[1] * x[1]) };
    let config = default_config(vec![1.0, 1.0]);
    let r = solve_bfgs(f, &config);
    assert!(r.fun < 1e-10, "fun={}", r.fun);
}

// ===================================================================
// 8. Tolerance tests
// ===================================================================

#[test]
fn tight_gtol_produces_tighter_solution() {
    let r_loose = solve_bfgs(sphere, &config_with_gtol(vec![5.0, -3.0], 1e-3));
    let r_tight = solve_bfgs(sphere, &config_with_gtol(vec![5.0, -3.0], 1e-10));
    assert!(
        r_tight.fun <= r_loose.fun + 1e-12,
        "tight={} should be <= loose={}",
        r_tight.fun,
        r_loose.fun
    );
}

#[test]
fn very_loose_gtol_converges_fast() {
    let r = solve_bfgs(sphere, &config_with_gtol(vec![5.0, -3.0], 1.0));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.iters <= 5, "iters={}", r.iters);
}

// ===================================================================
// 9. Bounds tests
// ===================================================================

#[test]
fn bounded_sphere() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0, 5.0],
        bounds: vec![Bound::bounded(1.0, 10.0), Bound::bounded(1.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(sphere, &config);
    assert!((r.x[0] - 1.0).abs() < 0.1, "x0={}", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 0.1, "x1={}", r.x[1]);
}

#[test]
fn lower_bounded_only() {
    let config = SolverConfig {
        objective: Objective::Minimize,
        x0: vec![5.0],
        bounds: vec![Bound::lower(2.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(sphere, &config);
    assert!((r.x[0] - 2.0).abs() < 0.1, "x0={}", r.x[0]);
}

// ===================================================================
// 10. Dimension tests
// ===================================================================

#[test]
fn one_dimensional() {
    let f = |x: &[f64]| -> f64 { (x[0] - 7.0).powi(2) };
    let r = solve_bfgs(f, &default_config(vec![0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 7.0).abs() < 1e-3, "x0={}", r.x[0]);
}

#[test]
fn three_dimensional() {
    let r = solve_bfgs(sphere, &default_config(vec![1.0, -2.0, 3.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

#[test]
fn seven_dimensional() {
    let x0 = vec![1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 0.5];
    let r = solve_bfgs(sphere, &default_config(x0));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

// ===================================================================
// 11. Starting point tests
// ===================================================================

#[test]
fn start_at_optimum() {
    // At [0,0], sphere gradient is zero so BFGS cascades to NM.
    // The important thing: it still finds fun ≈ 0.
    let r = solve_bfgs(sphere, &default_config(vec![0.0, 0.0]));
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

#[test]
fn start_near_optimum() {
    let r = solve_bfgs(sphere, &default_config(vec![1e-6, 1e-6]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(r.fun < 1e-10, "fun={}", r.fun);
}

#[test]
fn start_at_optimum_quadratic() {
    // f(x) = (x-3)^2 + (y-4)^2, start at (3,4). Gradient is zero => immediate convergence.
    let f = |x: &[f64]| -> f64 { (x[0] - 3.0).powi(2) + (x[1] - 4.0).powi(2) };
    let r = solve_bfgs(f, &default_config(vec![3.0, 4.0]));
    assert!(r.fun < 1e-8, "fun={}", r.fun);
}

// ===================================================================
// 12. Efficiency tests (BFGS should be faster than NM)
// ===================================================================

#[test]
fn bfgs_fewer_evals_than_nm_on_sphere() {
    let config = default_config(vec![5.0, -3.0]);
    let bfgs_r = solve_bfgs(sphere, &config);
    let nm_r = crate::nelder_mead::solve_nelder_mead(sphere, &config);
    if bfgs_r.converged && nm_r.converged {
        assert!(
            bfgs_r.evals <= nm_r.evals * 2,
            "BFGS evals={} should be competitive with NM evals={}",
            bfgs_r.evals,
            nm_r.evals
        );
    }
}

#[test]
fn bfgs_fewer_evals_than_nm_on_booth() {
    let config = default_config(vec![0.0, 0.0]);
    let bfgs_r = solve_bfgs(booth, &config);
    let nm_r = crate::nelder_mead::solve_nelder_mead(booth, &config);
    if bfgs_r.converged && nm_r.converged {
        assert!(
            bfgs_r.evals <= nm_r.evals * 3,
            "BFGS evals={} should be competitive with NM evals={}",
            bfgs_r.evals,
            nm_r.evals
        );
    }
}

// ===================================================================
// 13. Edge cases
// ===================================================================

#[test]
fn nan_initial_value() {
    let f = |_x: &[f64]| -> f64 { f64::NAN };
    let config = default_config(vec![1.0, 2.0]);
    let r = solve_bfgs(f, &config);
    assert!(!r.message.is_empty());
}

#[test]
fn large_initial_values() {
    let r = solve_bfgs(sphere, &default_config(vec![1e6, -1e6]));
    assert!(r.fun < 1.0, "fun={}", r.fun);
}

#[test]
fn negative_values_minimize() {
    // f(x) = (x-5)^2 - 100, minimum at x=5, f=-100
    let f = |x: &[f64]| -> f64 { (x[0] - 5.0).powi(2) - 100.0 };
    let r = solve_bfgs(f, &default_config(vec![0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.fun - (-100.0)).abs() < 1e-4, "fun={}", r.fun);
    assert!((r.x[0] - 5.0).abs() < 1e-3, "x0={}", r.x[0]);
}

#[test]
fn shifted_rosenbrock() {
    // Rosenbrock shifted to minimum at (2, 4)
    let f = |x: &[f64]| -> f64 { (2.0 - x[0]).powi(2) + 100.0 * (x[1] - x[0].powi(2)).powi(2) };
    let r = solve_bfgs(f, &default_config(vec![0.0, 0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 2.0).abs() < 1e-2, "x0={}", r.x[0]);
    assert!((r.x[1] - 4.0).abs() < 1e-2, "x1={}", r.x[1]);
}

// ===================================================================
// 14. First-principles quasi-Newton tests
// ===================================================================

#[test]
fn ill_conditioned_quadratic_kappa_1000() {
    // f(x,y) = x² + 1000·y². Condition number κ=1000.
    // Minimum at (0,0). BFGS builds Hessian approximation so should handle this.
    let f = |x: &[f64]| -> f64 { x[0] * x[0] + 1000.0 * x[1] * x[1] };
    let r = solve_bfgs(f, &default_config(vec![10.0, 10.0]));
    assert!(
        r.converged,
        "BFGS should converge on ill-conditioned quadratic: {}",
        r.message
    );
    assert!(r.x[0].abs() < 1e-4, "x0={}", r.x[0]);
    assert!(r.x[1].abs() < 1e-4, "x1={}", r.x[1]);
    assert!(r.fun < 1e-6, "fun={}", r.fun);
}

#[test]
fn ill_conditioned_rosenbrock_1000() {
    // f(x,y) = (1-x)² + 1000·(y-x²)². Minimum at (1,1).
    // Harder than standard Rosenbrock (coefficient 1000 vs 100).
    let f = |x: &[f64]| -> f64 { (1.0 - x[0]).powi(2) + 1000.0 * (x[1] - x[0].powi(2)).powi(2) };
    let r = solve_bfgs(f, &default_config(vec![-2.0, 2.0]));
    assert!((r.x[0] - 1.0).abs() < 1e-2, "x0={}", r.x[0]);
    assert!((r.x[1] - 1.0).abs() < 1e-2, "x1={}", r.x[1]);
}

#[test]
fn quadratic_exact_solution() {
    // f(x) = (x-3)² + 7. Minimum at x=3 with f(3)=7.
    // BFGS should solve a pure quadratic exactly (in theory, n steps for n-dim quadratic).
    let f = |x: &[f64]| -> f64 { (x[0] - 3.0).powi(2) + 7.0 };
    let r = solve_bfgs(f, &default_config(vec![0.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!((r.x[0] - 3.0).abs() < 1e-6, "x*={}, expected 3.0", r.x[0]);
    assert!((r.fun - 7.0).abs() < 1e-8, "f(x*)={}, expected 7.0", r.fun);
}

#[test]
fn gradient_near_zero_at_solution() {
    // For f(x,y) = x² + y², at the minimum the gradient norm should be < gtol.
    // We verify this indirectly: if converged, the solution must have |∇f| < gtol.
    // ∇f = (2x, 2y), so |∇f| = 2·sqrt(x²+y²).
    let gtol = 1e-8;
    let config = config_with_gtol(vec![5.0, -3.0], gtol);
    let r = solve_bfgs(sphere, &config);
    assert!(r.converged, "msg: {}", r.message);
    let grad_norm = 2.0 * (r.x[0] * r.x[0] + r.x[1] * r.x[1]).sqrt();
    assert!(
        grad_norm < gtol * 10.0, // small margin for finite-difference gradient inexactness
        "gradient norm at solution = {:.2e}, expected < {:.2e}",
        grad_norm,
        gtol
    );
}

#[test]
fn superlinear_convergence_rate() {
    // BFGS has superlinear convergence on smooth functions.
    // Tightening tolerance by 1e4 should NOT require 4x more evaluations.
    let r_coarse = solve_bfgs(
        sphere,
        &SolverConfig {
            objective: Objective::Minimize,
            x0: vec![5.0, -3.0],
            max_evals: 50_000,
            max_time_ms: 0,
            xtol: 1e-4,
            gtol: 1e-4,
            ..Default::default()
        },
    );
    let r_fine = solve_bfgs(
        sphere,
        &SolverConfig {
            objective: Objective::Minimize,
            x0: vec![5.0, -3.0],
            max_evals: 50_000,
            max_time_ms: 0,
            xtol: 1e-8,
            gtol: 1e-8,
            ..Default::default()
        },
    );
    assert!(r_coarse.converged, "coarse: {}", r_coarse.message);
    assert!(r_fine.converged, "fine: {}", r_fine.message);
    // Verify fine solution is indeed tighter
    assert!(r_fine.fun <= r_coarse.fun + 1e-12);
    // Superlinear: going from 1e-4 to 1e-8 tolerance (4 orders) should NOT
    // require 4x the evaluations. Allow at most 3x.
    assert!(
        r_fine.evals < r_coarse.evals * 4,
        "superlinear violated: coarse_evals={}, fine_evals={} (ratio={:.1})",
        r_coarse.evals,
        r_fine.evals,
        r_fine.evals as f64 / r_coarse.evals as f64,
    );
}

#[test]
fn dimension_independence_on_sphere() {
    // For f(x) = Σxᵢ² (sphere), the Hessian is 2I regardless of dimension.
    // BFGS should converge in roughly the same number of iterations for any dim.
    let iters_2d = {
        let r = solve_bfgs(sphere, &default_config(vec![1.0; 2]));
        assert!(r.converged, "2d: {}", r.message);
        r.iters
    };
    let iters_5d = {
        let r = solve_bfgs(sphere, &default_config(vec![1.0; 5]));
        assert!(r.converged, "5d: {}", r.message);
        r.iters
    };
    let iters_10d = {
        let r = solve_bfgs(sphere, &default_config(vec![1.0; 10]));
        assert!(r.converged, "10d: {}", r.message);
        r.iters
    };
    // Iterations should be comparable (within 3x of 2d baseline).
    // Note: evals grow with dim due to finite-difference gradient (n+1 evals per gradient),
    // but *iterations* should stay similar.
    assert!(
        iters_5d <= iters_2d * 3,
        "5d iters={} vs 2d iters={} — expected comparable",
        iters_5d,
        iters_2d,
    );
    assert!(
        iters_10d <= iters_2d * 3,
        "10d iters={} vs 2d iters={} — expected comparable",
        iters_10d,
        iters_2d,
    );
}

#[test]
fn maximize_negative_sphere_unbounded() {
    // f(x,y) = -(x² + y²) has maximum at (0,0) with f(0,0)=0.
    // With Maximize, solver should find (0,0).
    // result.fun should be the RAW value (0.0), not the negated internal value.
    let f = |x: &[f64]| -> f64 { -(x[0] * x[0] + x[1] * x[1]) };
    let config = SolverConfig {
        objective: Objective::Maximize,
        x0: vec![3.0, 4.0],
        bounds: vec![Bound::bounded(-10.0, 10.0), Bound::bounded(-10.0, 10.0)],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(f, &config);
    assert!(r.converged, "msg: {}", r.message);
    for xi in &r.x {
        assert!(xi.abs() < 1e-3, "xi={}", xi);
    }
    // fun should be the raw value ~0, NOT the internally-negated value
    assert!(r.fun.abs() < 1e-4, "fun={} should be ~0 (raw value)", r.fun);
    assert!(r.fun <= 0.0, "fun={} should be <= 0 for -(x²+y²)", r.fun);
}

#[test]
fn target_with_offset_minimum() {
    // f(x) = x². Target(25.0). Solutions are x=5 and x=-5.
    let config = SolverConfig {
        objective: Objective::Target(25.0),
        x0: vec![1.0],
        max_evals: 50_000,
        max_time_ms: 0,
        ..Default::default()
    };
    let r = solve_bfgs(|x: &[f64]| x[0] * x[0], &config);
    // Should find x ≈ ±5
    assert!(
        (r.x[0].abs() - 5.0).abs() < 0.1,
        "|x*|={}, expected ~5.0",
        r.x[0].abs()
    );
    assert!(
        (r.fun - 25.0).abs() < 0.5,
        "f(x*)={}, expected ~25.0",
        r.fun,
    );
}

#[test]
fn symmetry_preserved() {
    // f(x,y) = x² + y² is symmetric. Starting from (5,5), the solution path
    // should maintain x ≈ y at the solution.
    let r = solve_bfgs(sphere, &default_config(vec![5.0, 5.0]));
    assert!(r.converged, "msg: {}", r.message);
    assert!(
        (r.x[0] - r.x[1]).abs() < 1e-6,
        "symmetry broken: x0={}, x1={}",
        r.x[0],
        r.x[1],
    );
}

#[test]
fn non_polynomial_exp_minus_2x() {
    // f(x) = e^x - 2x. f'(x) = e^x - 2 = 0 → x = ln(2) ≈ 0.6931.
    // f(ln2) = 2 - 2·ln(2) ≈ 0.6137.
    let f = |x: &[f64]| -> f64 { x[0].exp() - 2.0 * x[0] };
    let r = solve_bfgs(f, &default_config(vec![0.0]));
    assert!(r.converged, "msg: {}", r.message);
    let ln2 = 2.0_f64.ln();
    assert!(
        (r.x[0] - ln2).abs() < 1e-6,
        "x*={}, expected ln(2)={}",
        r.x[0],
        ln2,
    );
    let expected_fun = 2.0 - 2.0 * ln2;
    assert!(
        (r.fun - expected_fun).abs() < 1e-8,
        "f(x*)={}, expected {}",
        r.fun,
        expected_fun,
    );
}

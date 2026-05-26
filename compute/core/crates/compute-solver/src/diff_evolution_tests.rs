//! Tests for Differential Evolution solver.

use crate::diff_evolution::solve_de;
use crate::types::{Bound, Objective, SolverConfig, TerminationReason};

// ---------------------------------------------------------------------------
// Helper: default DE config with seed = 42 for determinism
// ---------------------------------------------------------------------------

fn de_config(x0: Vec<f64>, bounds: Vec<Bound>) -> SolverConfig {
    SolverConfig {
        objective: Objective::Minimize,
        x0,
        bounds,
        seed: Some(42),
        max_evals: 50_000,
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Standard test functions
// ---------------------------------------------------------------------------

fn rastrigin(x: &[f64]) -> f64 {
    let n = x.len() as f64;
    10.0 * n
        + x.iter()
            .map(|xi| xi * xi - 10.0 * (2.0 * std::f64::consts::PI * xi).cos())
            .sum::<f64>()
}

fn ackley(x: &[f64]) -> f64 {
    let n = x.len() as f64;
    let sum_sq: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_cos: f64 = x
        .iter()
        .map(|xi| (2.0 * std::f64::consts::PI * xi).cos())
        .sum();
    -20.0 * (-0.2 * (sum_sq / n).sqrt()).exp() - (sum_cos / n).exp() + 20.0 + std::f64::consts::E
}

fn rosenbrock(x: &[f64]) -> f64 {
    x.windows(2)
        .map(|w| (1.0 - w[0]).powi(2) + 100.0 * (w[1] - w[0].powi(2)).powi(2))
        .sum()
}

fn sphere(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi * xi).sum()
}

// ---------------------------------------------------------------------------
// 1. Global convergence (~8 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_rastrigin_2d() {
    let config = de_config(vec![2.0, -2.0], vec![Bound::bounded(-5.12, 5.12); 2]);
    let result = solve_de(rastrigin, &config);
    // Global minimum at origin, f(0,0) = 0
    assert!(result.fun < 1.0, "rastrigin 2D: fun={}", result.fun);
    for xi in &result.x {
        assert!(xi.abs() < 0.5, "rastrigin 2D: x={:?}", result.x);
    }
}

#[test]
fn test_rastrigin_5d() {
    let config = de_config(
        vec![3.0, -3.0, 2.0, -2.0, 1.0],
        vec![Bound::bounded(-5.12, 5.12); 5],
    );
    let result = solve_de(rastrigin, &config);
    // More lenient for 5D — just check it finds a good region
    assert!(result.fun < 5.0, "rastrigin 5D: fun={}", result.fun);
}

#[test]
fn test_ackley_2d() {
    let config = de_config(vec![3.0, -3.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    let result = solve_de(ackley, &config);
    // Global minimum at origin, f(0,0) = 0
    assert!(result.fun < 1.0, "ackley 2D: fun={}", result.fun);
    for xi in &result.x {
        assert!(xi.abs() < 0.5, "ackley 2D: x={:?}", result.x);
    }
}

#[test]
fn test_rosenbrock_2d() {
    let config = de_config(vec![-1.0, -1.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    let result = solve_de(rosenbrock, &config);
    // Global minimum at (1,1), f(1,1) = 0
    assert!(result.fun < 0.1, "rosenbrock 2D: fun={}", result.fun);
    for xi in &result.x {
        assert!((xi - 1.0).abs() < 0.1, "rosenbrock 2D: x={:?}", result.x);
    }
}

#[test]
fn test_sphere_2d() {
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "sphere 2D: fun={}", result.fun);
    for xi in &result.x {
        assert!(xi.abs() < 1e-3, "sphere 2D: x={:?}", result.x);
    }
}

#[test]
fn test_sphere_5d() {
    let config = de_config(
        vec![5.0, -5.0, 3.0, -3.0, 1.0],
        vec![Bound::bounded(-10.0, 10.0); 5],
    );
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "sphere 5D: fun={}", result.fun);
}

#[test]
fn test_sphere_1d() {
    let config = de_config(vec![5.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "sphere 1D: fun={}", result.fun);
    assert!(result.x[0].abs() < 1e-3, "sphere 1D: x={:?}", result.x);
}

#[test]
fn test_rosenbrock_3d() {
    let mut config = de_config(vec![0.0, 0.0, 0.0], vec![Bound::bounded(-5.0, 5.0); 3]);
    config.max_evals = 100_000;
    let result = solve_de(rosenbrock, &config);
    assert!(result.fun < 1.0, "rosenbrock 3D: fun={}", result.fun);
}

// ---------------------------------------------------------------------------
// 2. Mutation strategies (~3 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_strategy_seed_100() {
    // Different seed should still converge on sphere
    let mut config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config.seed = Some(100);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "strategy seed=100: fun={}", result.fun);
}

#[test]
fn test_strategy_seed_999() {
    let mut config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config.seed = Some(999);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "strategy seed=999: fun={}", result.fun);
}

#[test]
fn test_strategy_seed_0() {
    let mut config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config.seed = Some(0);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "strategy seed=0: fun={}", result.fun);
}

// ---------------------------------------------------------------------------
// 3. Bounds (~6 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_all_bounded() {
    let config = de_config(vec![3.0, 3.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "all_bounded: fun={}", result.fun);
    // Verify solution within bounds
    for xi in &result.x {
        assert!(*xi >= -5.0 && *xi <= 5.0, "all_bounded: out of bounds");
    }
}

#[test]
fn test_solution_at_boundary() {
    // f(x) = (x - 5)^2 with bounds [0, 5] => solution at x = 5 (boundary)
    let f = |x: &[f64]| (x[0] - 5.0).powi(2);
    let config = de_config(vec![2.0], vec![Bound::bounded(0.0, 5.0)]);
    let result = solve_de(f, &config);
    assert!(result.fun < 1e-3, "boundary: fun={}", result.fun);
    assert!(
        (result.x[0] - 5.0).abs() < 0.01,
        "boundary: x[0]={}",
        result.x[0]
    );
}

#[test]
fn test_tight_bounds() {
    // Very tight bounds around the solution
    let config = de_config(vec![0.1], vec![Bound::bounded(-0.5, 0.5)]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "tight bounds: fun={}", result.fun);
    assert!(
        result.x[0] >= -0.5 && result.x[0] <= 0.5,
        "tight bounds: out of bounds"
    );
}

#[test]
fn test_mixed_bounded_unbounded() {
    // First dim bounded, second dim unbounded => uses perturbation init
    let config = de_config(
        vec![3.0, 3.0],
        vec![Bound::bounded(-10.0, 10.0), Bound::unbounded()],
    );
    let result = solve_de(sphere, &config);
    assert!(result.fun < 0.1, "mixed bounds: fun={}", result.fun);
}

#[test]
fn test_lower_bounded_only() {
    // Only lower-bounded
    let config = de_config(
        vec![3.0, 3.0],
        vec![Bound::lower(-10.0), Bound::lower(-10.0)],
    );
    let result = solve_de(sphere, &config);
    assert!(result.fun < 0.1, "lower bounded: fun={}", result.fun);
}

#[test]
fn test_upper_bounded_only() {
    // Only upper-bounded
    let config = de_config(
        vec![-3.0, -3.0],
        vec![Bound::upper(10.0), Bound::upper(10.0)],
    );
    let result = solve_de(sphere, &config);
    assert!(result.fun < 0.1, "upper bounded: fun={}", result.fun);
}

// ---------------------------------------------------------------------------
// 4. Population (~4 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_pop_size_2d() {
    // 2D: pop_size = max(15, 10*2) = 20
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(sphere, &config);
    // Just verify we converge; pop size is internally correct
    assert!(result.fun < 1e-3, "pop size 2D: fun={}", result.fun);
    // Minimum evals should be >= pop_size (initial eval)
    assert!(result.evals >= 20, "pop size 2D: evals={}", result.evals);
}

#[test]
fn test_pop_size_1d() {
    // 1D: pop_size = max(15, 10*1) = 15
    let config = de_config(vec![5.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "pop size 1D: fun={}", result.fun);
    assert!(result.evals >= 15, "pop size 1D: evals={}", result.evals);
}

#[test]
fn test_pop_size_10d() {
    // 10D: pop_size = max(15, 10*10) = 100
    let mut config = de_config(vec![1.0; 10], vec![Bound::bounded(-10.0, 10.0); 10]);
    config.max_evals = 200_000;
    let result = solve_de(sphere, &config);
    assert!(result.fun < 0.1, "pop size 10D: fun={}", result.fun);
    assert!(result.evals >= 100, "pop size 10D: evals={}", result.evals);
}

#[test]
fn test_lhs_coverage() {
    // Verify LHS produces good coverage: run on a function that needs
    // diverse initial sampling. Rastrigin's many local minima benefit.
    let config = de_config(vec![4.0, 4.0], vec![Bound::bounded(-5.12, 5.12); 2]);
    let result = solve_de(rastrigin, &config);
    assert!(result.fun < 1.0, "LHS coverage: fun={}", result.fun);
}

// ---------------------------------------------------------------------------
// 5. Objective types (~4 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_minimize() {
    let config = de_config(vec![5.0, 5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-3, "minimize: fun={}", result.fun);
}

#[test]
fn test_maximize() {
    // Maximize sphere on [-5, 5]^2 => maximum at a corner
    // sphere is non-negative, so max is at corner of bounds: |x| = 5
    let mut config = de_config(vec![0.0, 0.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    config.objective = Objective::Maximize;
    let result = solve_de(sphere, &config);
    // Maximum of sphere on [-5,5]^2 is 50 (at corner)
    assert!(result.fun > 40.0, "maximize: fun={}", result.fun);
}

#[test]
fn test_target() {
    // Target f(x) = 10 using sphere: x^2 = 10, so |x| ≈ 3.162
    let mut config = de_config(vec![0.0], vec![Bound::bounded(-5.0, 5.0)]);
    config.objective = Objective::Target(10.0);
    let result = solve_de(sphere, &config);
    assert!(
        (result.fun - 10.0).abs() < 0.1,
        "target: fun={}",
        result.fun
    );
}

#[test]
fn test_target_2d() {
    // Target f(x) = 5.0 with sphere: sum of squares = 5
    let mut config = de_config(vec![0.0, 0.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    config.objective = Objective::Target(5.0);
    let result = solve_de(sphere, &config);
    assert!(
        (result.fun - 5.0).abs() < 0.5,
        "target 2D: fun={}",
        result.fun
    );
}

// ---------------------------------------------------------------------------
// 6. Robustness (~8 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_nan_function() {
    // Function that returns NaN for some inputs
    let f = |x: &[f64]| {
        if x[0] < 0.0 {
            f64::NAN
        } else {
            (x[0] - 2.0).powi(2)
        }
    };
    let config = de_config(vec![3.0], vec![Bound::bounded(-5.0, 5.0)]);
    let result = solve_de(f, &config);
    // Should find minimum at x = 2 despite NaN region
    assert!(result.fun < 0.1, "NaN fn: fun={}", result.fun);
    assert!(
        (result.x[0] - 2.0).abs() < 0.5,
        "NaN fn: x[0]={}",
        result.x[0]
    );
}

#[test]
fn test_flat_landscape() {
    // Constant function: f(x) = 42
    let f = |_x: &[f64]| 42.0;
    let config = de_config(vec![1.0, 2.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(f, &config);
    assert!(
        (result.fun - 42.0).abs() < f64::EPSILON,
        "flat: fun={}",
        result.fun
    );
}

#[test]
fn test_10d_problem() {
    // 10D sphere
    let mut config = de_config(vec![5.0; 10], vec![Bound::bounded(-10.0, 10.0); 10]);
    config.max_evals = 200_000;
    let result = solve_de(sphere, &config);
    assert!(result.fun < 0.1, "10D sphere: fun={}", result.fun);
}

#[test]
fn test_max_evals_limit() {
    // Very small budget: can't converge but should not crash
    let mut config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config.max_evals = 50;
    let result = solve_de(sphere, &config);
    assert!(result.evals <= 50, "max_evals: evals={}", result.evals);
    assert!(
        result.termination == TerminationReason::MaxEvaluations,
        "max_evals: termination={:?}",
        result.termination
    );
}

#[test]
fn test_deterministic_same_seed() {
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let r1 = solve_de(sphere, &config);
    let r2 = solve_de(sphere, &config);
    assert_eq!(r1.x, r2.x, "determinism: x mismatch");
    assert_eq!(r1.fun, r2.fun, "determinism: fun mismatch");
    assert_eq!(r1.evals, r2.evals, "determinism: evals mismatch");
}

#[test]
fn test_different_seeds_different_results() {
    let mut config1 = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config1.seed = Some(42);
    config1.max_evals = 500; // Low budget so they likely diverge

    let mut config2 = config1.clone();
    config2.seed = Some(123);

    let r1 = solve_de(sphere, &config1);
    let r2 = solve_de(sphere, &config2);
    // They should have different trajectories (though both may converge to similar results)
    // With low evals, intermediate x values will differ
    assert!(
        r1.x != r2.x || r1.evals != r2.evals,
        "different seeds should produce different paths"
    );
}

#[test]
fn test_all_nan_region() {
    // Function always NaN except near origin
    let f = |x: &[f64]| {
        let r: f64 = x.iter().map(|xi| xi * xi).sum();
        if r > 25.0 { f64::NAN } else { r }
    };
    let config = de_config(vec![1.0, 1.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(f, &config);
    // Should still find a good solution in the non-NaN region
    assert!(result.fun < 1.0, "partial NaN: fun={}", result.fun);
}

#[test]
fn test_inf_function() {
    // Function that returns infinity for negative x
    let f = |x: &[f64]| {
        if x[0] < 0.0 {
            f64::INFINITY
        } else {
            (x[0] - 3.0).powi(2)
        }
    };
    let config = de_config(vec![2.0], vec![Bound::bounded(-5.0, 5.0)]);
    let result = solve_de(f, &config);
    assert!(result.fun < 0.1, "inf fn: fun={}", result.fun);
    assert!(
        (result.x[0] - 3.0).abs() < 0.5,
        "inf fn: x[0]={}",
        result.x[0]
    );
}

// ---------------------------------------------------------------------------
// 7. Edge cases (~6 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_1d_optimization() {
    // Simple 1D quadratic
    let f = |x: &[f64]| (x[0] - 3.0).powi(2);
    let config = de_config(vec![0.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(f, &config);
    assert!(result.fun < 1e-3, "1D: fun={}", result.fun);
    assert!((result.x[0] - 3.0).abs() < 0.05, "1D: x={}", result.x[0]);
}

#[test]
fn test_very_tight_bounds() {
    // Bounds so tight the solution is essentially fixed
    let config = de_config(vec![0.0], vec![Bound::bounded(-0.001, 0.001)]);
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1e-6, "very tight: fun={}", result.fun);
}

#[test]
fn test_asymmetric_bounds() {
    // f(x) = (x - 3)^2, bounds [2, 10]
    let f = |x: &[f64]| (x[0] - 3.0).powi(2);
    let config = de_config(vec![5.0], vec![Bound::bounded(2.0, 10.0)]);
    let result = solve_de(f, &config);
    assert!(result.fun < 0.01, "asymmetric: fun={}", result.fun);
    assert!(
        (result.x[0] - 3.0).abs() < 0.1,
        "asymmetric: x={}",
        result.x[0]
    );
}

#[test]
fn test_high_dimensional_sphere() {
    // 20D sphere with large budget
    let mut config = de_config(vec![3.0; 20], vec![Bound::bounded(-10.0, 10.0); 20]);
    config.max_evals = 500_000;
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1.0, "20D sphere: fun={}", result.fun);
}

#[test]
fn test_evals_count_accurate() {
    // Verify evals count is within expected range
    let mut config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config.max_evals = 1000;
    let result = solve_de(sphere, &config);
    assert!(
        result.evals > 0 && result.evals <= 1000,
        "evals count: {}",
        result.evals
    );
}

#[test]
fn test_iters_count_positive() {
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(sphere, &config);
    assert!(
        result.iters > 0,
        "iters should be positive: {}",
        result.iters
    );
}

// ---------------------------------------------------------------------------
// 8. Convergence / termination behavior (~6 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_converged_flag_sphere() {
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(sphere, &config);
    // Sphere should converge cleanly
    assert!(
        result.converged || result.termination == TerminationReason::Stagnation,
        "sphere should converge or stagnate: {:?}",
        result.termination
    );
}

#[test]
fn test_budget_exhaustion_returns_best() {
    let mut config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config.max_evals = 100;
    let result = solve_de(sphere, &config);
    // Even with low budget, should return best found (better than initial guess)
    assert!(result.fun < 50.0, "budget exhaust: fun={}", result.fun);
    assert!(
        !result.converged,
        "should not claim convergence with tiny budget"
    );
}

#[test]
fn test_message_nonempty() {
    let config = de_config(vec![5.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(sphere, &config);
    assert!(!result.message.is_empty(), "message should not be empty");
}

#[test]
fn test_elapsed_ms_non_negative() {
    let config = de_config(vec![5.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(sphere, &config);
    // elapsed_ms is u32, always >= 0 by type, but verify it's reasonable
    assert!(
        result.elapsed_ms < 30_000,
        "elapsed_ms too high: {}",
        result.elapsed_ms
    );
}

#[test]
fn test_result_x_length_matches_ndim() {
    let config = de_config(vec![5.0, -5.0, 3.0], vec![Bound::bounded(-10.0, 10.0); 3]);
    let result = solve_de(sphere, &config);
    assert_eq!(result.x.len(), 3, "x length should match ndim");
}

#[test]
fn test_fun_matches_solution() {
    // Verify that fun = f(x) at the reported solution
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(sphere, &config);
    let actual = sphere(&result.x);
    assert!(
        (result.fun - actual).abs() < 1e-10,
        "fun={} but f(x)={}",
        result.fun,
        actual
    );
}

// ---------------------------------------------------------------------------
// 9. Additional stress tests (~5 tests)
// ---------------------------------------------------------------------------

#[test]
fn test_wide_bounds() {
    // Very wide bounds: [-1000, 1000]
    let config = de_config(
        vec![500.0, -500.0],
        vec![Bound::bounded(-1000.0, 1000.0); 2],
    );
    let result = solve_de(sphere, &config);
    assert!(result.fun < 1.0, "wide bounds: fun={}", result.fun);
}

#[test]
fn test_negative_region_minimum() {
    // Minimum in negative region: f(x) = (x + 7)^2
    let f = |x: &[f64]| (x[0] + 7.0).powi(2);
    let config = de_config(vec![0.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(f, &config);
    assert!(result.fun < 0.01, "neg min: fun={}", result.fun);
    assert!(
        (result.x[0] + 7.0).abs() < 0.1,
        "neg min: x={}",
        result.x[0]
    );
}

#[test]
fn test_discontinuous_function() {
    // Step function — DE handles discontinuities well
    let f = |x: &[f64]| {
        let v = x[0].floor();
        (v - 3.0).powi(2) as f64
    };
    let config = de_config(vec![0.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result = solve_de(f, &config);
    // Should find x in [3, 4) so floor(x) = 3
    assert!(result.fun < 1.0, "discontinuous: fun={}", result.fun);
}

#[test]
fn test_multimodal_2d() {
    // Custom multimodal: f(x,y) = sin(x)^2 + sin(y)^2, min = 0 at multiples of pi
    let f = |x: &[f64]| x[0].sin().powi(2) + x[1].sin().powi(2);
    let config = de_config(vec![1.0, 1.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(f, &config);
    assert!(result.fun < 0.01, "multimodal: fun={}", result.fun);
}

#[test]
fn test_noisy_sphere() {
    // Sphere with small noise — DE should handle noise gracefully
    use std::cell::Cell;
    let counter = Cell::new(0u64);
    let f = |x: &[f64]| {
        let base: f64 = x.iter().map(|xi| xi * xi).sum();
        let c = counter.get();
        counter.set(c + 1);
        // Deterministic pseudo-noise based on eval count
        let noise = ((c as f64 * 1.618).sin() * 0.01).abs();
        base + noise
    };
    let config = de_config(vec![5.0, -5.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve_de(f, &config);
    // Should still converge close to origin despite noise
    assert!(result.fun < 0.1, "noisy sphere: fun={}", result.fun);
}

// ===========================================================================
// 10. First-principles mathematical tests
// ===========================================================================

#[test]
fn test_schwefel_deceptive_global() {
    // Schwefel function: f(x) = 418.9829*n - sum(xi * sin(sqrt(|xi|)))
    // Global minimum at xi = 420.9687 for all i, f ~ 0.
    // Many local minima make this deceptive. DE should outperform local search.
    let schwefel = |x: &[f64]| {
        let n = x.len() as f64;
        418.9829 * n - x.iter().map(|xi| xi * (xi.abs().sqrt()).sin()).sum::<f64>()
    };
    let mut config = de_config(vec![0.0, 0.0], vec![Bound::bounded(-500.0, 500.0); 2]);
    config.max_evals = 100_000;
    let result = solve_de(schwefel, &config);
    // f(0,0) = 418.9829*2 - 0 = 837.9658. DE should find something much better.
    let f_at_origin = schwefel(&[0.0, 0.0]);
    assert!(
        result.fun < f_at_origin * 0.5,
        "schwefel: DE result {} should be significantly better than f(0,0)={}",
        result.fun,
        f_at_origin
    );
}

#[test]
fn test_griewank_function() {
    // Griewank: f(x,y) = 1 + (x^2+y^2)/4000 - cos(x)*cos(y/sqrt(2))
    // Global minimum at (0,0) with f=0.
    let griewank = |x: &[f64]| {
        let sum_sq: f64 = x.iter().map(|xi| xi * xi).sum();
        let prod_cos: f64 = x
            .iter()
            .enumerate()
            .map(|(i, xi)| (xi / ((i + 1) as f64).sqrt()).cos())
            .product();
        1.0 + sum_sq / 4000.0 - prod_cos
    };
    let config = de_config(vec![25.0, -25.0], vec![Bound::bounded(-50.0, 50.0); 2]);
    let result = solve_de(griewank, &config);
    assert!(
        result.fun < 0.1,
        "griewank: fun={}, expected near 0",
        result.fun
    );
    for xi in &result.x {
        assert!(
            xi.abs() < 1.0,
            "griewank: expected near origin, got {:?}",
            result.x
        );
    }
}

#[test]
fn test_population_scales_with_dimension() {
    // For n=1, pop_size = max(15, 10) = 15. For n=10, pop_size = max(15, 100) = 100.
    // Both should converge on sphere, but 10D needs more evals (larger pop).
    let config_1d = de_config(vec![5.0], vec![Bound::bounded(-10.0, 10.0)]);
    let result_1d = solve_de(sphere, &config_1d);
    assert!(
        result_1d.fun < 1e-3,
        "1D sphere should converge: fun={}",
        result_1d.fun
    );
    // 1D needs at least 15 evals (initial pop)
    assert!(result_1d.evals >= 15, "1D evals={}", result_1d.evals);

    let mut config_10d = de_config(vec![1.0; 10], vec![Bound::bounded(-10.0, 10.0); 10]);
    config_10d.max_evals = 200_000;
    let result_10d = solve_de(sphere, &config_10d);
    assert!(
        result_10d.fun < 0.1,
        "10D sphere should converge: fun={}",
        result_10d.fun
    );
    // 10D needs at least 100 evals (initial pop = 10*10)
    assert!(result_10d.evals >= 100, "10D evals={}", result_10d.evals);
    // Higher dimension should use more evaluations
    assert!(
        result_10d.evals > result_1d.evals,
        "10D should use more evals ({}) than 1D ({})",
        result_10d.evals,
        result_1d.evals
    );
}

#[test]
fn test_seed_reproducibility_exact() {
    // Same seed, same config, same function => EXACTLY same result.
    let config = de_config(vec![3.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let r1 = solve_de(sphere, &config);
    let r2 = solve_de(sphere, &config);
    assert_eq!(r1.x, r2.x, "same seed must produce identical x");
    assert_eq!(r1.fun, r2.fun, "same seed must produce identical fun");
    assert_eq!(r1.evals, r2.evals, "same seed must produce identical evals");

    // Different seed => likely different x
    let mut config_diff = de_config(vec![3.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config_diff.seed = Some(9999);
    config_diff.max_evals = 500; // Low budget so paths diverge
    let mut config_orig = de_config(vec![3.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    config_orig.max_evals = 500;
    let r3 = solve_de(sphere, &config_orig);
    let r4 = solve_de(sphere, &config_diff);
    assert!(
        r3.x != r4.x || r3.evals != r4.evals,
        "different seeds should produce different paths"
    );
}

#[test]
fn test_bounds_always_respected() {
    // f(x,y) = x + y (minimize). Bounds [0, 10]. Global min at (0, 0) with f=0.
    // Key: all candidate solutions must stay within bounds.
    let f = |x: &[f64]| x[0] + x[1];
    let config = de_config(vec![5.0, 5.0], vec![Bound::bounded(0.0, 10.0); 2]);
    let result = solve_de(f, &config);
    // Solution must be within bounds
    for (i, xi) in result.x.iter().enumerate() {
        assert!(
            *xi >= 0.0 && *xi <= 10.0,
            "x[{}]={} out of bounds [0, 10]",
            i,
            xi
        );
    }
    // Minimum of x+y on [0,10]^2 is 0 at (0,0)
    assert!(
        result.fun < 0.1,
        "min of x+y on [0,10]^2 should be ~0, got {}",
        result.fun
    );
}

#[test]
fn test_de_finds_global_minimum() {
    // f(x) = x^4 - 16x^2 + 5x
    // f'(x) = 4x^3 - 32x + 5 = 0 has roots near x ~ -2.9035, x ~ 0.1564, x ~ 2.747
    // f(-2.9035) ~ (-2.9035)^4 - 16*(-2.9035)^2 + 5*(-2.9035)
    //           ~ 71.1 - 134.8 - 14.5 ~ -78.2  (global minimum)
    // f(2.747) ~ 56.9 - 120.7 + 13.7 ~ -50.1  (local minimum)
    // DE should find the global minimum near x ~ -2.9035.
    let f = |x: &[f64]| {
        let v = x[0];
        v.powi(4) - 16.0 * v * v + 5.0 * v
    };
    let config = de_config(vec![0.0], vec![Bound::bounded(-5.0, 5.0)]);
    let result = solve_de(f, &config);
    // The global min is near x ~ -2.9035 with f ~ -78.3
    assert!(
        result.fun < -70.0,
        "DE should find global min near f~-78, got f={}",
        result.fun
    );
    assert!(
        result.x[0] < -2.0,
        "global min is near x~-2.9, got x={}",
        result.x[0]
    );
}

#[test]
fn test_high_dimensional_30d_sphere() {
    // f(x) = sum(xi^2), 30D. Bounds [-10, 10]. Global min at origin.
    let mut config = de_config(vec![5.0; 30], vec![Bound::bounded(-10.0, 10.0); 30]);
    config.max_evals = 100_000;
    let result = solve_de(sphere, &config);
    // With 30D and 100k evals, expect reasonable convergence (not perfect)
    assert!(
        result.fun < 10.0,
        "30D sphere: fun={}, expected < 10",
        result.fun
    );
    // Verify all values are within bounds
    for (i, xi) in result.x.iter().enumerate() {
        assert!(
            *xi >= -10.0 && *xi <= 10.0,
            "30D sphere: x[{}]={} out of bounds",
            i,
            xi
        );
    }
}

#[test]
fn test_maximize_with_de() {
    // Maximize f(x,y) = -(x^2 + y^2). Maximum at (0,0) with f=0.
    // The function is always <= 0, so the maximum is 0.
    let f = |x: &[f64]| -(x[0] * x[0] + x[1] * x[1]);
    let mut config = de_config(vec![3.0, -3.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    config.objective = Objective::Maximize;
    let result = solve_de(f, &config);
    // result.fun is the raw (untransformed) value, should be ~0
    assert!(
        result.fun > -0.01,
        "maximize: fun={}, expected ~0",
        result.fun
    );
    for xi in &result.x {
        assert!(
            xi.abs() < 0.1,
            "maximize: expected near origin, got {:?}",
            result.x
        );
    }
}

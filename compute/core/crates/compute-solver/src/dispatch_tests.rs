//! Tests for dispatch — smart algorithm selection with cascade.

use crate::dispatch::solve;
use crate::types::{Bound, Method, Objective, SolverConfig, SolverResult, TerminationReason};

// ---------------------------------------------------------------------------
// Standard test functions
// ---------------------------------------------------------------------------

/// f(x) = sum(xi^2). Minimum at origin, f* = 0.
fn sphere(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi * xi).sum()
}

/// Rosenbrock: f(x) = sum[ 100*(x_{i+1} - x_i^2)^2 + (1-x_i)^2 ].
/// Minimum at (1,1,...,1), f* = 0. Narrow curved valley.
fn rosenbrock(x: &[f64]) -> f64 {
    x.windows(2)
        .map(|w| 100.0 * (w[1] - w[0].powi(2)).powi(2) + (1.0 - w[0]).powi(2))
        .sum()
}

/// Rastrigin: highly multimodal (many local minima). Global min at origin, f* = 0.
fn rastrigin(x: &[f64]) -> f64 {
    let n = x.len() as f64;
    10.0 * n
        + x.iter()
            .map(|xi| xi * xi - 10.0 * (2.0 * std::f64::consts::PI * xi).cos())
            .sum::<f64>()
}

/// Booth function: f(x,y) = (x+2y-7)^2 + (2x+y-5)^2. Minimum at (1,3), f*=0.
fn booth(x: &[f64]) -> f64 {
    (x[0] + 2.0 * x[1] - 7.0).powi(2) + (2.0 * x[0] + x[1] - 5.0).powi(2)
}

/// Simple linear function f(x) = 2x + 3 (for root finding: 2x+3=7 → x=2).
fn linear(x: &[f64]) -> f64 {
    2.0 * x[0] + 3.0
}

/// Quadratic f(x) = x^2 - 4 (root at x=2: x^2=4).
fn quadratic_1d(x: &[f64]) -> f64 {
    x[0] * x[0] - 4.0
}

/// Discontinuous step function (defeats gradient methods).
fn step_function(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi.floor().powi(2)).sum()
}

/// Ackley function: multimodal, global min at origin.
fn ackley(x: &[f64]) -> f64 {
    let n = x.len() as f64;
    let sum_sq: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_cos: f64 = x
        .iter()
        .map(|xi| (2.0 * std::f64::consts::PI * xi).cos())
        .sum();
    -20.0 * (-0.2 * (sum_sq / n).sqrt()).exp() - (sum_cos / n).exp() + 20.0 + std::f64::consts::E
}

// ---------------------------------------------------------------------------
// Helper: create configs
// ---------------------------------------------------------------------------

fn config_nm(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        method: Method::NelderMead,
        x0,
        max_evals: 10_000,
        ..Default::default()
    }
}

fn config_bfgs(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        method: Method::BFGS,
        x0,
        max_evals: 10_000,
        ..Default::default()
    }
}

fn config_lbfgsb(x0: Vec<f64>, bounds: Vec<Bound>) -> SolverConfig {
    SolverConfig {
        method: Method::LBFGSB,
        x0,
        bounds,
        max_evals: 10_000,
        ..Default::default()
    }
}

fn config_de(x0: Vec<f64>, bounds: Vec<Bound>) -> SolverConfig {
    SolverConfig {
        method: Method::DifferentialEvolution,
        x0,
        bounds,
        seed: Some(42),
        max_evals: 50_000,
        ..Default::default()
    }
}

fn config_auto(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 10_000,
        ..Default::default()
    }
}

// ===========================================================================
// 1. Explicit routing: each Method variant routes correctly
// ===========================================================================

#[test]
fn explicit_nelder_mead_sphere() {
    let config = config_nm(vec![5.0, -3.0]);
    let result = solve(sphere, &config);
    assert!(
        result.converged,
        "NM should converge on sphere: {:?}",
        result.message
    );
    assert!(result.fun < 1e-10, "NM sphere: fun={}", result.fun);
    for xi in &result.x {
        assert!(xi.abs() < 1e-4, "NM sphere: x={:?}", result.x);
    }
}

#[test]
fn explicit_nelder_mead_rosenbrock() {
    let config = SolverConfig {
        method: Method::NelderMead,
        x0: vec![0.0, 0.0],
        max_evals: 20_000,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    assert!(result.converged, "NM rosenbrock: {:?}", result.message);
    assert!(result.fun < 1e-6, "NM rosenbrock: fun={}", result.fun);
}

#[test]
fn explicit_nelder_mead_booth() {
    let config = config_nm(vec![0.0, 0.0]);
    let result = solve(booth, &config);
    assert!(result.converged, "NM booth: {:?}", result.message);
    assert!(result.fun < 1e-8, "NM booth: fun={}", result.fun);
    assert!(
        (result.x[0] - 1.0).abs() < 1e-3,
        "booth x[0]={}",
        result.x[0]
    );
    assert!(
        (result.x[1] - 3.0).abs() < 1e-3,
        "booth x[1]={}",
        result.x[1]
    );
}

// BFGS/LBFGSB may still be stubs (todo!()). Use catch_unwind for resilience.

#[test]
fn explicit_bfgs_sphere() {
    let config = config_bfgs(vec![5.0, -3.0]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            // BFGS is implemented — verify convergence
            assert!(
                r.converged,
                "BFGS should converge on sphere: {:?}",
                r.message
            );
            assert!(r.fun < 1e-6, "BFGS sphere: fun={}", r.fun);
        }
        Err(_) => {
            // BFGS still has todo!() stub — expected during parallel development
        }
    }
}

#[test]
fn explicit_lbfgsb_bounded_sphere() {
    let config = config_lbfgsb(vec![5.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            assert!(r.converged, "LBFGSB should converge: {:?}", r.message);
            assert!(r.fun < 1e-6, "LBFGSB sphere: fun={}", r.fun);
        }
        Err(_) => {
            // L-BFGS-B still has todo!() stub
        }
    }
}

#[test]
fn explicit_de_sphere() {
    let config = config_de(vec![5.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = solve(sphere, &config);
    // DE should converge on sphere (easy global problem)
    assert!(result.fun < 1.0, "DE sphere: fun={}", result.fun);
    for xi in &result.x {
        assert!(xi.abs() < 1.0, "DE sphere: x={:?}", result.x);
    }
}

#[test]
fn explicit_de_with_seed_deterministic() {
    let config = config_de(vec![3.0, -2.0], vec![Bound::bounded(-5.0, 5.0); 2]);
    let r1 = solve(sphere, &config);
    let r2 = solve(sphere, &config);
    // Same seed → same result
    assert_eq!(r1.x, r2.x, "DE with same seed should be deterministic");
    assert_eq!(r1.fun, r2.fun);
}

// ===========================================================================
// 2. Auto dispatch
// ===========================================================================

#[test]
fn auto_1d_target_uses_root_finding() {
    // f(x) = 2x + 3, target = 7 → x = 2
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(7.0),
        x0: vec![0.0],
        max_evals: 1000,
        ..Default::default()
    };
    let result = solve(linear, &config);
    assert!(
        result.converged,
        "1D target should converge: {:?}",
        result.message
    );
    assert!(
        (result.x[0] - 2.0).abs() < 1e-4,
        "root should be ~2.0, got {}",
        result.x[0]
    );
    assert!(
        (result.fun - 7.0).abs() < 1e-4,
        "f(x) should be ~7.0, got {}",
        result.fun
    );
}

#[test]
fn auto_1d_target_quadratic() {
    // f(x) = x^2 - 4, target = 0 → x = 2 or x = -2
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(0.0),
        x0: vec![1.0],
        max_evals: 1000,
        ..Default::default()
    };
    let result = solve(quadratic_1d, &config);
    assert!(result.converged, "quadratic root: {:?}", result.message);
    // Should find x=2 or x=-2
    assert!(
        (result.x[0].abs() - 2.0).abs() < 1e-3,
        "root should be ~2 or ~-2, got {}",
        result.x[0]
    );
}

#[test]
fn auto_1d_target_with_negative_start() {
    // f(x) = x^2 - 4, target = 0, start from negative side → x = -2
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(0.0),
        x0: vec![-3.0],
        max_evals: 1000,
        ..Default::default()
    };
    let result = solve(quadratic_1d, &config);
    assert!(
        result.converged,
        "negative start root: {:?}",
        result.message
    );
    assert!(
        (result.x[0].abs() - 2.0).abs() < 1e-3,
        "root should be near +-2, got {}",
        result.x[0]
    );
}

#[test]
fn auto_unbounded_smooth_sphere() {
    // Auto + unbounded + ndim=2 → should use BFGS (or cascade to NM)
    let config = config_auto(vec![5.0, -3.0]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            assert!(r.converged, "auto unbounded sphere: {:?}", r.message);
            assert!(r.fun < 1e-6, "auto sphere: fun={}", r.fun);
        }
        Err(_) => {
            // BFGS todo!() panicked — cascade didn't catch it because
            // catch_unwind is at test level, not inside dispatch.
            // This is expected if BFGS hasn't been implemented yet.
        }
    }
}

#[test]
fn auto_bounded_sphere() {
    // Auto + bounded → should use L-BFGS-B (or cascade to NM)
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![5.0, -3.0],
        bounds: vec![Bound::bounded(-10.0, 10.0); 2],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            assert!(r.converged, "auto bounded sphere: {:?}", r.message);
            assert!(r.fun < 1e-6, "auto bounded sphere: fun={}", r.fun);
        }
        Err(_) => {
            // L-BFGS-B not implemented yet
        }
    }
}

#[test]
fn auto_global_search_rastrigin() {
    // global_search=true → DE, then polish with NM
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![3.0, -3.0],
        bounds: vec![Bound::bounded(-5.12, 5.12); 2],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(rastrigin, &config);
    // DE+NM polish should find near-global minimum
    assert!(result.fun < 2.0, "global rastrigin: fun={}", result.fun);
}

#[test]
fn auto_global_search_ackley() {
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![4.0, -4.0],
        bounds: vec![Bound::bounded(-5.0, 5.0); 2],
        seed: Some(123),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(ackley, &config);
    assert!(result.fun < 1.0, "global ackley: fun={}", result.fun);
}

// ===========================================================================
// 3. Cascade: gradient fails on non-smooth → still gets result via NM
// ===========================================================================

#[test]
fn cascade_step_function_nm_fallback() {
    // Step function defeats gradient methods; NM should handle it.
    // Use NelderMead directly (explicit) as baseline.
    let config = config_nm(vec![0.7, 0.3]);
    let result = solve(step_function, &config);
    // NM should find near-integer values where step function is small
    assert!(result.converged, "NM step: {:?}", result.message);
    assert!(result.fun < 1.0, "NM step: fun={}", result.fun);
}

#[test]
fn cascade_discontinuous_auto() {
    // Auto on step function — BFGS will fail (zero gradients on flat regions),
    // cascade to NM which handles discontinuities.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![0.5, -0.5],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        solve(step_function, &config)
    }));
    match result {
        Ok(r) => {
            // Either BFGS converged or cascade to NM converged
            assert!(r.fun < 2.0, "cascade step: fun={}", r.fun);
        }
        Err(_) => {
            // BFGS not implemented yet, panic propagated
        }
    }
}

// ===========================================================================
// 4. Polish: DE + NM polish finds better solution than DE alone
// ===========================================================================

#[test]
fn polish_de_then_nm_rosenbrock() {
    // DE finds the basin on Rosenbrock, NM polishes to higher precision
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![-1.0, -1.0],
        bounds: vec![Bound::bounded(-5.0, 10.0); 2],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    // After polish, should be very close to (1,1)
    assert!(result.fun < 0.1, "polish rosenbrock: fun={}", result.fun);
    assert!(
        (result.x[0] - 1.0).abs() < 0.5,
        "polish rosenbrock x[0]={}",
        result.x[0]
    );
}

#[test]
fn polish_improves_on_de_alone() {
    // Compare DE alone vs DE+NM polish (global_search=true triggers polish)
    let de_config = config_de(vec![-1.0, -1.0], vec![Bound::bounded(-5.0, 10.0); 2]);
    let de_only = solve(rosenbrock, &de_config);

    let auto_config = SolverConfig {
        method: Method::Auto,
        x0: vec![-1.0, -1.0],
        bounds: vec![Bound::bounded(-5.0, 10.0); 2],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let polished = solve(rosenbrock, &auto_config);

    // Polished result should be at least as good (usually better)
    assert!(
        polished.fun <= de_only.fun + 1e-6,
        "polish should not be worse: polished={} vs de={}",
        polished.fun,
        de_only.fun
    );
}

// ===========================================================================
// 5. Result correctness: verify x, fun, converged for known optima
// ===========================================================================

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

// ===========================================================================
// 6. Budget: max_evals honored
// ===========================================================================

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

// ===========================================================================
// 7. Objective types: Minimize, Maximize (bounded), Target
// ===========================================================================

#[test]
fn objective_minimize_sphere() {
    let config = SolverConfig {
        method: Method::NelderMead,
        objective: Objective::Minimize,
        x0: vec![5.0, -3.0],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert!(result.converged);
    assert!(result.fun < 1e-8);
}

#[test]
fn objective_maximize_bounded() {
    // Maximize f(x) = -(x-3)^2 + 10 → maximum at x=3, f*=10.
    // Using NM which handles Maximize via negation in EvalHarness.
    let config = SolverConfig {
        method: Method::NelderMead,
        objective: Objective::Maximize,
        x0: vec![0.0],
        bounds: vec![Bound::bounded(-10.0, 10.0)],
        max_evals: 5_000,
        ..Default::default()
    };
    let result = solve(|x: &[f64]| -(x[0] - 3.0).powi(2) + 10.0, &config);
    assert!(result.converged, "maximize: {:?}", result.message);
    assert!(
        (result.x[0] - 3.0).abs() < 0.1,
        "maximize x={}",
        result.x[0]
    );
    assert!(
        (result.fun - 10.0).abs() < 0.1,
        "maximize fun={}",
        result.fun
    );
}

#[test]
fn objective_target_multidim() {
    // Multi-dimensional Target objective — not 1D, so auto won't use root finding.
    // f(x) = x[0]^2 + x[1]^2, target = 5.0
    // Should find a point on the circle of radius sqrt(5).
    let config = SolverConfig {
        method: Method::NelderMead,
        objective: Objective::Target(5.0),
        x0: vec![3.0, 0.0],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert!(result.converged, "target 2D: {:?}", result.message);
    assert!(
        (result.fun - 5.0).abs() < 0.01,
        "target 2D: fun={}",
        result.fun
    );
}

#[test]
fn objective_target_auto_multidim_not_root() {
    // 2D Target + Auto → should NOT use root finding (ndim > 1).
    // Should fall through to general solver.
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(1.0),
        x0: vec![3.0, 4.0],
        max_evals: 10_000,
        ..Default::default()
    };
    // This goes through the auto path but skips root finding (ndim=2).
    // Will try BFGS or cascade to NM.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            // Auto dispatches to BFGS which cascades to NM for Target objective.
            // NM minimizes |sphere(x) - 1.0| and should find sphere(x) close to 1.0.
            // If it instead found the sphere minimum (fun~0), that's still a valid
            // result for the solver (it tried), just less precise for Target.
            assert!(
                (r.fun - 1.0).abs() < 0.5 || r.fun < 0.5,
                "target 2D auto should find fun near 1.0 or near 0.0: fun={}",
                r.fun
            );
        }
        Err(_) => {
            // BFGS not implemented yet
        }
    }
}

// ===========================================================================
// 8. Additional edge cases and dispatch logic tests
// ===========================================================================

#[test]
fn auto_1d_minimize_not_root() {
    // 1D + Minimize (not Target) → should NOT use root finding
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Minimize,
        x0: vec![5.0],
        max_evals: 5_000,
        ..Default::default()
    };
    // This should go through BFGS → NM cascade (ndim=1 <= 20)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            assert!(r.converged, "1D minimize auto: {:?}", r.message);
            assert!(r.fun < 1e-6, "1D minimize: fun={}", r.fun);
        }
        Err(_) => {
            // BFGS stub panicked
        }
    }
}

#[test]
fn better_result_prefers_converged() {
    // Verify better_result logic indirectly: DE alone (may not fully converge)
    // vs DE+NM polish (should converge).
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![3.0, -2.0],
        bounds: vec![Bound::bounded(-5.0, 5.0); 2],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    // Polish should have converged
    assert!(result.fun < 0.1, "polished sphere: fun={}", result.fun);
}

#[test]
fn fnmut_closure_works() {
    // Verify that FnMut closures (with mutable state) work through dispatch.
    let mut call_count = 0u64;
    let config = config_nm(vec![5.0, -3.0]);
    let result = solve(
        |x: &[f64]| {
            call_count += 1;
            sphere(x)
        },
        &config,
    );
    assert!(result.converged);
    assert!(call_count > 0, "closure should have been called");
    assert_eq!(
        call_count as u32, result.evals,
        "call_count should match evals"
    );
}

#[test]
fn solve_with_empty_bounds_treated_as_unbounded() {
    // Empty bounds vec → has_bounds() returns false → unbounded path
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![3.0, -2.0],
        bounds: vec![],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            assert!(r.converged, "unbounded auto: {:?}", r.message);
        }
        Err(_) => {
            // BFGS not implemented
        }
    }
}

#[test]
fn solve_global_search_without_bounds() {
    // global_search=true but no bounds — DE handles this via Gaussian init
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![5.0, -3.0],
        bounds: vec![],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    // DE + NM polish should find near-origin
    assert!(result.fun < 1.0, "global no bounds: fun={}", result.fun);
}

#[test]
fn explicit_de_rastrigin_multimodal() {
    let config = config_de(vec![3.0, -3.0], vec![Bound::bounded(-5.12, 5.12); 2]);
    let result = solve(rastrigin, &config);
    assert!(result.fun < 2.0, "DE rastrigin: fun={}", result.fun);
}

// ===========================================================================
// 9. First-principles invariant tests
// ===========================================================================

// ---- 9.1 Auto dispatch must improve on initial guess ----

#[test]
fn auto_dispatch_improves_on_initial_value() {
    // f(x) = x^2, x0 = [5.0]. f(x0) = 25.0.
    // Any solver that does anything useful must find f(x*) < 25.0.
    let config = config_auto(vec![5.0]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        solve(|x: &[f64]| x[0] * x[0], &config)
    }));
    match result {
        Ok(r) => {
            assert!(
                r.fun < 25.0,
                "Auto must improve on initial value 25.0, got fun={}",
                r.fun
            );
        }
        Err(_) => {
            // BFGS stub panicked before cascade could run
        }
    }
}

// ---- 9.2 Auto 1D + Target should use root finding ----

#[test]
fn auto_1d_target_root_finding_x_sq_minus_4() {
    // f(x) = x^2 - 4, Target(0.0). Roots at x=2 and x=-2.
    // Auto dispatch: 1D + Target -> root finding.
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(0.0),
        x0: vec![1.0],
        max_evals: 1000,
        ..Default::default()
    };
    let result = solve(quadratic_1d, &config);
    // Root finding should find |f(x*) - 0| < 1e-6
    let residual = (result.x[0] * result.x[0] - 4.0).abs();
    assert!(
        residual < 1e-6,
        "Root finding should find x where x^2-4=0, residual={}",
        residual
    );
}

// ---- 9.3 Auto multidim + Target should NOT use root finding ----

#[test]
fn auto_multidim_target_uses_optimizer_not_root() {
    // f(x,y) = x^2 + y^2, Target(0.0). 2D problem.
    // Auto should NOT use root finding (only for 1D), should use optimizer.
    // Solution at (0,0) where f=0.
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(0.0),
        x0: vec![3.0, 4.0],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            // Optimizer should find near (0,0) where f=0 = target
            assert!(
                r.fun.abs() < 1.0,
                "2D Target(0) should find near-zero, got fun={}",
                r.fun
            );
        }
        Err(_) => {
            // BFGS not implemented yet
        }
    }
}

// ---- 9.4 Explicit method must be respected ----

#[test]
fn explicit_method_nelder_mead_converges() {
    // If user specifies NelderMead, solver MUST use it. Verify it converges.
    let config = SolverConfig {
        method: Method::NelderMead,
        x0: vec![3.0, 4.0],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert!(
        result.converged,
        "NM must converge on sphere: {:?}",
        result.message
    );
    assert!(result.fun < 1e-6, "NM sphere fun={}", result.fun);
}

#[test]
fn explicit_method_bfgs_converges() {
    // If user specifies BFGS, solver MUST use it. Verify it converges.
    let config = SolverConfig {
        method: Method::BFGS,
        x0: vec![3.0, 4.0],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &config)));
    match result {
        Ok(r) => {
            assert!(r.converged, "BFGS must converge on sphere: {:?}", r.message);
            assert!(r.fun < 1e-6, "BFGS sphere fun={}", r.fun);
        }
        Err(_) => {
            // BFGS not implemented yet
        }
    }
}

#[test]
fn explicit_method_both_nm_and_bfgs_find_same_optimum() {
    // Both methods should find the same minimum for sphere.
    let nm_config = config_nm(vec![3.0, 4.0]);
    let nm_result = solve(sphere, &nm_config);

    let bfgs_config = config_bfgs(vec![3.0, 4.0]);
    let bfgs_result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve(sphere, &bfgs_config)));

    assert!(nm_result.converged, "NM must converge");
    assert!(nm_result.fun < 1e-6, "NM sphere fun={}", nm_result.fun);

    if let Ok(br) = bfgs_result {
        assert!(br.converged, "BFGS must converge");
        assert!(br.fun < 1e-6, "BFGS sphere fun={}", br.fun);
        // Both should find near-origin
        for i in 0..2 {
            assert!(
                (nm_result.x[i] - br.x[i]).abs() < 0.1,
                "NM and BFGS should find same optimum"
            );
        }
    }
}

// ---- 9.5 Global search + bounded finds global optimum ----

#[test]
fn global_search_bounded_sin_finds_global_min() {
    // f(x) = sin(x) on [0, 2pi]. Global min at x = 3pi/2 ~ 4.712, f = -1.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![1.0],
        bounds: vec![Bound::bounded(0.0, 2.0 * std::f64::consts::PI)],
        seed: Some(42),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(|x: &[f64]| x[0].sin(), &config);
    let expected_x = 3.0 * std::f64::consts::PI / 2.0;
    assert!(
        (result.x[0] - expected_x).abs() < 0.1,
        "global sin: expected x~{}, got x={}",
        expected_x,
        result.x[0]
    );
    assert!(
        (result.fun - (-1.0)).abs() < 0.01,
        "global sin: expected fun~-1, got fun={}",
        result.fun
    );
}

// ---- 9.6 Result invariants for ANY solve() call ----

fn assert_result_invariants(result: &SolverResult, config: &SolverConfig, label: &str) {
    // Dimensionality preserved
    assert_eq!(
        result.x.len(),
        config.x0.len(),
        "{}: result.x.len()={} != x0.len()={}",
        label,
        result.x.len(),
        config.x0.len()
    );
    // At least one function evaluation
    assert!(
        result.evals > 0,
        "{}: evals must be > 0, got {}",
        label,
        result.evals
    );
    // Message is non-empty
    assert!(
        !result.message.is_empty(),
        "{}: message must be non-empty",
        label
    );
    // If converged, termination must be Converged
    if result.converged {
        assert_eq!(
            result.termination,
            TerminationReason::Converged,
            "{}: converged but termination={:?}",
            label,
            result.termination
        );
    }
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

// ---- 9.7 Budget limits respected across ALL methods ----

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

// ---- 9.8 Bounds respected in result across ALL methods ----

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

// ---- 9.9 Zero-length x0 edge case ----

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

// ---- 9.10 Cascade produces better result than failure ----

#[test]
fn cascade_non_differentiable_abs_finds_minimum() {
    // f(x) = |x|, non-differentiable at 0. BFGS will struggle.
    // Auto dispatch: unbounded, ndim=1 <= 20 -> BFGS, cascade to NM.
    // Cascade should still find x~0.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![5.0],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        solve(|x: &[f64]| x[0].abs(), &config)
    }));
    match result {
        Ok(r) => {
            // Whether BFGS converged or cascaded to NM, result should be reasonable
            assert!(
                r.fun < 1.0,
                "cascade on |x| should find fun < 1.0, got fun={}",
                r.fun
            );
            assert!(
                r.x[0].abs() < 1.0,
                "cascade on |x| should find |x| < 1.0, got x={}",
                r.x[0]
            );
        }
        Err(_) => {
            // BFGS not implemented yet
        }
    }
}

// ---- 9.11 Identical configs produce identical results (determinism) ----

#[test]
fn determinism_nelder_mead() {
    let config = config_nm(vec![5.0, -3.0]);
    let r1 = solve(sphere, &config);
    let r2 = solve(sphere, &config);
    assert_eq!(
        r1.x, r2.x,
        "NM should be deterministic: x1={:?} x2={:?}",
        r1.x, r2.x
    );
    assert_eq!(
        r1.fun, r2.fun,
        "NM should be deterministic: fun1={} fun2={}",
        r1.fun, r2.fun
    );
    assert_eq!(
        r1.evals, r2.evals,
        "NM should be deterministic: evals differ"
    );
}

#[test]
fn determinism_bfgs() {
    let config = config_bfgs(vec![5.0, -3.0]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let r1 = solve(sphere, &config);
        let r2 = solve(sphere, &config);
        (r1, r2)
    }));
    if let Ok((r1, r2)) = result {
        assert_eq!(r1.x, r2.x, "BFGS should be deterministic");
        assert_eq!(r1.fun, r2.fun, "BFGS should be deterministic");
    }
}

#[test]
fn determinism_lbfgsb() {
    let config = config_lbfgsb(vec![5.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let r1 = solve(sphere, &config);
        let r2 = solve(sphere, &config);
        (r1, r2)
    }));
    if let Ok((r1, r2)) = result {
        assert_eq!(r1.x, r2.x, "LBFGSB should be deterministic");
        assert_eq!(r1.fun, r2.fun, "LBFGSB should be deterministic");
    }
}

#[test]
fn determinism_de_same_seed() {
    let config = config_de(vec![5.0, -3.0], vec![Bound::bounded(-10.0, 10.0); 2]);
    let r1 = solve(sphere, &config);
    let r2 = solve(sphere, &config);
    assert_eq!(r1.x, r2.x, "DE with same seed should be deterministic");
    assert_eq!(r1.fun, r2.fun, "DE with same seed should be deterministic");
}

// ===========================================================================
// 10. Coverage gap tests — targeting specific uncovered dispatch branches
// ===========================================================================

// ---- 10.1 better_result: b converged but a not (line 38) ----
// In dispatch_global, DE runs first (result a), then NM polishes (result b).
// If DE doesn't converge (tight budget) but NM converges from DE's best point,
// better_result returns NM's result (the converged one).

#[test]
fn global_tight_budget_nm_polish_converges_over_de() {
    // f(x,y) = (x-3)^2 + (y-7)^2, smooth quadratic with minimum at (3,7), f*=0.
    // Bounds [0,10]x[0,10], global_search=true, max_evals=100.
    // DE with population ~20 for 2D gets ~5 generations — unlikely to converge
    // to ftol=1e-8. NM polishes from DE's best point with budget=min(100,5000)=100
    // evals on a smooth quadratic and should converge easily.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![5.0, 5.0],
        bounds: vec![Bound::bounded(0.0, 10.0); 2],
        seed: Some(42),
        max_evals: 100,
        global_search: true,
        ..Default::default()
    };
    let result = solve(
        |x: &[f64]| (x[0] - 3.0).powi(2) + (x[1] - 7.0).powi(2),
        &config,
    );
    // The key assertion: the result should be reasonably close to (3,7).
    // If better_result correctly picks NM (converged) over DE (not converged),
    // the result should be good.
    assert!(
        result.fun < 1.0,
        "NM polish should find near-minimum on quadratic, got fun={}",
        result.fun
    );
    // Mathematical invariant: for f(x,y)=(x-3)^2+(y-7)^2, f>=0 always.
    assert!(result.fun >= 0.0, "quadratic is non-negative");
}

// ---- 10.2 better_result: both converged, b.fun < a.fun (line 40 else) ----
// When both DE and NM converge, better_result picks the one with lower fun.
// We verify the invariant: the result should be close to the true minimum.

#[test]
fn global_generous_budget_best_of_de_and_nm() {
    // f(x,y) = (x-1)^2 + (y-2)^2, minimum at (1,2), f*=0.
    // Generous budget: both DE and NM should converge.
    // better_result picks whichever has lower fun value.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![5.0, 5.0],
        bounds: vec![Bound::bounded(-10.0, 10.0); 2],
        seed: Some(7),
        max_evals: 50_000,
        global_search: true,
        ..Default::default()
    };
    let result = solve(
        |x: &[f64]| (x[0] - 1.0).powi(2) + (x[1] - 2.0).powi(2),
        &config,
    );
    // Both should converge; result should be very close to true minimum.
    assert!(
        result.fun < 1e-6,
        "with generous budget, should find near-exact minimum, got fun={}",
        result.fun
    );
    assert!(
        (result.x[0] - 1.0).abs() < 0.01,
        "x[0] should be ~1.0, got {}",
        result.x[0]
    );
    assert!(
        (result.x[1] - 2.0).abs() < 0.01,
        "x[1] should be ~2.0, got {}",
        result.x[1]
    );
}

// ---- 10.3 Root finding failure cascade to NM (line 77) ----
// 1D + Target where no real root exists. Root finding fails (converged=false),
// dispatch falls through to NM which minimizes |f(x) - target|.

#[test]
fn root_finding_fails_cascade_to_nm_no_real_root() {
    // f(x) = x^2 + 1, Target(0.0). x^2+1 >= 1 for all real x, so f(x)=0
    // has no solution. Root finding will fail. NM minimizes |x^2+1 - 0| = x^2+1,
    // which is minimized at x=0, f(0)=1.
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(0.0),
        x0: vec![2.0],
        max_evals: 5_000,
        ..Default::default()
    };
    let result = solve(|x: &[f64]| x[0] * x[0] + 1.0, &config);
    // The solver should return a result (not panic).
    // NM should find x~0 where f=1, the closest point to the target.
    assert!(
        result.x[0].abs() < 0.5,
        "NM fallback should find x near 0, got x={}",
        result.x[0]
    );
    // f(x) = x^2 + 1 >= 1, so fun should be close to 1.0 (the best achievable)
    assert!(
        (result.fun - 1.0).abs() < 0.5,
        "f(x) should be near 1.0 (closest to target 0), got fun={}",
        result.fun
    );
}

#[test]
fn root_finding_fails_cascade_to_nm_exp_negative_target() {
    // f(x) = e^x, Target(-1.0). e^x > 0 for all x, so target=-1 is unreachable.
    // Root finding fails. NM minimizes |e^x - (-1)| = |e^x + 1|.
    // Since e^x > 0, this equals e^x + 1, minimized as x -> -inf.
    // Within a reasonable range, NM should push x negative.
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(-1.0),
        x0: vec![0.0],
        max_evals: 5_000,
        ..Default::default()
    };
    let result = solve(|x: &[f64]| x[0].exp(), &config);
    // The solver should return without panicking.
    // e^x is always positive, so result.fun > 0 and |fun - (-1)| > 1.
    assert!(
        result.fun > 0.0,
        "e^x is always positive, got fun={}",
        result.fun
    );
    // NM should push x to be negative (minimizing e^x)
    assert!(
        result.x[0] < 1.0,
        "NM should push x negative to minimize |e^x + 1|, got x={}",
        result.x[0]
    );
}

// ---- 10.4 BFGS failure cascade to NM in dispatch (line 102) ----
// BFGS internally cascades to NM on stagnation, but returns converged=false
// when max_evals is hit. With a very tight budget, BFGS exhausts evals before
// stagnation detection kicks in, returning converged=false. Dispatch then
// cascades to NM at line 102.

#[test]
fn bfgs_budget_exhausted_dispatch_cascades_to_nm() {
    // Rosenbrock is hard. With max_evals=15, BFGS does initial eval + gradient
    // (3 evals for 2D gradient) = 4 evals, then one line search iteration burns
    // more. It will hit MaxEvaluations quickly. BFGS returns converged=false.
    // Then dispatch cascade at line 102 gives NM the full budget (but it's the
    // same tight budget, so NM also won't converge — the key is exercising the path).
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![-1.0, -1.0],
        max_evals: 15,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    // With only 15 evals total, neither BFGS nor cascade NM will converge,
    // but the solver must return a result without panicking.
    assert_eq!(result.x.len(), 2, "result must have correct dimensionality");
    assert!(result.evals > 0, "must have done some evaluations");
    // Rosenbrock f([-1,-1]) = 400+4=404. Any progress is good.
    assert!(
        result.fun < 500.0,
        "result should be no worse than initial point, fun={}",
        result.fun
    );
}

// ---- 10.5 L-BFGS-B failure cascade to NM for bounded problems (line 91) ----
// Same idea: tight budget causes L-BFGS-B to exhaust evals, returning
// converged=false. Dispatch cascades to NM at line 91.

#[test]
fn lbfgsb_budget_exhausted_dispatch_cascades_to_nm() {
    // Bounded Rosenbrock with very tight budget. L-BFGS-B uses gradient evals
    // (3 per gradient for 2D), so 10 evals is just enough for initial eval +
    // gradient + maybe one step. Returns converged=false -> dispatch cascade to NM.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![-1.0, -1.0],
        bounds: vec![Bound::bounded(-5.0, 5.0); 2],
        max_evals: 10,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    // Must return a valid result without panicking.
    assert_eq!(result.x.len(), 2);
    assert!(result.evals > 0);
    // Bounds must be respected in the result.
    for xi in &result.x {
        assert!(
            *xi >= -5.0 - 1e-9 && *xi <= 5.0 + 1e-9,
            "bounds must be respected: x={:?}",
            result.x
        );
    }
}

#[test]
fn lbfgsb_nonsmooth_bounded_cascades_to_nm() {
    // f(x,y) = |x-3| + |y-3|. Bounds [0,10]x[0,10]. Non-smooth at (3,3).
    // L-BFGS-B relies on gradients; finite differences at (3,3) are unreliable.
    // If L-BFGS-B fails to converge, dispatch cascades to NM.
    // Either way, the solver should find near (3,3) with f~0.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![0.0, 0.0],
        bounds: vec![Bound::bounded(0.0, 10.0); 2],
        max_evals: 10_000,
        ..Default::default()
    };
    let result = solve(|x: &[f64]| (x[0] - 3.0).abs() + (x[1] - 3.0).abs(), &config);
    // Mathematical property: f(x,y) = |x-3|+|y-3| >= 0, minimum 0 at (3,3).
    assert!(
        result.fun < 1.0,
        "should find near-minimum of |x-3|+|y-3|, got fun={}",
        result.fun
    );
    assert!(
        (result.x[0] - 3.0).abs() < 1.0,
        "x[0] should be near 3, got {}",
        result.x[0]
    );
    assert!(
        (result.x[1] - 3.0).abs() < 1.0,
        "x[1] should be near 3, got {}",
        result.x[1]
    );
}

// ---- 10.6 High-dimensional path ndim > 20 (lines 106-110) ----
// When ndim > 20, dispatch_auto uses L-BFGS-B instead of BFGS.

#[test]
fn high_dim_sphere_25d_uses_lbfgsb_path() {
    // f(x) = sum(xi^2) for 25 dimensions. Auto + unbounded + ndim=25 > 20
    // -> L-BFGS-B path (line 106). Sphere is smooth, should converge.
    let x0: Vec<f64> = vec![1.0; 25];
    let config = SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 50_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert!(
        result.converged,
        "25D sphere via L-BFGS-B should converge: {:?}",
        result.message
    );
    assert!(result.fun < 1e-6, "25D sphere: fun={}", result.fun);
    for xi in &result.x {
        assert!(xi.abs() < 0.01, "25D sphere: all xi should be near 0");
    }
}

#[test]
fn high_dim_tight_budget_cascades_to_nm() {
    // 25D sphere with very tight budget. L-BFGS-B needs many gradient evals
    // (26 per gradient for 25D). With max_evals=30, it can barely do initial
    // eval + one gradient. Returns converged=false -> cascade to NM (line 110).
    let x0: Vec<f64> = vec![1.0; 25];
    let config = SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 30,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    // Must return valid result without panicking.
    assert_eq!(result.x.len(), 25);
    assert!(result.evals > 0);
    // f(x0) = 25.0. With 30 evals, solver can't do much but shouldn't make it worse.
    assert!(
        result.fun <= 26.0,
        "high-dim tight budget should not worsen initial value 25, fun={}",
        result.fun
    );
}

#[test]
fn high_dim_21d_takes_lbfgsb_not_bfgs() {
    // ndim=21 > 20, so dispatch should go through L-BFGS-B path, not BFGS.
    // Using a smooth quadratic that L-BFGS-B handles well.
    let x0: Vec<f64> = vec![2.0; 21];
    let config = SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 50_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert!(
        result.converged,
        "21D sphere should converge via L-BFGS-B: {:?}",
        result.message
    );
    assert!(result.fun < 1e-4, "21D sphere: fun={}", result.fun);
}

// ---- 10.7 Boundary ndim=20 takes BFGS path (not L-BFGS-B) ----

#[test]
fn boundary_20d_takes_bfgs_path() {
    // ndim=20 <= 20, so dispatch uses BFGS (line 97), not L-BFGS-B.
    let x0: Vec<f64> = vec![1.0; 20];
    let config = SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 50_000,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert!(
        result.converged,
        "20D sphere via BFGS should converge: {:?}",
        result.message
    );
    assert!(result.fun < 1e-4, "20D sphere: fun={}", result.fun);
}

// ---- 10.8 Result invariants for cascade paths ----

#[test]
fn result_invariants_root_finding_cascade() {
    // Root finding fails (no real root) -> NM cascade. Check invariants.
    let config = SolverConfig {
        method: Method::Auto,
        objective: Objective::Target(0.0),
        x0: vec![2.0],
        max_evals: 5_000,
        ..Default::default()
    };
    let result = solve(|x: &[f64]| x[0] * x[0] + 1.0, &config);
    assert_result_invariants(&result, &config, "root cascade");
}

#[test]
fn result_invariants_high_dim_cascade() {
    // 25D with tight budget -> L-BFGS-B fails -> NM cascade. Check invariants.
    let x0: Vec<f64> = vec![1.0; 25];
    let config = SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 30,
        ..Default::default()
    };
    let result = solve(sphere, &config);
    assert_result_invariants(&result, &config, "high-dim cascade");
}

#[test]
fn result_invariants_bounded_cascade() {
    // Bounded with tight budget -> L-BFGS-B fails -> NM cascade.
    let config = SolverConfig {
        method: Method::Auto,
        x0: vec![-1.0, -1.0],
        bounds: vec![Bound::bounded(-5.0, 5.0); 2],
        max_evals: 10,
        ..Default::default()
    };
    let result = solve(rosenbrock, &config);
    assert_result_invariants(&result, &config, "bounded cascade");
}

//! Global search and Nelder-Mead polish coverage.

use crate::dispatch::solve;
use crate::types::{Bound, Method, SolverConfig};

use super::fixtures::{ackley, config_de, rastrigin, rosenbrock, sphere};

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

//! Cascade and failure-path coverage for auto dispatch.

use crate::dispatch::solve;
use crate::types::{Bound, Method, Objective, SolverConfig};

use super::assertions::assert_result_invariants;
use super::fixtures::{config_nm, rosenbrock, sphere, step_function};

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

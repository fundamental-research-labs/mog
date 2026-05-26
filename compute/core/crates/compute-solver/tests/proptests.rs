use compute_solver::solve;
use compute_solver::types::{Bound, Method, Objective, SolverConfig};
use proptest::prelude::*;

/// Strategy for generating a finite f64 in a reasonable range.
fn reasonable_f64() -> impl Strategy<Value = f64> {
    prop::num::f64::NORMAL.prop_map(|x| x.clamp(-1e6, 1e6))
}

/// Strategy for generating a starting point vector (1–3 dimensions).
fn x0_strategy() -> impl Strategy<Value = Vec<f64>> {
    prop::collection::vec(reasonable_f64(), 1..=3)
}

/// Strategy for generating a Method variant.
fn method_strategy() -> impl Strategy<Value = Method> {
    prop_oneof![
        Just(Method::Auto),
        Just(Method::NelderMead),
        Just(Method::BFGS),
        Just(Method::LBFGSB),
        Just(Method::DifferentialEvolution),
    ]
}

/// Strategy for generating an Objective variant.
fn objective_strategy() -> impl Strategy<Value = Objective> {
    prop_oneof![
        Just(Objective::Minimize),
        Just(Objective::Maximize),
        reasonable_f64().prop_map(Objective::Target),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]

    /// Same seed + same config must produce identical results.
    #[test]
    fn solver_deterministic(
        x0 in x0_strategy(),
        seed in 0u64..1000,
        method in method_strategy(),
    ) {
        let make_config = || SolverConfig {
            objective: Objective::Minimize,
            x0: x0.clone(),
            bounds: vec![],
            method,
            max_evals: 500,
            max_time_ms: 5_000,
            seed: Some(seed),
            ..SolverConfig::default()
        };

        // Simple sphere function: sum of squares
        let sphere = |x: &[f64]| -> f64 { x.iter().map(|v| v * v).sum() };

        let r1 = solve(sphere, &make_config());
        let r2 = solve(sphere, &make_config());

        prop_assert_eq!(&r1.x, &r2.x, "x values differ across runs with same seed");
        prop_assert!(
            (r1.fun - r2.fun).abs() < f64::EPSILON,
            "fun values differ: {} vs {}",
            r1.fun,
            r2.fun
        );
        prop_assert_eq!(r1.evals, r2.evals, "eval counts differ across runs with same seed");
    }

    /// The solver must never panic, regardless of starting point, objective, or method.
    #[test]
    fn solver_never_panics(
        x0 in x0_strategy(),
        objective in objective_strategy(),
        method in method_strategy(),
    ) {
        let ndim = x0.len();
        let config = SolverConfig {
            objective,
            x0,
            bounds: vec![Bound::unbounded(); ndim],
            method,
            max_evals: 200,
            max_time_ms: 5_000,
            seed: Some(42),
            ..SolverConfig::default()
        };

        // Rosenbrock-like function (well-known, non-trivial landscape)
        let f = |x: &[f64]| -> f64 {
            let mut sum = 0.0;
            for i in 0..x.len().saturating_sub(1) {
                let a = x[i + 1] - x[i] * x[i];
                let b = 1.0 - x[i];
                sum += 100.0 * a * a + b * b;
            }
            // For 1-D, just use x^2 so there's a sensible value
            if x.len() == 1 {
                sum = x[0] * x[0];
            }
            sum
        };

        // Must not panic — if it returns at all, the test passes.
        let result = solve(f, &config);

        // Basic sanity: result vector has the right dimension
        prop_assert_eq!(
            result.x.len(),
            ndim,
            "result dimension mismatch: expected {} got {}",
            ndim,
            result.x.len()
        );
    }
}

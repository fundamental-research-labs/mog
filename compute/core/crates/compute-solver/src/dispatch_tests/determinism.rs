//! Determinism and FnMut closure coverage.

use crate::dispatch::solve;
use crate::types::Bound;

use super::fixtures::{config_bfgs, config_de, config_lbfgsb, config_nm, sphere};

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

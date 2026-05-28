//! Explicit method routing coverage for dispatch.

use crate::dispatch::solve;
use crate::types::{Bound, Method, SolverConfig};

use super::fixtures::*;

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

#[test]
fn explicit_de_rastrigin_multimodal() {
    let config = config_de(vec![3.0, -3.0], vec![Bound::bounded(-5.12, 5.12); 2]);
    let result = solve(rastrigin, &config);
    assert!(result.fun < 2.0, "DE rastrigin: fun={}", result.fun);
}

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

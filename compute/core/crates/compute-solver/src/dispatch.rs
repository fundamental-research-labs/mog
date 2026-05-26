//! Auto dispatch — smart algorithm selection with cascade on failure.
//!
//! The [`solve`] function is the unified entry point for all optimization.
//! It dispatches to the right algorithm based on [`SolverConfig::method`] and
//! problem characteristics (dimensionality, bounds, objective type, global search hint).
//!
//! ## Dispatch logic
//!
//! **Explicit method**: routes directly to the named algorithm.
//!
//! **Auto method** decision tree:
//! 1. 1D + Target objective → root finding (Brent's method), cascade to general if it fails
//! 2. `global_search` hint → Differential Evolution, then polish with Nelder-Mead
//! 3. Bounded problem → L-BFGS-B (handles bounds natively), cascade to Nelder-Mead
//! 4. Unbounded, ndim ≤ 20 → BFGS, cascade to Nelder-Mead
//! 5. Unbounded, ndim > 20 → L-BFGS-B (memory-efficient), cascade to Nelder-Mead
//!
//! Nelder-Mead is the universal fallback — it works on any problem without gradients.

use std::cell::RefCell;

use crate::bfgs::solve_bfgs;
use crate::diff_evolution::solve_de;
use crate::lbfgsb::solve_lbfgsb;
use crate::nelder_mead::solve_nelder_mead;
use crate::root_finding::solve_root;
use crate::types::{Method, Objective, SolverConfig, SolverResult};

/// Pick the better of two solver results.
///
/// Prefers converged over non-converged. Among equal convergence status,
/// picks the one with lower objective value.
fn better_result(a: SolverResult, b: SolverResult) -> SolverResult {
    if a.converged && !b.converged {
        return a;
    }
    if b.converged && !a.converged {
        return b;
    }
    if a.fun <= b.fun { a } else { b }
}

/// Unified solver entry point — dispatches to the best algorithm based on config.
///
/// This is the primary API for `compute-solver`. It selects the right algorithm
/// (or sequence of algorithms) based on the configuration:
///
/// - **Explicit method**: routes to the specified algorithm.
/// - **Auto**: uses a decision tree to pick the best algorithm, with cascade
///   to Nelder-Mead if the primary solver fails to converge.
pub fn solve<F: FnMut(&[f64]) -> f64>(func: F, config: &SolverConfig) -> SolverResult {
    // Wrap in RefCell so we can borrow mutably for each solver call in a cascade.
    // Since solvers run sequentially (never concurrently), this is safe.
    let func = RefCell::new(func);

    match config.method {
        Method::NelderMead => solve_nelder_mead(|x| (func.borrow_mut())(x), config),
        Method::BFGS => solve_bfgs(|x| (func.borrow_mut())(x), config),
        Method::LBFGSB => solve_lbfgsb(|x| (func.borrow_mut())(x), config),
        Method::DifferentialEvolution => solve_de(|x| (func.borrow_mut())(x), config),
        Method::Auto => dispatch_auto(&func, config),
    }
}

/// Auto-dispatch decision tree.
fn dispatch_auto<F: FnMut(&[f64]) -> f64>(
    func: &RefCell<F>,
    config: &SolverConfig,
) -> SolverResult {
    // 1. 1D Target → try root finding first (Brent's method is ideal for this)
    if matches!(config.objective, Objective::Target(_)) && config.x0.len() == 1 {
        let result = solve_root(|x| (func.borrow_mut())(x), config);
        if result.converged {
            return result;
        }
        // Fall through to general solver — NM handles 1D fine
        return solve_nelder_mead(|x| (func.borrow_mut())(x), config);
    }

    // 2. Global search → DE, then polish with NM
    if config.global_search {
        return dispatch_global(func, config);
    }

    // 3. Bounded → L-BFGS-B (handles bounds natively), cascade to NM
    if config.has_bounds() {
        let result = solve_lbfgsb(|x| (func.borrow_mut())(x), config);
        if result.converged {
            return result;
        }
        return solve_nelder_mead(|x| (func.borrow_mut())(x), config);
    }

    // 4. Unbounded, local search
    if config.ndim() <= 20 {
        // BFGS is efficient for small-to-medium smooth problems
        let result = solve_bfgs(|x| (func.borrow_mut())(x), config);
        if result.converged {
            return result;
        }
        // Cascade to NM (derivative-free fallback)
        return solve_nelder_mead(|x| (func.borrow_mut())(x), config);
    }

    // 5. High-dimensional unbounded → L-BFGS-B (memory-efficient)
    let result = solve_lbfgsb(|x| (func.borrow_mut())(x), config);
    if result.converged {
        return result;
    }
    solve_nelder_mead(|x| (func.borrow_mut())(x), config)
}

/// Global search: run DE first, then polish the best candidate with NM.
fn dispatch_global<F: FnMut(&[f64]) -> f64>(
    func: &RefCell<F>,
    config: &SolverConfig,
) -> SolverResult {
    let de_result = solve_de(|x| (func.borrow_mut())(x), config);

    // Polish with Nelder-Mead starting from DE's best point
    let mut polish_config = config.clone();
    polish_config.x0 = de_result.x.clone();
    polish_config.method = Method::NelderMead;
    // Give NM a reasonable budget for local polishing
    polish_config.max_evals = config.max_evals.min(5_000);

    let nm_result = solve_nelder_mead(|x| (func.borrow_mut())(x), &polish_config);

    better_result(de_result, nm_result)
}

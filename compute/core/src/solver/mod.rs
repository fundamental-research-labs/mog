//! Solver module — numerical optimization for the compute engine.
//!
//! Provides a unified `solve()` API that routes based on problem structure:
//! - Root finding, NM, BFGS, L-BFGS-B, DE → delegated to `compute-solver` crate (Rust, fast)
//! - Simplex, MixedInteger, constrained problems → returns `RequiresPython` (Python sandbox)
//!
//! Goal Seek is a permanent convenience API for 1D root finding.

pub mod types;

#[cfg(test)]
mod tests;

pub use types::*;

// ---------------------------------------------------------------------------
// Type conversion: bridge types <-> crate types
// ---------------------------------------------------------------------------

/// Convert bridge Objective -> crate Objective.
fn to_crate_objective(obj: &Objective) -> compute_solver::Objective {
    match obj {
        Objective::Target(t) => compute_solver::Objective::Target(*t),
        Objective::Minimize => compute_solver::Objective::Minimize,
        Objective::Maximize => compute_solver::Objective::Maximize,
    }
}

/// Convert bridge SolverParams -> crate SolverConfig.
fn to_crate_config(
    params: &SolverParams,
    method: compute_solver::Method,
) -> compute_solver::SolverConfig {
    let x0: Vec<f64> = params.variables.iter().map(|v| v.initial_value).collect();
    let bounds: Vec<compute_solver::Bound> = params
        .variables
        .iter()
        .map(|v| compute_solver::Bound {
            lower: v.lower_bound,
            upper: v.upper_bound,
        })
        .collect();

    // Use root-finding defaults for 1D Target with explicit RootFinding method
    let is_root_finding = params.method == SolverMethod::RootFinding;

    let max_evals = params
        .max_iterations
        .unwrap_or(if is_root_finding { 100 } else { 10_000 });
    let max_time_ms = params.max_time_ms.unwrap_or(30_000);
    let ftol = params
        .precision
        .unwrap_or(if is_root_finding { 1e-6 } else { 1e-8 });

    compute_solver::SolverConfig {
        objective: to_crate_objective(&params.objective),
        x0,
        bounds,
        method,
        max_evals,
        max_time_ms,
        ftol,
        ..Default::default()
    }
}

/// Convert crate SolverResult -> bridge SolverResult.
fn from_crate_result(r: compute_solver::SolverResult) -> SolverResult {
    SolverResult {
        converged: r.converged,
        solution: r.x,
        objective_value: r.fun,
        evaluations: r.evals,
        iterations: r.iters,
        elapsed_ms: r.elapsed_ms,
        termination: match r.termination {
            compute_solver::TerminationReason::Converged => TerminationReason::Converged,
            compute_solver::TerminationReason::MaxEvaluations => TerminationReason::MaxIterations,
            compute_solver::TerminationReason::MaxTime => TerminationReason::MaxTime,
            compute_solver::TerminationReason::Stagnation => TerminationReason::Stagnation,
            compute_solver::TerminationReason::NumericalError => TerminationReason::NumericalError,
        },
        message: r.message,
        dual_values: None,
    }
}

/// Convert crate SolverResult -> GoalSeekResult.
pub(crate) fn from_crate_result_to_goal_seek(r: compute_solver::SolverResult) -> GoalSeekResult {
    if r.converged {
        GoalSeekResult {
            found: true,
            solution_value: r.x.first().copied(),
            achieved_value: Some(r.fun),
            iterations: r.iters,
            error: None,
            error_message: None,
        }
    } else {
        let error = match r.termination {
            compute_solver::TerminationReason::MaxEvaluations => Some(GoalSeekError::MaxIterations),
            compute_solver::TerminationReason::NumericalError => Some(GoalSeekError::NonNumeric),
            compute_solver::TerminationReason::Stagnation => Some(GoalSeekError::Diverged),
            _ => Some(GoalSeekError::Diverged),
        };
        GoalSeekResult {
            found: false,
            solution_value: r.x.first().copied(),
            achieved_value: if r.fun.is_nan() { None } else { Some(r.fun) },
            iterations: r.iters,
            error,
            error_message: Some(r.message),
        }
    }
}

/// Build a RequiresPython result.
fn requires_python(params: &SolverParams) -> SolverResult {
    SolverResult {
        converged: false,
        solution: vec![],
        objective_value: f64::NAN,
        evaluations: 0,
        iterations: 0,
        elapsed_ms: 0,
        termination: TerminationReason::RequiresPython,
        message: format!(
            "Problem requires Python solver (method: {:?}, {} variables, {} constraints)",
            params.method,
            params.variables.len(),
            params.constraints.len()
        ),
        dual_values: None,
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Unified solver entry point.
///
/// Routes to the appropriate algorithm based on `params.method`:
/// - `RootFinding` -> 1D root finding via compute-solver crate
/// - `NelderMead`, `BFGS`, `LBFGSB`, `GlobalEvolution` -> compute-solver crate
/// - `Auto` -> smart dispatch via compute-solver (root for 1D+Target, else NM/BFGS/etc.)
/// - `Simplex`, `MixedInteger` -> `RequiresPython`
/// - Any problem with constraints -> `RequiresPython`
///
/// `evaluate` takes `&[f64]` (one element per variable) and returns the objective value.
pub fn solve<F>(params: &SolverParams, evaluate: F) -> SolverResult
where
    F: FnMut(&[f64]) -> f64,
{
    // Simplex and MixedInteger still require Python
    if matches!(
        params.method,
        SolverMethod::Simplex | SolverMethod::MixedInteger
    ) {
        return requires_python(params);
    }

    // Constrained problems still require Python (compute-solver has no constraint support)
    if !params.constraints.is_empty() {
        return requires_python(params);
    }

    // Explicit RootFinding: must have Target objective
    if params.method == SolverMethod::RootFinding {
        if !matches!(params.objective, Objective::Target(_)) {
            return SolverResult {
                converged: false,
                solution: vec![],
                objective_value: f64::NAN,
                evaluations: 0,
                iterations: 0,
                elapsed_ms: 0,
                termination: TerminationReason::NumericalError,
                message: "RootFinding requires Objective::Target".to_string(),
                dual_values: None,
            };
        }
        let config = to_crate_config(params, compute_solver::Method::Auto);
        let result = compute_solver::solve_root(evaluate, &config);
        return from_crate_result(result);
    }

    // Map bridge method -> crate method
    let method = match params.method {
        SolverMethod::Auto => compute_solver::Method::Auto,
        SolverMethod::NelderMead => compute_solver::Method::NelderMead,
        SolverMethod::BFGS => compute_solver::Method::BFGS,
        SolverMethod::LBFGSB => compute_solver::Method::LBFGSB,
        SolverMethod::GlobalEvolution => compute_solver::Method::DifferentialEvolution,
        // RootFinding, Simplex, MixedInteger already handled above
        _ => unreachable!(),
    };

    let mut config = to_crate_config(params, method);

    // For GlobalEvolution, hint global search
    if params.method == SolverMethod::GlobalEvolution {
        config.global_search = true;
    }

    let result = compute_solver::solve(evaluate, &config);
    from_crate_result(result)
}

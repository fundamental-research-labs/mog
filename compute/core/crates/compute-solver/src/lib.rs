//! `compute-solver` — domain-agnostic numerical optimization.
//!
//! Pure numerical algorithms. No CellId, no spreadsheet knowledge.
//! Takes `FnMut(&[f64]) -> f64` closures + `SolverConfig`, returns `SolverResult`.
//!
//! # Algorithms
//!
//! - **Root finding**: Brent's method + secant fallback (1D scalar functions)
//! - **Nelder-Mead**: Adaptive simplex (Gao & Han 2012) — derivative-free
//! - **BFGS**: Quasi-Newton with dense inverse Hessian approximation
//! - **L-BFGS-B**: Limited-memory BFGS with native bound handling (Byrd et al. 1995)
//! - **Differential Evolution**: Population-based global optimizer
//! - **Auto dispatch**: Smart algorithm selection with cascade on failure
//!
//! # Architecture
//!
//! All algorithms call the objective function through [`EvalHarness`], which provides:
//! - NaN/Inf → `f64::INFINITY` sentinel (algorithms naturally reject)
//! - Objective transformation (Maximize negates, Target takes `|f - target|`)
//! - Eval budget + wall-clock time enforcement
//! - Best-so-far tracking

pub mod bfgs;
pub mod bounds;
pub mod diff_evolution;
pub mod dispatch;
pub mod finite_diff;
pub mod harness;
pub mod lbfgsb;
pub mod line_search;
pub mod nelder_mead;
pub mod root_finding;
mod time_budget;
pub mod types;

#[cfg(test)]
mod bfgs_tests;
#[cfg(test)]
mod bounds_tests;
#[cfg(test)]
mod diff_evolution_tests;
#[cfg(test)]
mod dispatch_tests;
#[cfg(test)]
mod finite_diff_tests;
#[cfg(test)]
mod harness_tests;
#[cfg(test)]
mod lbfgsb_tests;
#[cfg(test)]
mod line_search_tests;
#[cfg(test)]
mod nelder_mead_tests;
#[cfg(test)]
mod root_finding_tests;

// Public API re-exports
pub use bfgs::solve_bfgs;
pub use diff_evolution::solve_de;
pub use dispatch::solve;
pub use harness::EvalHarness;
pub use lbfgsb::solve_lbfgsb;
pub use nelder_mead::solve_nelder_mead;
pub use root_finding::{solve_root, solve_root_nr};
pub use types::{
    Bound, BudgetExhausted, Method, Objective, SolverConfig, SolverResult, TerminationReason,
};

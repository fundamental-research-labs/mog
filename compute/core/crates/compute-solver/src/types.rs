//! Domain-agnostic types for numerical optimization.
//!
//! Zero CellId, zero spreadsheet knowledge. Pure `f64` in, `f64` out.

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------

/// What to optimize.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum Objective {
    /// Minimize f(x).
    Minimize,
    /// Maximize f(x) — internally minimizes -f(x).
    Maximize,
    /// Find x where f(x) = target — internally minimizes |f(x) - target|.
    Target(f64),
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/// Bounds for a single variable.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct Bound {
    /// Lower bound (`None` = -infinity).
    pub lower: Option<f64>,
    /// Upper bound (`None` = +infinity).
    pub upper: Option<f64>,
}

/// Sentinel for missing bounds (avoids allocating).
const UNBOUNDED: Bound = Bound {
    lower: None,
    upper: None,
};

impl Bound {
    /// Unbounded variable.
    pub fn unbounded() -> Self {
        UNBOUNDED
    }

    /// Lower-bounded only.
    pub fn lower(lo: f64) -> Self {
        Bound {
            lower: Some(lo),
            upper: None,
        }
    }

    /// Upper-bounded only.
    pub fn upper(hi: f64) -> Self {
        Bound {
            lower: None,
            upper: Some(hi),
        }
    }

    /// Box-bounded: `lo <= x <= hi`.
    pub fn bounded(lo: f64, hi: f64) -> Self {
        Bound {
            lower: Some(lo),
            upper: Some(hi),
        }
    }

    /// Check if a value satisfies these bounds.
    pub fn contains(&self, x: f64) -> bool {
        if let Some(lo) = self.lower
            && x < lo
        {
            return false;
        }
        if let Some(hi) = self.upper
            && x > hi
        {
            return false;
        }
        true
    }
}

// ---------------------------------------------------------------------------
// Method selection
// ---------------------------------------------------------------------------

/// Algorithm selection for multi-variable optimization.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum Method {
    /// Auto-select based on problem characteristics.
    Auto,
    /// Adaptive Nelder-Mead (Gao & Han 2012) — derivative-free.
    NelderMead,
    /// Full BFGS with dense inverse Hessian approximation.
    BFGS,
    /// L-BFGS-B with limited-memory two-loop recursion and native bound handling.
    LBFGSB,
    /// Differential Evolution — global optimizer.
    DifferentialEvolution,
}

// ---------------------------------------------------------------------------
// Solver configuration
// ---------------------------------------------------------------------------

/// Configuration for multi-variable optimization.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct SolverConfig {
    /// What to optimize.
    pub objective: Objective,
    /// Initial guess for variable values.
    pub x0: Vec<f64>,
    /// Per-variable bounds (parallel to `x0`; empty = all unbounded).
    pub bounds: Vec<Bound>,
    /// Algorithm to use.
    pub method: Method,
    /// Maximum function evaluations (default: 10,000).
    pub max_evals: u32,
    /// Maximum wall-clock time in milliseconds (default: 30,000; 0 = no limit).
    pub max_time_ms: u32,
    /// Convergence tolerance on x (position) — used by NM (default: 1e-8).
    pub xtol: f64,
    /// Convergence tolerance on f (function value) — used by NM, DE (default: 1e-8).
    pub ftol: f64,
    /// Convergence tolerance on gradient norm — used by BFGS, L-BFGS-B (default: 1e-5).
    pub gtol: f64,
    /// Optional RNG seed for deterministic DE.
    pub seed: Option<u64>,
    /// Hint for global search (influences Auto dispatch).
    pub global_search: bool,
    /// Step-size clamp for root-finding secant fallback (default: 0.001).
    pub root_finding_step_limit: f64,
}

impl Default for SolverConfig {
    fn default() -> Self {
        SolverConfig {
            objective: Objective::Minimize,
            x0: vec![],
            bounds: vec![],
            method: Method::Auto,
            max_evals: 10_000,
            max_time_ms: 30_000,
            xtol: 1e-8,
            ftol: 1e-8,
            gtol: 1e-5,
            seed: None,
            global_search: false,
            root_finding_step_limit: 0.001,
        }
    }
}

impl SolverConfig {
    /// Create config with initial guess, all other fields at defaults.
    pub fn new(x0: Vec<f64>) -> Self {
        SolverConfig {
            x0,
            ..Default::default()
        }
    }

    /// Number of variables (dimension).
    pub fn ndim(&self) -> usize {
        self.x0.len()
    }

    /// Get bound for variable `i` (unbounded if not specified).
    pub fn bound(&self, i: usize) -> Bound {
        self.bounds.get(i).copied().unwrap_or(UNBOUNDED)
    }

    /// Get effective bounds extended to `ndim` (padding with unbounded).
    pub fn effective_bounds(&self) -> Vec<Bound> {
        let n = self.ndim();
        let mut bounds = self.bounds.clone();
        bounds.resize(n, Bound::unbounded());
        bounds
    }

    /// Whether any variable has finite bounds.
    pub fn has_bounds(&self) -> bool {
        self.bounds
            .iter()
            .any(|b| b.lower.is_some() || b.upper.is_some())
    }
}

// ---------------------------------------------------------------------------
// Solver result
// ---------------------------------------------------------------------------

/// Result of a solver run.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct SolverResult {
    /// Whether the solver converged to a solution.
    pub converged: bool,
    /// Solution variable values.
    pub x: Vec<f64>,
    /// Objective function value at solution (raw, untransformed).
    pub fun: f64,
    /// Number of function evaluations.
    pub evals: u32,
    /// Number of algorithm iterations.
    pub iters: u32,
    /// Wall-clock time in milliseconds.
    pub elapsed_ms: u32,
    /// Why the solver stopped.
    pub termination: TerminationReason,
    /// Human-readable message.
    pub message: String,
}

/// Why the solver stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum TerminationReason {
    /// Solution found within tolerance.
    Converged,
    /// Maximum evaluations reached.
    MaxEvaluations,
    /// Maximum wall-clock time reached.
    MaxTime,
    /// No progress for several iterations.
    Stagnation,
    /// Numerical error (NaN everywhere, etc.).
    NumericalError,
}

// ---------------------------------------------------------------------------
// Budget exhaustion error
// ---------------------------------------------------------------------------

/// Error returned by [`EvalHarness`] when evaluation budget or time limit is reached.
#[derive(Debug, Clone, Copy)]
pub struct BudgetExhausted;

impl std::fmt::Display for BudgetExhausted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "evaluation budget exhausted")
    }
}

impl std::error::Error for BudgetExhausted {}

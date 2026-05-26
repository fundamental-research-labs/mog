//! Solver types — the universal contract between Rust and Python solvers.
//!
//! These types define the serialization boundary for numerical optimization:
//! - Rust handles 1D root finding locally (fast, <1ms)
//! - Python handles multi-variable optimization via scipy (powerful, ~100ms-30s)
//!
//! `SolverParams` serializes to JSON, Python deserializes, calls scipy, returns `SolverResult`.

use serde::{Deserialize, Serialize};

use cell_types::CellId;

// ---------------------------------------------------------------------------
// Unified solver types
// ---------------------------------------------------------------------------

/// What to optimize.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Objective {
    /// Find x where f(x) = target (root finding).
    Target(f64),
    /// Minimize f(x).
    Minimize,
    /// Maximize f(x) (internally: minimize -f(x)).
    Maximize,
}

/// A decision variable with optional bounds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variable {
    /// Cell containing the decision variable.
    pub cell_id: CellId,
    /// Starting value for the solver.
    pub initial_value: f64,
    /// Lower bound (None = -∞).
    pub lower_bound: Option<f64>,
    /// Upper bound (None = +∞).
    pub upper_bound: Option<f64>,
}

/// A constraint on the solution.
///
/// For `Integer` constraints, the `CellId` must match one of the
/// `SolverParams::variables[i].cell_id` values. This is validated at runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Constraint {
    /// g(x) <= value.
    LessEqual { cell_id: CellId, value: f64 },
    /// g(x) >= value.
    GreaterEqual { cell_id: CellId, value: f64 },
    /// g(x) = value.
    Equal { cell_id: CellId, value: f64 },
    /// Variable must be integer-valued (handled by scipy milp/differential_evolution).
    Integer(CellId),
}

/// Algorithm selection.
///
/// The solver routes based on method:
/// - `RootFinding`: runs in Rust (local, fast)
/// - `NelderMead`, `BFGS`, `Simplex`, `MixedInteger`, `GlobalEvolution`: dispatched to Python (scipy)
/// - `Auto`: picks the best method based on problem structure
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SolverMethod {
    /// Auto-select based on problem characteristics.
    Auto,
    /// 1D root finding (Brent's + secant fallback) — for Goal Seek. [Rust]
    RootFinding,
    /// Derivative-free simplex — robust, handles noisy functions. [Rust]
    NelderMead,
    /// Quasi-Newton (dense) — fast convergence for smooth functions. [Rust]
    BFGS,
    /// Limited-memory quasi-Newton with native bound handling. [Rust]
    LBFGSB,
    /// Linear programming. [Python: scipy linprog]
    Simplex,
    /// Mixed-integer programming. [Python: scipy milp]
    MixedInteger,
    /// Global optimization — Differential Evolution. [Rust]
    GlobalEvolution,
}

/// Full solver parameters — the universal contract between Rust and Python.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolverParams {
    /// The cell containing the objective formula.
    pub objective_cell: CellId,
    /// What to optimize.
    pub objective: Objective,
    /// Decision variables (cells to change).
    pub variables: Vec<Variable>,
    /// Constraints on the solution.
    pub constraints: Vec<Constraint>,
    /// Algorithm to use (Auto recommended).
    pub method: SolverMethod,
    /// Convergence precision (default: 1e-6).
    pub precision: Option<f64>,
    /// Maximum iterations (default: 1000).
    pub max_iterations: Option<u32>,
    /// Maximum time in milliseconds (default: 30000).
    pub max_time_ms: Option<u32>,
}

/// Solver result — returned by both Rust root-finding and Python scipy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolverResult {
    /// Whether a solution was found.
    pub converged: bool,
    /// Solution values for each variable (parallel to params.variables).
    pub solution: Vec<f64>,
    /// Objective function value at solution.
    pub objective_value: f64,
    /// Number of function evaluations performed.
    pub evaluations: u32,
    /// Number of iterations.
    pub iterations: u32,
    /// Time elapsed in milliseconds.
    pub elapsed_ms: u32,
    /// Termination reason.
    pub termination: TerminationReason,
    /// Human-readable message.
    pub message: String,
    /// Dual values / shadow prices (LP only, parallel to constraints).
    pub dual_values: Option<Vec<f64>>,
}

/// Why the solver stopped.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TerminationReason {
    /// Solution found within tolerance.
    Converged,
    /// Maximum iterations reached.
    MaxIterations,
    /// Maximum time reached.
    MaxTime,
    /// No progress for several iterations.
    Stagnation,
    /// Problem is unbounded.
    Unbounded,
    /// No feasible solution exists.
    Infeasible,
    /// Numerical error (NaN, overflow, etc.).
    NumericalError,
    /// Problem requires Python solver (multi-variable, LP, MIP, global).
    /// The calling layer (Tauri/WASM) catches this and dispatches to Python sandbox.
    RequiresPython,
}

// ---------------------------------------------------------------------------
// Goal Seek convenience types (permanent API for 1-variable root finding)
// ---------------------------------------------------------------------------

/// Parameters for Goal Seek — convenience wrapper for the common case.
///
/// Maps to `SolverParams` with `method: RootFinding`, `objective: Target(target)`,
/// and a single variable with no bounds or constraints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalSeekParams {
    /// CellId of the formula cell to evaluate (the "Set cell").
    pub formula_cell: String,
    /// Target value we want the formula to achieve.
    pub target: f64,
    /// CellId of the input cell to vary (the "By changing cell").
    pub input_cell: String,
    /// Initial guess for the input value.
    pub initial_guess: f64,
    /// Maximum iterations (default: 100).
    pub max_iterations: Option<u32>,
    /// Convergence precision (default: 1e-6).
    pub precision: Option<f64>,
    /// Maximum relative change for convergence (default: 0.001).
    pub max_change: Option<f64>,
}

/// Result of Goal Seek.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalSeekResult {
    /// Whether a solution was found.
    pub found: bool,
    /// The input value that produces the target (if found).
    pub solution_value: Option<f64>,
    /// The actual formula value achieved at the solution.
    pub achieved_value: Option<f64>,
    /// Number of iterations performed.
    pub iterations: u32,
    /// Error type if failed.
    pub error: Option<GoalSeekError>,
    /// Human-readable error message.
    pub error_message: Option<String>,
}

/// Goal Seek error types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GoalSeekError {
    NonNumeric,
    MaxIterations,
    Diverged,
}

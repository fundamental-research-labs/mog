//! Evaluation harness — centralized NaN guard, budget tracking, best-so-far.
//!
//! Every algorithm calls the objective function through `EvalHarness`, which provides:
//! - **NaN/Inf sentinel**: non-finite results become `f64::INFINITY` (algorithms naturally reject)
//! - **Objective transform**: Maximize negates, Target takes `|f - target|`
//! - **Budget tracking**: eval count + wall-clock time limit
//! - **Best-so-far**: tracks the best `(x, f_raw, f_transformed)` seen

use crate::time_budget::BudgetInstant;
use crate::types::{BudgetExhausted, Objective};

/// Wraps a user closure with NaN→infinity sentinel, budget tracking, and best-so-far.
pub struct EvalHarness<F> {
    func: F,
    objective: Objective,
    evals: u32,
    max_evals: u32,
    start: BudgetInstant,
    max_time_ms: u32,
    best_x: Vec<f64>,
    best_f: f64,
    best_raw_f: f64,
}

impl<F: FnMut(&[f64]) -> f64> EvalHarness<F> {
    /// Create a new harness wrapping the given closure.
    ///
    /// - `func`: the raw objective function (no transformation applied yet)
    /// - `objective`: Minimize, Maximize, or Target — controls transformation
    /// - `max_evals`: evaluation budget (0 = unlimited)
    /// - `max_time_ms`: elapsed-time budget in ms (0 = no limit)
    /// - `ndim`: number of variables (for initial best_x allocation)
    pub fn new(
        func: F,
        objective: Objective,
        max_evals: u32,
        max_time_ms: u32,
        ndim: usize,
    ) -> Self {
        EvalHarness {
            func,
            objective,
            evals: 0,
            max_evals,
            start: BudgetInstant::now(),
            max_time_ms,
            best_x: vec![0.0; ndim],
            best_f: f64::INFINITY,
            best_raw_f: f64::NAN,
        }
    }

    /// Evaluate the objective function at `x`.
    ///
    /// Returns the **transformed** value (Minimize: identity, Maximize: negated,
    /// Target: `|f - target|`). Non-finite results become `f64::INFINITY` so
    /// algorithms naturally reject them without per-call `match` arms.
    ///
    /// Returns `Err(BudgetExhausted)` if the eval count or time limit is reached.
    /// This is the only unrecoverable error — algorithms should return their
    /// best-so-far when they receive it.
    pub fn eval(&mut self, x: &[f64]) -> Result<f64, BudgetExhausted> {
        // Check eval budget
        if self.max_evals > 0 && self.evals >= self.max_evals {
            return Err(BudgetExhausted);
        }

        // Check elapsed-time budget through the solver-local clock.
        if self.max_time_ms > 0 && self.start.elapsed().as_millis() as u32 >= self.max_time_ms {
            return Err(BudgetExhausted);
        }

        self.evals += 1;

        // Call the raw function
        let raw = (self.func)(x);

        // Transform based on objective
        let transformed = match self.objective {
            Objective::Minimize => raw,
            Objective::Maximize => -raw,
            Objective::Target(t) => (raw - t).abs(),
        };

        // NaN/Inf sentinel: non-finite → INFINITY (algorithms naturally reject)
        let val = if transformed.is_finite() {
            transformed
        } else {
            f64::INFINITY
        };

        // Track best-so-far (only finite values update)
        if val < self.best_f {
            self.best_f = val;
            self.best_raw_f = raw;
            self.best_x.clear();
            self.best_x.extend_from_slice(x);
        }

        Ok(val)
    }

    /// Number of function evaluations so far.
    pub fn evals(&self) -> u32 {
        self.evals
    }

    /// Best x found so far.
    pub fn best_x(&self) -> &[f64] {
        &self.best_x
    }

    /// Best transformed function value found so far (for algorithm comparison).
    pub fn best_f(&self) -> f64 {
        self.best_f
    }

    /// Best raw (untransformed) function value found so far (for result reporting).
    pub fn best_raw_f(&self) -> f64 {
        self.best_raw_f
    }

    /// Elapsed wall-clock time in milliseconds.
    pub fn elapsed_ms(&self) -> u32 {
        self.start.elapsed().as_millis() as u32
    }

    /// Remaining evaluation budget (0 if unlimited or exhausted).
    pub fn remaining_evals(&self) -> u32 {
        if self.max_evals == 0 {
            u32::MAX
        } else {
            self.max_evals.saturating_sub(self.evals)
        }
    }
}

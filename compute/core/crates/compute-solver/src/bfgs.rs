//! Full BFGS with dense inverse Hessian approximation.
//!
//! Quasi-Newton method that maintains a dense approximation to the inverse
//! Hessian matrix, updated via the Sherman-Morrison-Woodbury formula.
//! Uses finite-difference gradients and Wolfe line search.
//!
//! On gradient failure (e.g., discontinuous functions), cascades to Nelder-Mead.

use crate::bounds::project_vec;
use crate::finite_diff::gradient_with_evals;
use crate::line_search::{LineSearchResult, wolfe_line_search};
use crate::nelder_mead::solve_nelder_mead;
use crate::time_budget::BudgetInstant;
use crate::types::{Objective, SolverConfig, SolverResult, TerminationReason};

use std::cell::Cell;

/// Maximum consecutive stagnation iterations before cascading to Nelder-Mead.
const MAX_STAGNATION: u32 = 5;

/// Machine epsilon for float comparisons.
const EPS: f64 = f64::EPSILON;

// ---------------------------------------------------------------------------
// Internal tracking (replaces EvalHarness to avoid ownership issues)
// ---------------------------------------------------------------------------

struct BfgsState {
    objective: Objective,
    evals: u32,
    max_evals: u32,
    start: BudgetInstant,
    max_time_ms: u32,
    best_x: Vec<f64>,
    best_raw_f: f64,
    best_transformed_f: f64,
}

impl BfgsState {
    fn new(objective: Objective, max_evals: u32, max_time_ms: u32, ndim: usize) -> Self {
        BfgsState {
            objective,
            evals: 0,
            max_evals,
            start: BudgetInstant::now(),
            max_time_ms,
            best_x: vec![0.0; ndim],
            best_raw_f: f64::NAN,
            best_transformed_f: f64::INFINITY,
        }
    }

    #[inline]
    fn transform(&self, raw: f64) -> f64 {
        let t = match self.objective {
            Objective::Minimize => raw,
            Objective::Maximize => -raw,
            Objective::Target(target) => (raw - target).abs(),
        };
        if t.is_finite() { t } else { f64::INFINITY }
    }

    fn update_best(&mut self, x: &[f64], raw_f: f64) {
        let val = self.transform(raw_f);
        if val < self.best_transformed_f {
            self.best_transformed_f = val;
            self.best_raw_f = raw_f;
            self.best_x.clear();
            self.best_x.extend_from_slice(x);
        }
    }

    fn budget_exhausted(&self) -> bool {
        if self.max_evals > 0 && self.evals >= self.max_evals {
            return true;
        }
        if self.max_time_ms > 0 && self.start.elapsed().as_millis() as u32 >= self.max_time_ms {
            return true;
        }
        false
    }

    fn remaining_evals(&self) -> u32 {
        if self.max_evals == 0 {
            u32::MAX
        } else {
            self.max_evals.saturating_sub(self.evals)
        }
    }

    fn elapsed_ms(&self) -> u32 {
        self.start.elapsed().as_millis() as u32
    }
}

// ---------------------------------------------------------------------------
// Dense matrix helpers
// ---------------------------------------------------------------------------

fn identity(n: usize) -> Vec<Vec<f64>> {
    let mut m = vec![vec![0.0; n]; n];
    for (i, row) in m.iter_mut().enumerate().take(n) {
        row[i] = 1.0;
    }
    m
}

fn mat_vec(m: &[Vec<f64>], v: &[f64]) -> Vec<f64> {
    m.iter()
        .map(|row| row.iter().zip(v.iter()).map(|(a, b)| a * b).sum())
        .collect()
}

#[inline]
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(ai, bi)| ai * bi).sum()
}

#[inline]
fn norm(v: &[f64]) -> f64 {
    dot(v, v).sqrt()
}

fn bfgs_update(h_inv: &mut [Vec<f64>], s: &[f64], y: &[f64]) {
    let n = s.len();
    let ys = dot(y, s);
    if ys <= EPS {
        return;
    }
    let rho = 1.0 / ys;
    let hy = mat_vec(h_inv, y);
    let yhy = dot(y, &hy);
    let coeff = rho * (rho * yhy + 1.0);
    for i in 0..n {
        for j in 0..n {
            h_inv[i][j] = h_inv[i][j] - rho * (s[i] * hy[j] + hy[i] * s[j]) + coeff * s[i] * s[j];
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Minimize `func` using the BFGS quasi-Newton method with finite-difference gradients.
pub fn solve_bfgs<F: FnMut(&[f64]) -> f64>(mut func: F, config: &SolverConfig) -> SolverResult {
    let n = config.ndim();
    assert!(n >= 1, "bfgs: need at least 1 variable");

    let bounds = config.effective_bounds();
    let has_bounds = config.has_bounds();
    let mut state = BfgsState::new(config.objective, config.max_evals, config.max_time_ms, n);
    let objective = config.objective;

    // Cells for interior mutability: shared between tf closure and main loop.
    let last_raw = Cell::new(f64::NAN);
    let ext_evals = Cell::new(0u32);

    let mut tf = |x: &[f64]| -> f64 {
        ext_evals.set(ext_evals.get() + 1);
        let raw = func(x);
        last_raw.set(raw);
        let t = match objective {
            Objective::Minimize => raw,
            Objective::Maximize => -raw,
            Objective::Target(target) => (raw - target).abs(),
        };
        if t.is_finite() { t } else { f64::INFINITY }
    };

    // --- Initialize x ---
    let mut x = config.x0.clone();
    if has_bounds {
        project_vec(&mut x, &bounds);
    }

    // Evaluate at initial point
    let f0 = tf(&x);
    let raw0 = last_raw.get();
    drain_ext(&mut state, &ext_evals);
    state.update_best(&x, raw0);

    if !f0.is_finite() {
        return cascade_to_nm(func, config, &state, 0);
    }

    let mut f_val = f0;

    // --- Compute initial gradient ---
    let (mut grad, _) = gradient_with_evals(&mut tf, &x, f_val);
    drain_ext(&mut state, &ext_evals);

    let grad_norm = norm(&grad);
    if !grad_norm.is_finite() || grad.iter().all(|g| *g == 0.0) {
        return cascade_to_nm(func, config, &state, 0);
    }

    if grad_norm < config.gtol {
        return make_result(
            &state,
            0,
            TerminationReason::Converged,
            format!(
                "BFGS converged at initial point (grad_norm={:.2e}, {} evals)",
                grad_norm, state.evals
            ),
        );
    }

    // --- Initialize inverse Hessian ---
    let mut h_inv = identity(n);
    let mut iters: u32 = 0;
    let mut stagnation_count: u32 = 0;

    let termination = loop {
        iters += 1;

        if state.budget_exhausted() {
            break TerminationReason::MaxEvaluations;
        }

        // Search direction: d = -H_inv * grad
        let mut direction = mat_vec(&h_inv, &grad);
        for d in direction.iter_mut() {
            *d = -*d;
        }

        // Verify descent direction
        if dot(&direction, &grad) >= 0.0 {
            direction = grad.iter().map(|g| -g).collect();
            h_inv = identity(n);
        }

        // Wolfe line search
        let LineSearchResult { alpha, f_alpha } =
            wolfe_line_search(&mut tf, &x, f_val, &grad, &direction);
        drain_ext(&mut state, &ext_evals);

        // Stagnation detection
        let stagnant = alpha == 0.0 || (f_val - f_alpha).abs() < EPS;
        if stagnant {
            stagnation_count += 1;
            if stagnation_count >= MAX_STAGNATION {
                break TerminationReason::Stagnation;
            }
            if alpha == 0.0 {
                h_inv = identity(n);
                continue;
            }
        } else {
            stagnation_count = 0;
        }

        // Update position
        let mut x_new: Vec<f64> = x
            .iter()
            .zip(direction.iter())
            .map(|(xi, di)| xi + alpha * di)
            .collect();
        if has_bounds {
            project_vec(&mut x_new, &bounds);
        }

        // Evaluate at new point
        let f_new = tf(&x_new);
        let raw_new = last_raw.get();
        drain_ext(&mut state, &ext_evals);
        state.update_best(&x_new, raw_new);

        if state.budget_exhausted() {
            break TerminationReason::MaxEvaluations;
        }

        // Compute new gradient
        let (grad_new, _) = gradient_with_evals(&mut tf, &x_new, f_new);
        drain_ext(&mut state, &ext_evals);

        let grad_new_norm = norm(&grad_new);
        if !grad_new_norm.is_finite() || grad_new.iter().all(|g| *g == 0.0) {
            break TerminationReason::Stagnation;
        }

        if grad_new_norm < config.gtol {
            break TerminationReason::Converged;
        }

        // BFGS update: s = x_new - x, y = grad_new - grad
        let s: Vec<f64> = x_new.iter().zip(x.iter()).map(|(a, b)| a - b).collect();
        let y: Vec<f64> = grad_new
            .iter()
            .zip(grad.iter())
            .map(|(a, b)| a - b)
            .collect();
        bfgs_update(&mut h_inv, &s, &y);

        x = x_new;
        f_val = f_new;
        grad = grad_new;
    };

    if termination == TerminationReason::Stagnation {
        return cascade_to_nm(func, config, &state, iters);
    }

    let message = match termination {
        TerminationReason::Converged => format!(
            "BFGS converged after {} iterations ({} evals)",
            iters, state.evals
        ),
        TerminationReason::MaxEvaluations => format!(
            "BFGS max evaluations ({}) reached after {} iterations",
            state.evals, iters
        ),
        TerminationReason::MaxTime => format!(
            "BFGS time limit reached after {} iterations ({} evals, {}ms)",
            iters,
            state.evals,
            state.elapsed_ms()
        ),
        _ => format!(
            "BFGS stopped: {:?} after {} iterations ({} evals)",
            termination, iters, state.evals
        ),
    };

    make_result(&state, iters, termination, message)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Drain the external eval counter (Cell) into BfgsState.
#[inline]
fn drain_ext(state: &mut BfgsState, ext: &Cell<u32>) {
    let count = ext.get();
    state.evals += count;
    ext.set(0);
}

fn cascade_to_nm<F: FnMut(&[f64]) -> f64>(
    func: F,
    config: &SolverConfig,
    state: &BfgsState,
    bfgs_iters: u32,
) -> SolverResult {
    let remaining = state.remaining_evals();
    if remaining < 3 {
        return make_result(
            state,
            bfgs_iters,
            TerminationReason::MaxEvaluations,
            format!(
                "BFGS cascaded to NM but budget exhausted ({} evals)",
                state.evals
            ),
        );
    }

    let nm_config = SolverConfig {
        objective: config.objective,
        x0: state.best_x.clone(),
        bounds: config.bounds.clone(),
        method: crate::types::Method::NelderMead,
        max_evals: remaining,
        max_time_ms: if config.max_time_ms > 0 {
            config.max_time_ms.saturating_sub(state.elapsed_ms())
        } else {
            0
        },
        xtol: config.xtol,
        ftol: config.ftol,
        gtol: config.gtol,
        seed: config.seed,
        global_search: false,
        root_finding_step_limit: config.root_finding_step_limit,
    };

    let nm_result = solve_nelder_mead(func, &nm_config);

    let bfgs_val = state.best_transformed_f;
    let nm_val = match config.objective {
        Objective::Minimize => nm_result.fun,
        Objective::Maximize => -nm_result.fun,
        Objective::Target(t) => (nm_result.fun - t).abs(),
    };

    let (best_x, best_raw_f) = if nm_val < bfgs_val {
        (nm_result.x.clone(), nm_result.fun)
    } else {
        (state.best_x.clone(), state.best_raw_f)
    };

    let total_evals = state.evals + nm_result.evals;
    let total_iters = bfgs_iters + nm_result.iters;
    let converged = nm_result.converged;

    SolverResult {
        converged,
        x: best_x,
        fun: best_raw_f,
        evals: total_evals,
        iters: total_iters,
        elapsed_ms: state.elapsed_ms(),
        termination: if converged {
            TerminationReason::Converged
        } else {
            nm_result.termination
        },
        message: format!(
            "BFGS cascaded to NM after {} iters; NM {} after {} iters (total {} evals)",
            bfgs_iters,
            if converged {
                "converged"
            } else {
                "did not converge"
            },
            nm_result.iters,
            total_evals
        ),
    }
}

fn make_result(
    state: &BfgsState,
    iters: u32,
    termination: TerminationReason,
    message: String,
) -> SolverResult {
    SolverResult {
        converged: termination == TerminationReason::Converged,
        x: state.best_x.clone(),
        fun: state.best_raw_f,
        evals: state.evals,
        iters,
        elapsed_ms: state.elapsed_ms(),
        termination,
        message,
    }
}

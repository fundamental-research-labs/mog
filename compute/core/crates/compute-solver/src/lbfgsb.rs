//! L-BFGS-B: limited-memory BFGS with native bound handling.
//! Implements simplified L-BFGS-B (Byrd et al. 1995) with two-loop recursion,
//! projected gradient convergence, Wolfe line search with bound projection.
//! Falls back to Nelder-Mead on sustained stagnation or numerical failure.

use crate::bounds::project_vec;
use crate::finite_diff::gradient_with_evals;
use crate::line_search::wolfe_line_search;
use crate::nelder_mead::solve_nelder_mead;
use crate::time_budget::BudgetInstant;
use crate::types::{Objective, SolverConfig, SolverResult, TerminationReason};
use std::cell::Cell;
use std::collections::VecDeque;

const HISTORY_SIZE: usize = 10;
const MAX_STAGNATION: u32 = 10;
const CURVATURE_EPS: f64 = 1e-20;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct LbfgsbState {
    objective: Objective,
    evals: u32,
    max_evals: u32,
    start: BudgetInstant,
    max_time_ms: u32,
    best_x: Vec<f64>,
    best_raw_f: f64,
    best_tf: f64,
}

impl LbfgsbState {
    fn new(objective: Objective, max_evals: u32, max_time_ms: u32, ndim: usize) -> Self {
        LbfgsbState {
            objective,
            evals: 0,
            max_evals,
            start: BudgetInstant::now(),
            max_time_ms,
            best_x: vec![0.0; ndim],
            best_raw_f: f64::NAN,
            best_tf: f64::INFINITY,
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
        if val < self.best_tf {
            self.best_tf = val;
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
// L-BFGS history
// ---------------------------------------------------------------------------

struct CurvaturePair {
    s: Vec<f64>,
    y: Vec<f64>,
    rho: f64,
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

#[inline]
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(ai, bi)| ai * bi).sum()
}
#[inline]
fn vec_sub(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b.iter()).map(|(ai, bi)| ai - bi).collect()
}
#[inline]
fn vec_norm(v: &[f64]) -> f64 {
    dot(v, v).sqrt()
}

/// Drain the external eval counter (Cell) into LbfgsbState.
#[inline]
fn drain_ext(state: &mut LbfgsbState, ext: &Cell<u32>) {
    let count = ext.get();
    state.evals += count;
    ext.set(0);
}

/// Projected gradient: zero out components at active bounds.
fn projected_gradient(x: &[f64], grad: &[f64], bounds: &[crate::types::Bound]) -> Vec<f64> {
    let n = x.len();
    let mut pg = vec![0.0; n];
    for i in 0..n {
        let g = grad[i];
        let xi = x[i];
        let at_lo = bounds
            .get(i)
            .and_then(|b| b.lower)
            .is_some_and(|lo| (xi - lo).abs() < 1e-12);
        let at_hi = bounds
            .get(i)
            .and_then(|b| b.upper)
            .is_some_and(|hi| (xi - hi).abs() < 1e-12);
        if (at_lo && g > 0.0) || (at_hi && g < 0.0) {
            pg[i] = 0.0;
        } else {
            pg[i] = g;
        }
    }
    pg
}

/// Two-loop recursion: compute H_k * grad using limited-memory curvature pairs.
/// Returns the NEGATED direction (descent direction).
fn two_loop_recursion(grad: &[f64], history: &VecDeque<CurvaturePair>) -> Vec<f64> {
    let m = history.len();
    let mut q = grad.to_vec();
    let mut alphas = vec![0.0; m];
    for i in (0..m).rev() {
        let pair = &history[i];
        let alpha_i = pair.rho * dot(&pair.s, &q);
        alphas[i] = alpha_i;
        for (qj, yj) in q.iter_mut().zip(pair.y.iter()) {
            *qj -= alpha_i * yj;
        }
    }
    // Initial Hessian scaling: H0 = gamma * I
    let gamma = if let Some(newest) = history.back() {
        let sy = dot(&newest.s, &newest.y);
        let yy = dot(&newest.y, &newest.y);
        if yy > 0.0 { sy / yy } else { 1.0 }
    } else {
        1.0
    };
    let mut r: Vec<f64> = q.iter().map(|qi| gamma * qi).collect();
    for i in 0..m {
        let pair = &history[i];
        let beta = pair.rho * dot(&pair.y, &r);
        let diff = alphas[i] - beta;
        for (rj, sj) in r.iter_mut().zip(pair.s.iter()) {
            *rj += diff * sj;
        }
    }
    // Negate for descent
    for rj in r.iter_mut() {
        *rj = -*rj;
    }
    r
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Minimize `func` using L-BFGS-B with limited-memory two-loop recursion and
/// native bound handling. Cascades to Nelder-Mead on stagnation or gradient failure.
pub fn solve_lbfgsb<F: FnMut(&[f64]) -> f64>(mut func: F, config: &SolverConfig) -> SolverResult {
    let n = config.ndim();
    assert!(n >= 1, "lbfgsb: need at least 1 variable");

    let bounds = config.effective_bounds();
    let has_bounds = config.has_bounds();
    let objective = config.objective;
    let mut state = LbfgsbState::new(objective, config.max_evals, config.max_time_ms, n);

    // Cell for interior mutability — shared between closure and main loop
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

    let f0 = tf(&x);
    let raw0 = last_raw.get();
    drain_ext(&mut state, &ext_evals);
    state.update_best(&x, raw0);

    if !f0.is_finite() {
        return cascade_to_nm(func, config, &state, 0);
    }
    let mut f_val = f0;

    // --- Initial gradient ---
    let (mut grad, _) = gradient_with_evals(&mut tf, &x, f_val);
    drain_ext(&mut state, &ext_evals);

    let pg = if has_bounds {
        projected_gradient(&x, &grad, &bounds)
    } else {
        grad.clone()
    };
    let pg_norm = vec_norm(&pg);

    if !pg_norm.is_finite() || grad.iter().all(|g| *g == 0.0) {
        return cascade_to_nm(func, config, &state, 0);
    }
    if pg_norm < config.gtol {
        return mk_result(
            &state,
            0,
            TerminationReason::Converged,
            format!(
                "L-BFGS-B converged at initial point (pg_norm={:.2e})",
                pg_norm
            ),
        );
    }

    // --- Main loop ---
    let mut history: VecDeque<CurvaturePair> = VecDeque::new();
    let mut iters: u32 = 0;
    let mut stagnation: u32 = 0;

    let termination = loop {
        iters += 1;
        if state.budget_exhausted() {
            break TerminationReason::MaxEvaluations;
        }

        // Search direction via two-loop recursion
        let mut direction = if history.is_empty() {
            grad.iter().map(|g| -g).collect::<Vec<f64>>()
        } else {
            two_loop_recursion(&grad, &history)
        };

        // Ensure descent
        if dot(&direction, &grad) >= 0.0 {
            direction = grad.iter().map(|g| -g).collect();
            history.clear();
        }

        // Wolfe line search
        let ls = wolfe_line_search(&mut tf, &x, f_val, &grad, &direction);
        drain_ext(&mut state, &ext_evals);

        // Stagnation
        let stagnant = ls.alpha == 0.0 || (f_val - ls.f_alpha).abs() < f64::EPSILON;
        if stagnant {
            stagnation += 1;
            if stagnation >= MAX_STAGNATION {
                break TerminationReason::Stagnation;
            }
            if ls.alpha == 0.0 {
                history.clear();
                continue;
            }
        } else {
            stagnation = 0;
        }

        // Update position with bound projection
        let mut x_new: Vec<f64> = x
            .iter()
            .zip(direction.iter())
            .map(|(xi, di)| xi + ls.alpha * di)
            .collect();
        if has_bounds {
            project_vec(&mut x_new, &bounds);
        }

        // Evaluate at new point for best tracking
        let f_new = tf(&x_new);
        let raw_new = last_raw.get();
        drain_ext(&mut state, &ext_evals);
        state.update_best(&x_new, raw_new);

        if state.budget_exhausted() {
            break TerminationReason::MaxEvaluations;
        }

        // New gradient
        let (grad_new, _) = gradient_with_evals(&mut tf, &x_new, f_new);
        drain_ext(&mut state, &ext_evals);

        let pg_new = if has_bounds {
            projected_gradient(&x_new, &grad_new, &bounds)
        } else {
            grad_new.clone()
        };
        let pg_new_norm = vec_norm(&pg_new);

        if !pg_new_norm.is_finite() || grad_new.iter().all(|g| *g == 0.0) {
            break TerminationReason::Stagnation;
        }
        if pg_new_norm < config.gtol {
            break TerminationReason::Converged;
        }

        // Store curvature pair
        let s = vec_sub(&x_new, &x);
        let y = vec_sub(&grad_new, &grad);
        let sy = dot(&s, &y);
        if sy > CURVATURE_EPS {
            if history.len() >= HISTORY_SIZE {
                history.pop_front();
            }
            history.push_back(CurvaturePair {
                s,
                y,
                rho: 1.0 / sy,
            });
        }

        x = x_new;
        f_val = f_new;
        grad = grad_new;
    };

    if termination == TerminationReason::Stagnation {
        return cascade_to_nm(func, config, &state, iters);
    }

    let msg = match termination {
        TerminationReason::Converged => format!(
            "L-BFGS-B converged after {} iterations ({} evals)",
            iters, state.evals
        ),
        TerminationReason::MaxEvaluations => format!(
            "L-BFGS-B max evaluations ({}) after {} iterations",
            state.evals, iters
        ),
        _ => format!(
            "L-BFGS-B stopped: {:?} after {} iterations ({} evals)",
            termination, iters, state.evals
        ),
    };
    mk_result(&state, iters, termination, msg)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn mk_result(
    state: &LbfgsbState,
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

fn cascade_to_nm<F: FnMut(&[f64]) -> f64>(
    func: F,
    config: &SolverConfig,
    state: &LbfgsbState,
    lb_iters: u32,
) -> SolverResult {
    let remaining = state.remaining_evals();
    if remaining < 3 {
        return mk_result(
            state,
            lb_iters,
            TerminationReason::MaxEvaluations,
            format!(
                "L-BFGS-B cascaded to NM but budget exhausted ({} evals)",
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

    let nm = solve_nelder_mead(func, &nm_config);

    let nm_tf = state.transform(nm.fun);
    let bfgs_tf = state.best_tf;

    let (best_x, best_raw_f) = if nm_tf < bfgs_tf {
        (nm.x.clone(), nm.fun)
    } else {
        (state.best_x.clone(), state.best_raw_f)
    };

    let total_evals = state.evals + nm.evals;
    SolverResult {
        converged: nm.converged,
        x: best_x,
        fun: best_raw_f,
        evals: total_evals,
        iters: lb_iters + nm.iters,
        elapsed_ms: state.elapsed_ms(),
        termination: if nm.converged {
            TerminationReason::Converged
        } else {
            nm.termination
        },
        message: format!(
            "L-BFGS-B cascaded to NM after {} iters; NM {} ({} total evals)",
            lb_iters,
            if nm.converged {
                "converged"
            } else {
                "did not converge"
            },
            total_evals
        ),
    }
}

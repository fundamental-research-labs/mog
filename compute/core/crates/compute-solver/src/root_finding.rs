//! Root finding algorithms.
//!
//! Two public APIs:
//!
//! - [`solve_root`]: Multi-dimensional API (`FnMut(&[f64]) -> f64`). Brent + secant.
//! - [`solve_root_nr`]: 1D scalar API (`FnMut(f64) -> f64`). Newton-Raphson with
//!   analytic derivative + Brent fallback. Designed for financial solvers (XIRR,
//!   IRR, RATE, YIELD) where callers provide both f and f'.

use crate::time_budget::BudgetInstant;
use crate::types::{Objective, SolverConfig, SolverResult, TerminationReason};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS: u32 = 100;
const DEFAULT_PRECISION: f64 = 1e-6;
const DEFAULT_MAX_CHANGE: f64 = 0.001;
/// Machine epsilon for f64.
const EPSILON: f64 = 2.220446049250313e-16;

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

fn now() -> BudgetInstant {
    BudgetInstant::now()
}

fn elapsed_since(start: BudgetInstant) -> u32 {
    start.elapsed().as_millis() as u32
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/// Solve a 1D root-finding problem: find `x` such that `f(x) ≈ target`.
///
/// `func` is called with `&[x]` (a single-element slice) and returns `f(x)`.
/// `config.objective` must be `Objective::Target(target)`.
///
/// Uses `config.x0[0]` as initial guess, `config.ftol` as precision,
/// `config.max_evals` as iteration limit.
pub fn solve_root<F: FnMut(&[f64]) -> f64>(mut func: F, config: &SolverConfig) -> SolverResult {
    let start = now();

    let target = match config.objective {
        Objective::Target(t) => t,
        _ => {
            return SolverResult {
                converged: false,
                x: vec![],
                fun: f64::NAN,
                evals: 0,
                iters: 0,
                elapsed_ms: 0,
                termination: TerminationReason::NumericalError,
                message: "solve_root requires Objective::Target".to_string(),
            };
        }
    };

    let initial_guess = config.x0.first().copied().unwrap_or(0.0);
    let max_iterations = if config.max_evals == 0 {
        DEFAULT_MAX_ITERATIONS
    } else {
        config.max_evals
    };
    let precision = if config.ftol <= 0.0 {
        DEFAULT_PRECISION
    } else {
        config.ftol
    };

    // Wrap func so we track evals and call with &[x]
    let mut evals: u32 = 0;
    let mut evaluate = |x: f64| -> f64 {
        evals += 1;
        func(&[x])
    };

    let max_change = if config.root_finding_step_limit > 0.0 {
        config.root_finding_step_limit
    } else {
        DEFAULT_MAX_CHANGE
    };

    let result = goal_seek(
        &mut evaluate,
        target,
        initial_guess,
        max_iterations,
        precision,
        max_change,
    );

    let elapsed_ms = elapsed_since(start);

    match result {
        GoalSeekOutcome::Found {
            solution,
            achieved,
            iterations,
        } => SolverResult {
            converged: true,
            x: vec![solution],
            fun: achieved,
            evals,
            iters: iterations,
            elapsed_ms,
            termination: TerminationReason::Converged,
            message: format!(
                "Root found after {} iterations ({} evals)",
                iterations, evals
            ),
        },
        GoalSeekOutcome::NotFound {
            best_x,
            best_achieved,
            iterations,
            reason,
        } => SolverResult {
            converged: false,
            x: best_x.map(|v| vec![v]).unwrap_or_default(),
            fun: best_achieved.unwrap_or(f64::NAN),
            evals,
            iters: iterations,
            elapsed_ms,
            termination: reason,
            message: match reason {
                TerminationReason::MaxEvaluations => {
                    format!("Max iterations ({}) reached", iterations)
                }
                TerminationReason::NumericalError => {
                    "Formula returns non-numeric value".to_string()
                }
                TerminationReason::Stagnation => "Stagnated: no improvement".to_string(),
                _ => format!("Root not found after {} iterations", iterations),
            },
        },
    }
}

// ---------------------------------------------------------------------------
// Internal outcome type
// ---------------------------------------------------------------------------

enum GoalSeekOutcome {
    Found {
        solution: f64,
        achieved: f64,
        iterations: u32,
    },
    NotFound {
        best_x: Option<f64>,
        best_achieved: Option<f64>,
        iterations: u32,
        reason: TerminationReason,
    },
}

// ---------------------------------------------------------------------------
// Core goal seek algorithm
// ---------------------------------------------------------------------------

/// Run Goal Seek using Brent's method with secant fallback.
///
/// `evaluate` is a closure that takes an input value and returns the formula result.
/// The algorithm finds `x` such that `evaluate(x) ≈ target`.
fn goal_seek<F>(
    evaluate: &mut F,
    target: f64,
    initial_guess: f64,
    max_iterations: u32,
    precision: f64,
    max_change: f64,
) -> GoalSeekOutcome
where
    F: FnMut(f64) -> f64,
{
    // 1. Check initial guess
    let initial_value = evaluate(initial_guess);

    // Check for non-finite initial value
    if !initial_value.is_finite() {
        return GoalSeekOutcome::NotFound {
            best_x: None,
            best_achieved: None,
            iterations: 0,
            reason: TerminationReason::NumericalError,
        };
    }

    // If initial guess already satisfies the target
    if (initial_value - target).abs() < precision {
        return GoalSeekOutcome::Found {
            solution: initial_guess,
            achieved: initial_value,
            iterations: 0,
        };
    }

    // 2. Try to find a bracket (interval with sign change)
    if let Some((a, b)) = find_bracket(evaluate, target, initial_guess) {
        // 3. Brent's method (guaranteed convergence for continuous functions)
        brents_method(evaluate, target, a, b, max_iterations, precision)
    } else {
        // 4. Secant method fallback (for discontinuous or hard-to-bracket functions)
        secant_method(
            evaluate,
            target,
            initial_guess,
            max_iterations,
            precision,
            max_change,
        )
    }
}

// ---------------------------------------------------------------------------
// Bracket finder — exponential expansion from initial guess
// ---------------------------------------------------------------------------

/// Find an interval `[a, b]` such that `f(a)` and `f(b)` have opposite signs,
/// where `f(x) = evaluate(x) - target`. Uses exponential expansion outward from
/// the initial guess.
fn find_bracket<F>(evaluate: &mut F, target: f64, guess: f64) -> Option<(f64, f64)>
where
    F: FnMut(f64) -> f64,
{
    // Start with a small delta relative to the guess magnitude
    let mut delta = if guess.abs() > EPSILON {
        guess.abs() * 0.1
    } else {
        0.1
    };

    let f_guess = evaluate(guess) - target;

    // If f_guess is non-finite, we can't bracket
    if !f_guess.is_finite() {
        return None;
    }

    for _ in 0..60 {
        // Try guess + delta
        let right = guess + delta;
        let f_right = evaluate(right) - target;
        if f_right.is_finite() && f_guess * f_right <= 0.0 {
            return Some((guess, right));
        }

        // Try guess - delta
        let left = guess - delta;
        let f_left = evaluate(left) - target;
        if f_left.is_finite() && f_guess * f_left <= 0.0 {
            return Some((guess, left));
        }

        // Double the delta for next iteration (exponential expansion)
        delta *= 2.0;

        // Stop if delta gets too large
        if delta > 1e12 {
            break;
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Brent's method — combines bisection with inverse quadratic interpolation
// ---------------------------------------------------------------------------

/// Brent's method for root finding. Guaranteed convergence when given a valid bracket.
fn brents_method<F>(
    evaluate: &mut F,
    target: f64,
    a: f64,
    b: f64,
    max_iterations: u32,
    precision: f64,
) -> GoalSeekOutcome
where
    F: FnMut(f64) -> f64,
{
    let mut a = a;
    let mut b = b;
    let mut fa = evaluate(a) - target;
    let mut fb = evaluate(b) - target;

    // Ensure fa and fb have opposite signs
    if fa * fb > 0.0 {
        return GoalSeekOutcome::NotFound {
            best_x: None,
            best_achieved: None,
            iterations: 0,
            reason: TerminationReason::Stagnation,
        };
    }

    // Ensure |f(a)| >= |f(b)| (b is the better approximation)
    if fa.abs() < fb.abs() {
        std::mem::swap(&mut a, &mut b);
        std::mem::swap(&mut fa, &mut fb);
    }

    let mut c = a;
    let mut fc = fa;
    let mut mflag = true;
    let mut d = 0.0_f64;

    for i in 0..max_iterations {
        // Check convergence
        if fb.abs() <= precision {
            return GoalSeekOutcome::Found {
                solution: b,
                achieved: fb + target,
                iterations: i,
            };
        }

        let midpoint = (a - b) / 2.0;
        let tol1 = 2.0 * EPSILON * b.abs() + precision / 2.0;

        if midpoint.abs() <= tol1 {
            return GoalSeekOutcome::Found {
                solution: b,
                achieved: fb + target,
                iterations: i,
            };
        }

        // Try inverse quadratic interpolation
        let s = if (fa - fc).abs() > EPSILON && (fb - fc).abs() > EPSILON {
            a * fb * fc / ((fa - fb) * (fa - fc))
                + b * fa * fc / ((fb - fa) * (fb - fc))
                + c * fa * fb / ((fc - fa) * (fc - fb))
        } else {
            // Secant method
            b - fb * (b - a) / (fb - fa)
        };

        // Conditions for rejecting interpolation and using bisection
        let cond1 = {
            let min_val = (3.0 * a + b) / 4.0;
            let max_val = b;
            let (lo, hi) = if min_val < max_val {
                (min_val, max_val)
            } else {
                (max_val, min_val)
            };
            s < lo || s > hi
        };
        let cond2 = mflag && (s - b).abs() >= (b - c).abs() / 2.0;
        let cond3 = !mflag && (s - b).abs() >= (c - d).abs() / 2.0;
        let cond4 = mflag && (b - c).abs() < tol1;
        let cond5 = !mflag && (c - d).abs() < tol1;

        let (s, new_mflag) = if cond1 || cond2 || cond3 || cond4 || cond5 {
            ((a + b) / 2.0, true)
        } else {
            (s, false)
        };
        mflag = new_mflag;

        let fs = evaluate(s) - target;

        // Check if we found the root at s
        if fs.abs() <= precision {
            return GoalSeekOutcome::Found {
                solution: s,
                achieved: fs + target,
                iterations: i + 1,
            };
        }

        d = c;
        c = b;
        fc = fb;

        if fa * fs < 0.0 {
            b = s;
            fb = fs;
        } else {
            a = s;
            fa = fs;
        }

        // Ensure |f(a)| >= |f(b)|
        if fa.abs() < fb.abs() {
            std::mem::swap(&mut a, &mut b);
            std::mem::swap(&mut fa, &mut fb);
        }
    }

    // Max iterations reached
    GoalSeekOutcome::NotFound {
        best_x: Some(b),
        best_achieved: Some(fb + target),
        iterations: max_iterations,
        reason: TerminationReason::MaxEvaluations,
    }
}

// ---------------------------------------------------------------------------
// Secant method — fallback for discontinuous or non-bracketable functions
// ---------------------------------------------------------------------------

/// Secant method: two-point iteration with step-size clamping and stagnation detection.
fn secant_method<F>(
    evaluate: &mut F,
    target: f64,
    guess: f64,
    max_iterations: u32,
    precision: f64,
    max_change: f64,
) -> GoalSeekOutcome
where
    F: FnMut(f64) -> f64,
{
    let mut x0 = guess;
    let delta = if guess.abs() > EPSILON {
        guess * 0.01
    } else {
        0.01
    };
    let mut x1 = guess + delta;

    let mut f0 = evaluate(x0) - target;
    let mut f1 = evaluate(x1) - target;

    // Track the best solution found
    let mut best_x = if f0.abs() < f1.abs() { x0 } else { x1 };
    let mut best_f = f0.abs().min(f1.abs());
    let mut stagnation_count: u32 = 0;

    for i in 0..max_iterations {
        // Check convergence
        if f1.abs() <= precision {
            return GoalSeekOutcome::Found {
                solution: x1,
                achieved: f1 + target,
                iterations: i,
            };
        }

        // Avoid division by zero
        let denom = f1 - f0;
        if denom.abs() < EPSILON {
            return GoalSeekOutcome::NotFound {
                best_x: Some(best_x),
                best_achieved: Some(evaluate(best_x)),
                iterations: i,
                reason: TerminationReason::Stagnation,
            };
        }

        // Secant step
        let mut step = f1 * (x1 - x0) / denom;

        // Clamp step size to prevent divergence
        let max_step = (1.0 + x1.abs()) * max_change;
        if step.abs() > max_step {
            step = step.signum() * max_step;
        }

        let x2 = x1 - step;
        let f2 = evaluate(x2) - target;

        // Check if the new point is non-finite
        if !f2.is_finite() {
            // Try a smaller step
            let x2_small = x1 - step * 0.1;
            let f2_small = evaluate(x2_small) - target;
            if !f2_small.is_finite() {
                return GoalSeekOutcome::NotFound {
                    best_x: Some(best_x),
                    best_achieved: Some(evaluate(best_x)),
                    iterations: i,
                    reason: TerminationReason::NumericalError,
                };
            }
            x0 = x1;
            f0 = f1;
            x1 = x2_small;
            f1 = f2_small;
        } else {
            x0 = x1;
            f0 = f1;
            x1 = x2;
            f1 = f2;
        }

        // Track best solution
        if f1.abs() < best_f {
            best_x = x1;
            best_f = f1.abs();
            stagnation_count = 0;
        } else {
            stagnation_count += 1;
        }

        // Stagnation detection
        if stagnation_count >= 10 {
            return GoalSeekOutcome::NotFound {
                best_x: Some(best_x),
                best_achieved: Some(evaluate(best_x)),
                iterations: i + 1,
                reason: TerminationReason::Stagnation,
            };
        }
    }

    // Max iterations reached
    GoalSeekOutcome::NotFound {
        best_x: Some(best_x),
        best_achieved: Some(evaluate(best_x)),
        iterations: max_iterations,
        reason: TerminationReason::MaxEvaluations,
    }
}

// ===========================================================================
// Newton-Raphson with analytic derivative + Brent fallback (1D scalar API)
// ===========================================================================

/// Newton-Raphson iteration from a single starting guess.
///
/// Returns `Some((root, residual))` if converged, `None` if diverged.
/// Convergence: `|f(x)| < ftol` (residual) OR `|x_new - x| < xtol` (step).
/// Rejects steps outside domain bounds `(lb, ub)`.
#[allow(clippy::too_many_arguments)]
fn newton_raphson<F, DF>(
    f: &mut F,
    df: &mut DF,
    guess: f64,
    lb: f64,
    ub: f64,
    xtol: f64,
    _ftol: f64,
    max_iter: u32,
) -> Option<(f64, f64)>
where
    F: FnMut(f64) -> f64,
    DF: FnMut(f64) -> f64,
{
    let mut x = guess;
    for _ in 0..max_iter {
        let fx = f(x);
        if !fx.is_finite() {
            return None;
        }
        // Exact root — no further iteration needed.
        if fx == 0.0 {
            return Some((x, 0.0));
        }
        let dfx = df(x);
        if !dfx.is_finite() || dfx.abs() < 1e-30 {
            return None;
        }
        let x_new = x - fx / dfx;
        if !x_new.is_finite() || x_new <= lb || x_new >= ub {
            return None;
        }
        // Converge by step size for maximum precision. The caller's ftol
        // controls acceptance — we squeeze out all available f64 digits here.
        if (x_new - x).abs() < xtol {
            let fx_new = f(x_new);
            return Some((
                x_new,
                if fx_new.is_finite() {
                    fx_new.abs()
                } else {
                    fx.abs()
                },
            ));
        }
        x = x_new;
    }
    None
}

/// Brent's method on a bracket `[a, b]` where `f(a)` and `f(b)` have opposite signs.
///
/// `f` must already have the target subtracted (i.e., we're finding `f(x) = 0`).
/// Returns `Some((root, residual))` if converged, `None` otherwise.
fn brent_on_bracket<F>(
    f: &mut F,
    a_init: f64,
    b_init: f64,
    ftol: f64,
    max_iter: u32,
) -> Option<(f64, f64)>
where
    F: FnMut(f64) -> f64,
{
    let mut a = a_init;
    let mut b = b_init;
    let mut fa = f(a);
    let mut fb = f(b);
    if !fa.is_finite() || !fb.is_finite() || fa * fb > 0.0 {
        return None;
    }
    if fa.abs() < ftol {
        return Some((a, fa.abs()));
    }
    if fb.abs() < ftol {
        return Some((b, fb.abs()));
    }

    // Ensure |f(a)| >= |f(b)|
    if fa.abs() < fb.abs() {
        std::mem::swap(&mut a, &mut b);
        std::mem::swap(&mut fa, &mut fb);
    }

    let mut c = a;
    let mut fc = fa;
    let mut mflag = true;
    let mut d = 0.0_f64;

    for _ in 0..max_iter {
        if fb.abs() <= ftol {
            return Some((b, fb.abs()));
        }

        let midpoint = (a - b) / 2.0;
        let tol1 = 2.0 * EPSILON * b.abs() + ftol / 2.0;
        if midpoint.abs() <= tol1 {
            return Some((b, fb.abs()));
        }

        let s = if (fa - fc).abs() > EPSILON && (fb - fc).abs() > EPSILON {
            a * fb * fc / ((fa - fb) * (fa - fc))
                + b * fa * fc / ((fb - fa) * (fb - fc))
                + c * fa * fb / ((fc - fa) * (fc - fb))
        } else {
            b - fb * (b - a) / (fb - fa)
        };

        let cond1 = {
            let min_val = (3.0 * a + b) / 4.0;
            let max_val = b;
            let (lo, hi) = if min_val < max_val {
                (min_val, max_val)
            } else {
                (max_val, min_val)
            };
            s < lo || s > hi
        };
        let cond2 = mflag && (s - b).abs() >= (b - c).abs() / 2.0;
        let cond3 = !mflag && (s - b).abs() >= (c - d).abs() / 2.0;
        let cond4 = mflag && (b - c).abs() < tol1;
        let cond5 = !mflag && (c - d).abs() < tol1;

        let (s, new_mflag) = if cond1 || cond2 || cond3 || cond4 || cond5 {
            ((a + b) / 2.0, true)
        } else {
            (s, false)
        };
        mflag = new_mflag;

        let fs = f(s);
        if !fs.is_finite() {
            return None;
        }
        if fs.abs() <= ftol {
            return Some((s, fs.abs()));
        }

        d = c;
        c = b;
        fc = fb;

        if fa * fs < 0.0 {
            b = s;
            fb = fs;
        } else {
            a = s;
            fa = fs;
        }

        if fa.abs() < fb.abs() {
            std::mem::swap(&mut a, &mut b);
            std::mem::swap(&mut fa, &mut fb);
        }
    }

    // Return best even if not fully converged — let caller decide
    Some((b, fb.abs()))
}

/// Find x such that f(x) ≈ 0 using Newton-Raphson with Brent fallback.
///
/// 1D scalar API — takes `FnMut(f64) -> f64` for both `f` and `df` (analytic
/// derivative). Designed for financial solvers where the derivative is cheap.
///
/// Strategy:
/// 1. NR from `config.x0[0]` (100 iterations)
/// 2. NR from each guess in `extra_guesses` (100 iterations each)
/// 3. Accept best NR candidate if `|f(x)| < config.ftol`
/// 4. Brent's method with bracket search over probe points
/// 5. Polish Brent result with NR (20 iterations)
///
/// Uses `config.bound(0)` for domain, `config.xtol` for step convergence,
/// `config.ftol` for residual acceptance.
pub fn solve_root_nr<F, DF>(
    mut f: F,
    mut df: DF,
    config: &SolverConfig,
    extra_guesses: &[f64],
) -> SolverResult
where
    F: FnMut(f64) -> f64,
    DF: FnMut(f64) -> f64,
{
    let start = now();
    let bound = config.bound(0);
    let lb = bound.lower.unwrap_or(-f64::MAX);
    let ub = bound.upper.unwrap_or(f64::MAX);
    let ftol = if config.ftol <= 0.0 {
        1e-8
    } else {
        config.ftol
    };
    let xtol = if config.xtol <= 0.0 {
        1e-12
    } else {
        config.xtol
    };
    let x0 = config.x0.first().copied().unwrap_or(0.0);

    const NR_ITERS_PER_GUESS: u32 = 100;
    const BRENT_ITERS: u32 = 2000;
    const POLISH_ITERS: u32 = 20;

    let mut best_x = f64::NAN;
    let mut best_residual = f64::MAX;

    // 1. NR from primary guess
    if x0 > lb
        && x0 < ub
        && let Some((root, residual)) =
            newton_raphson(&mut f, &mut df, x0, lb, ub, xtol, ftol, NR_ITERS_PER_GUESS)
        && residual < best_residual
    {
        best_x = root;
        best_residual = residual;
    }
    if best_residual < ftol {
        return make_nr_result(true, best_x, best_residual, 0, elapsed_since(start));
    }

    // 2. NR from extra guesses
    for &g in extra_guesses {
        if g <= lb || g >= ub {
            continue;
        }
        if let Some((root, residual)) =
            newton_raphson(&mut f, &mut df, g, lb, ub, xtol, ftol, NR_ITERS_PER_GUESS)
            && residual < best_residual
        {
            best_x = root;
            best_residual = residual;
        }
        if best_residual < ftol {
            return make_nr_result(true, best_x, best_residual, 0, elapsed_since(start));
        }
    }

    // 3. Brent fallback — build probe points and find sign changes
    let mut probes: Vec<f64> = Vec::with_capacity(64);
    probes.push(x0);
    probes.extend_from_slice(extra_guesses);
    // Standard grid
    for &p in &[
        -0.999, -0.99, -0.98, -0.95, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, -0.05,
        0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1.0, 2.0, 5.0, 10.0, 100.0,
    ] {
        probes.push(p);
    }
    // Filter to domain and deduplicate
    probes.retain(|&p| p > lb && p < ub);
    probes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    probes.dedup_by(|a, b| (*a - *b).abs() < 1e-15);

    // Evaluate at all probe points
    let probe_vals: Vec<(f64, f64)> = probes
        .iter()
        .filter_map(|&p| {
            let v = f(p);
            if v.is_finite() { Some((p, v)) } else { None }
        })
        .collect();

    // Find sign changes and run Brent
    for i in 0..probe_vals.len().saturating_sub(1) {
        let (a, fa) = probe_vals[i];
        let (b, fb) = probe_vals[i + 1];
        if fa * fb < 0.0
            && let Some((root, residual)) = brent_on_bracket(&mut f, a, b, ftol, BRENT_ITERS)
        {
            if residual < best_residual {
                best_x = root;
                best_residual = residual;
            }
            if best_residual < ftol {
                // 4. Polish with NR
                if let Some((polished, pol_res)) =
                    newton_raphson(&mut f, &mut df, best_x, lb, ub, xtol, ftol, POLISH_ITERS)
                    && pol_res < best_residual
                {
                    best_x = polished;
                    best_residual = pol_res;
                }
                return make_nr_result(true, best_x, best_residual, 0, elapsed_since(start));
            }
        }
    }

    // If we have a candidate from Brent that's close but didn't hit ftol, try polishing
    if best_residual < f64::MAX && !best_x.is_nan() {
        if let Some((polished, pol_res)) =
            newton_raphson(&mut f, &mut df, best_x, lb, ub, xtol, ftol, POLISH_ITERS)
            && pol_res < best_residual
        {
            best_x = polished;
            best_residual = pol_res;
        }
        if best_residual < ftol {
            return make_nr_result(true, best_x, best_residual, 0, elapsed_since(start));
        }
    }

    // Not converged
    make_nr_result(false, best_x, best_residual, 0, elapsed_since(start))
}

fn make_nr_result(
    converged: bool,
    x: f64,
    residual: f64,
    evals: u32,
    elapsed_ms: u32,
) -> SolverResult {
    SolverResult {
        converged,
        x: vec![x],
        fun: residual,
        evals,
        iters: evals, // NR iterations ≈ evals for tracking purposes
        elapsed_ms,
        termination: if converged {
            TerminationReason::Converged
        } else {
            TerminationReason::MaxEvaluations
        },
        message: if converged {
            format!("Root found ({} evals, residual {:.2e})", evals, residual)
        } else {
            format!(
                "Root not found ({} evals, best residual {:.2e})",
                evals, residual
            )
        },
    }
}

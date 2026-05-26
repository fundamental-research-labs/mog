//! Wolfe line search -- shared by BFGS and L-BFGS-B.
//!
//! Provides a Strong Wolfe line search with bracket-zoom, plus a simple
//! backtracking (Armijo-only) fallback.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Sufficient decrease parameter (Armijo condition).
const C1: f64 = 1e-4;

/// Curvature condition parameter (Strong Wolfe).
const C2: f64 = 0.9;

/// Maximum iterations for bracket phase.
const MAX_BRACKET_ITERS: usize = 25;

/// Maximum iterations for zoom phase.
const MAX_ZOOM_ITERS: usize = 20;

/// Maximum iterations for backtracking fallback.
const MAX_BACKTRACK_ITERS: usize = 40;

/// Minimum step size floor.
const ALPHA_MIN: f64 = 1e-16;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/// Result of a line search.
#[derive(Debug, Clone, Copy)]
pub struct LineSearchResult {
    /// Step size found.
    pub alpha: f64,
    /// Function value at `x + alpha * direction`.
    pub f_alpha: f64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Dot product of two slices.
#[inline]
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(ai, bi)| ai * bi).sum()
}

/// Compute x_trial = x + alpha * d.
#[inline]
fn trial_point(x: &[f64], alpha: f64, d: &[f64]) -> Vec<f64> {
    x.iter()
        .zip(d.iter())
        .map(|(xi, di)| xi + alpha * di)
        .collect()
}

/// Directional derivative at a trial point via finite differences.
/// Uses central difference along the line: (f(x + (alpha+h)*d) - f(x + (alpha-h)*d)) / (2*h)
fn directional_derivative<F: FnMut(&[f64]) -> f64>(
    f: &mut F,
    x: &[f64],
    d: &[f64],
    alpha: f64,
) -> f64 {
    let h = 1e-8 * alpha.abs().max(1.0);
    let x_plus = trial_point(x, alpha + h, d);
    let x_minus = trial_point(x, alpha - h, d);
    let fp = f(&x_plus);
    let fm = f(&x_minus);
    (fp - fm) / (2.0 * h)
}

/// Quadratic interpolation minimizer given two points with one derivative.
///
/// Fits a quadratic through (a, fa) with slope ga, and (b, fb).
/// Returns the minimizer if it lies strictly within (lo, hi).
fn quadratic_minimizer(a: f64, fa: f64, ga: f64, b: f64, fb: f64, lo: f64, hi: f64) -> Option<f64> {
    let d = b - a;
    if d.abs() < 1e-30 {
        return None;
    }
    // Quadratic: p(t) = fa + ga*(t-a) + c2*(t-a)^2
    // p(b) = fa + ga*d + c2*d^2 = fb
    // c2 = (fb - fa - ga*d) / d^2
    let c2 = (fb - fa - ga * d) / (d * d);
    if c2 <= 0.0 {
        // Not convex, no minimum
        return None;
    }
    // Minimizer: t = a - ga / (2*c2)
    let alpha_q = a - ga / (2.0 * c2);
    if alpha_q.is_finite() && alpha_q > lo && alpha_q < hi {
        Some(alpha_q)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Zoom phase
// ---------------------------------------------------------------------------

/// Zoom phase: given a bracket [alpha_lo, alpha_hi] known to contain a point
/// satisfying the Strong Wolfe conditions, narrow it down.
#[allow(clippy::too_many_arguments)]
fn zoom<F: FnMut(&[f64]) -> f64>(
    f: &mut F,
    x: &[f64],
    d: &[f64],
    f0: f64,
    g0_dot_d: f64,
    mut alpha_lo: f64,
    mut f_lo: f64,
    mut g_lo: f64,
    mut alpha_hi: f64,
    mut f_hi: f64,
) -> LineSearchResult {
    let mut best_alpha = if f_lo <= f_hi { alpha_lo } else { alpha_hi };
    let mut best_f = f_lo.min(f_hi);

    for _ in 0..MAX_ZOOM_ITERS {
        let lo_bound = alpha_lo.min(alpha_hi);
        let hi_bound = alpha_lo.max(alpha_hi);
        let span = hi_bound - lo_bound;

        if span < ALPHA_MIN {
            break;
        }

        // Try quadratic interpolation, with safeguard margin
        let margin = 0.1 * span;
        let safe_lo = lo_bound + margin;
        let safe_hi = hi_bound - margin;

        let alpha_j = if safe_lo < safe_hi {
            quadratic_minimizer(alpha_lo, f_lo, g_lo, alpha_hi, f_hi, safe_lo, safe_hi)
                .unwrap_or(0.5 * (alpha_lo + alpha_hi))
        } else {
            0.5 * (alpha_lo + alpha_hi)
        };

        let x_j = trial_point(x, alpha_j, d);
        let f_j = f(&x_j);

        if f_j.is_finite() && f_j < best_f {
            best_alpha = alpha_j;
            best_f = f_j;
        }

        if !f_j.is_finite() {
            // Shrink from the bad side
            alpha_hi = alpha_j;
            f_hi = f64::INFINITY;
            continue;
        }

        // Check Armijo
        if f_j > f0 + C1 * alpha_j * g0_dot_d || f_j >= f_lo {
            alpha_hi = alpha_j;
            f_hi = f_j;
        } else {
            // Check strong curvature condition
            let g_j = directional_derivative(f, x, d, alpha_j);

            if g_j.abs() <= C2 * g0_dot_d.abs() {
                // Both Wolfe conditions satisfied
                return LineSearchResult {
                    alpha: alpha_j,
                    f_alpha: f_j,
                };
            }

            if g_j * (alpha_hi - alpha_lo) >= 0.0 {
                alpha_hi = alpha_lo;
                f_hi = f_lo;
            }

            alpha_lo = alpha_j;
            f_lo = f_j;
            g_lo = g_j;
        }
    }

    LineSearchResult {
        alpha: best_alpha,
        f_alpha: best_f,
    }
}

// ---------------------------------------------------------------------------
// Strong Wolfe line search
// ---------------------------------------------------------------------------

/// Strong Wolfe line search.
///
/// Finds a step size `alpha` such that `x + alpha * direction` approximately
/// satisfies the Strong Wolfe conditions:
/// - Armijo: `f(x + alpha*d) <= f(x) + c1*alpha*(grad . d)`
/// - Curvature: `|grad(x + alpha*d) . d| <= c2*|grad . d|`
///
/// Falls back to backtracking if the bracket-zoom fails.
///
/// # Arguments
/// - `f`: objective function taking `&[f64] -> f64`
/// - `x`: current point
/// - `f0`: `f(x)`
/// - `grad`: gradient at x
/// - `direction`: search direction (should be a descent direction)
///
/// # Returns
/// Step size and function value at the new point.
pub fn wolfe_line_search<F: FnMut(&[f64]) -> f64>(
    f: &mut F,
    x: &[f64],
    f0: f64,
    grad: &[f64],
    direction: &[f64],
) -> LineSearchResult {
    let g0_dot_d = dot(grad, direction);

    // Not a descent direction
    if g0_dot_d >= 0.0 {
        return LineSearchResult {
            alpha: 0.0,
            f_alpha: f0,
        };
    }

    let mut alpha_prev = 0.0;
    let mut f_prev = f0;
    let mut g_prev = g0_dot_d;

    // Initial step size
    let mut alpha = 1.0;
    let alpha_max = 1e10;

    for i in 0..MAX_BRACKET_ITERS {
        let x_trial = trial_point(x, alpha, direction);
        let f_alpha = f(&x_trial);

        // If non-finite, treat as very large (bracket found)
        if !f_alpha.is_finite()
            || f_alpha > f0 + C1 * alpha * g0_dot_d
            || (i > 0 && f_alpha >= f_prev)
        {
            // We have a bracket: [alpha_prev, alpha]
            return zoom(
                f, x, direction, f0, g0_dot_d, alpha_prev, f_prev, g_prev, alpha, f_alpha,
            );
        }

        // Check curvature condition
        let g_alpha = directional_derivative(f, x, direction, alpha);

        if g_alpha.abs() <= C2 * g0_dot_d.abs() {
            // Both Wolfe conditions satisfied
            return LineSearchResult { alpha, f_alpha };
        }

        if g_alpha >= 0.0 {
            // We have a bracket: [alpha, alpha_prev]
            return zoom(
                f, x, direction, f0, g0_dot_d, alpha, f_alpha, g_alpha, alpha_prev, f_prev,
            );
        }

        // Increase alpha
        alpha_prev = alpha;
        f_prev = f_alpha;
        g_prev = g_alpha;
        alpha = (2.0 * alpha).min(alpha_max);
    }

    // Bracket phase exhausted; fall back to backtracking
    backtracking_line_search(f, x, f0, grad, direction)
}

// ---------------------------------------------------------------------------
// Backtracking line search (Armijo only)
// ---------------------------------------------------------------------------

/// Simple backtracking line search (Armijo condition only).
///
/// Halves the step size until the sufficient decrease condition is met.
/// Used as fallback when the Wolfe search fails.
///
/// # Arguments
/// - `f`: objective function
/// - `x`: current point
/// - `f0`: `f(x)`
/// - `grad`: gradient at x
/// - `direction`: search direction
///
/// # Returns
/// Step size and function value at the new point.
pub fn backtracking_line_search<F: FnMut(&[f64]) -> f64>(
    f: &mut F,
    x: &[f64],
    f0: f64,
    grad: &[f64],
    direction: &[f64],
) -> LineSearchResult {
    let g0_dot_d = dot(grad, direction);

    // Not a descent direction
    if g0_dot_d >= 0.0 {
        return LineSearchResult {
            alpha: 0.0,
            f_alpha: f0,
        };
    }

    let mut alpha = 1.0;

    for _ in 0..MAX_BACKTRACK_ITERS {
        if alpha < ALPHA_MIN {
            return LineSearchResult {
                alpha: 0.0,
                f_alpha: f0,
            };
        }

        let x_trial = trial_point(x, alpha, direction);
        let f_alpha = f(&x_trial);

        // Armijo condition
        if f_alpha.is_finite() && f_alpha <= f0 + C1 * alpha * g0_dot_d {
            return LineSearchResult { alpha, f_alpha };
        }

        alpha *= 0.5;
    }

    // Failed to find acceptable step
    LineSearchResult {
        alpha: 0.0,
        f_alpha: f0,
    }
}

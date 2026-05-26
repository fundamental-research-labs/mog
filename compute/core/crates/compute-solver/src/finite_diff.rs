//! Finite difference gradient estimation.
//!
//! Central differences with NaN-safe forward-difference fallback.
//! Used by BFGS and L-BFGS-B for automatic gradient computation.

/// Step size coefficient: eps^(1/3) where eps = f64::EPSILON.
/// This gives O(h^2) accuracy for central differences.
const CBRT_EPS: f64 = 6.055454452393343e-6;

/// Minimum step size to prevent catastrophic cancellation.
const H_MIN: f64 = 1e-10;

/// Compute the finite-difference step size for variable `i`.
#[inline]
fn step_size(xi: f64) -> f64 {
    let h = CBRT_EPS * xi.abs().max(1.0);
    h.max(H_MIN)
}

/// Compute gradient via central finite differences.
///
/// # Arguments
/// - `f`: objective function
/// - `x`: point at which to compute gradient
/// - `f_x`: function value at x (avoids redundant evaluation)
///
/// # Returns
/// Gradient vector of length `x.len()`.
pub fn gradient<F: FnMut(&[f64]) -> f64>(f: &mut F, x: &[f64], f_x: f64) -> Vec<f64> {
    gradient_with_evals(f, x, f_x).0
}

/// Compute gradient via central finite differences, returning the number of
/// function evaluations used.
///
/// # Arguments
/// - `f`: objective function
/// - `x`: point at which to compute gradient
/// - `f_x`: function value at x (avoids redundant evaluation)
///
/// # Returns
/// `(gradient, eval_count)` tuple.
pub fn gradient_with_evals<F: FnMut(&[f64]) -> f64>(
    f: &mut F,
    x: &[f64],
    f_x: f64,
) -> (Vec<f64>, u32) {
    let n = x.len();
    let mut grad = vec![0.0; n];
    let mut x_work = x.to_vec();
    let mut evals: u32 = 0;

    for i in 0..n {
        let xi = x[i];
        let h = step_size(xi);

        // Central difference: (f(x + h*e_i) - f(x - h*e_i)) / (2*h)
        x_work[i] = xi + h;
        let f_plus = f(&x_work);
        evals += 1;

        x_work[i] = xi - h;
        let f_minus = f(&x_work);
        evals += 1;

        // Restore
        x_work[i] = xi;

        let g = (f_plus - f_minus) / (2.0 * h);

        if g.is_finite() {
            grad[i] = g;
        } else {
            // NaN-safe fallback: try forward difference using existing f_plus
            let g_fwd = (f_plus - f_x) / h;
            if g_fwd.is_finite() {
                grad[i] = g_fwd;
            } else {
                // f_plus was likely NaN; try a fresh forward evaluation
                x_work[i] = xi + h;
                let f_plus2 = f(&x_work);
                evals += 1;
                x_work[i] = xi;

                let g_fwd2 = (f_plus2 - f_x) / h;
                if g_fwd2.is_finite() {
                    grad[i] = g_fwd2;
                } else {
                    // Give up: set to zero
                    grad[i] = 0.0;
                }
            }
        }
    }

    (grad, evals)
}

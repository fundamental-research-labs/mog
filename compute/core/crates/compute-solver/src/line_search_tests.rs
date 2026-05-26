//! Tests for line search algorithms.

use crate::line_search::{backtracking_line_search, wolfe_line_search};

/// Armijo constant (must match line_search.rs).
const C1: f64 = 1e-4;

// ---------------------------------------------------------------------------
// Wolfe line search tests
// ---------------------------------------------------------------------------

#[test]
fn wolfe_quadratic_1d() {
    // f(x) = x^2, starting at x=5, direction=-1, grad=10
    // Wolfe conditions can be satisfied at many alpha values (not necessarily at minimum)
    let mut f = |x: &[f64]| x[0] * x[0];
    let result = wolfe_line_search(&mut f, &[5.0], 25.0, &[10.0], &[-1.0]);
    // Should find some positive alpha that decreases f
    assert!(
        result.alpha > 0.0,
        "expected positive alpha, got {}",
        result.alpha
    );
    assert!(
        result.f_alpha < 25.0,
        "expected decrease, got f={}",
        result.f_alpha
    );
    // Verify Armijo condition
    let g0_dot_d = -10.0;
    assert!(
        result.f_alpha <= 25.0 + C1 * result.alpha * g0_dot_d + 1e-12,
        "Armijo violated"
    );
}

#[test]
fn wolfe_armijo_satisfied() {
    // Verify the Armijo condition is satisfied for the returned alpha
    let mut f = |x: &[f64]| x[0] * x[0] + x[1] * x[1];
    let x = [3.0, 4.0];
    let f0 = 25.0;
    let grad = [6.0, 8.0];
    let dir = [-6.0, -8.0]; // steepest descent
    let g0_dot_d: f64 = grad.iter().zip(dir.iter()).map(|(a, b)| a * b).sum();

    let result = wolfe_line_search(&mut f, &x, f0, &grad, &dir);

    // Armijo: f(x + alpha*d) <= f0 + c1*alpha*(g.d)
    let armijo_rhs = f0 + C1 * result.alpha * g0_dot_d;
    assert!(
        result.f_alpha <= armijo_rhs + 1e-12,
        "Armijo violated: f={} > {}",
        result.f_alpha,
        armijo_rhs
    );
}

#[test]
fn wolfe_not_descent_direction() {
    // Direction is NOT a descent direction (g.d >= 0)
    let mut f = |x: &[f64]| x[0] * x[0];
    let result = wolfe_line_search(&mut f, &[3.0], 9.0, &[6.0], &[1.0]);
    // g.d = 6*1 = 6 > 0, should return alpha=0
    assert_eq!(result.alpha, 0.0, "expected alpha=0, got {}", result.alpha);
    assert_eq!(result.f_alpha, 9.0);
}

#[test]
fn wolfe_rosenbrock_descent() {
    // Rosenbrock: f(x,y) = (1-x)^2 + 100*(y-x^2)^2
    let mut f = |x: &[f64]| {
        let a = 1.0 - x[0];
        let b = x[1] - x[0] * x[0];
        a * a + 100.0 * b * b
    };
    let x = [-1.0, 1.0];
    let f0 = f(&x);
    // Approximate gradient via finite diff
    let grad = crate::finite_diff::gradient(&mut f, &x, f0);
    // Steepest descent direction
    let dir: Vec<f64> = grad.iter().map(|g| -g).collect();

    let result = wolfe_line_search(&mut f, &x, f0, &grad, &dir);

    assert!(
        result.alpha > 0.0,
        "expected positive alpha, got {}",
        result.alpha
    );
    assert!(
        result.f_alpha < f0,
        "expected decrease: f0={}, f_alpha={}",
        f0,
        result.f_alpha
    );
}

#[test]
fn wolfe_flat_function() {
    // f(x) = 5.0 (constant)
    // grad = 0, so g.d = 0; should return alpha=0
    let mut f = |_x: &[f64]| 5.0;
    let result = wolfe_line_search(&mut f, &[1.0], 5.0, &[0.0], &[-1.0]);
    assert_eq!(result.alpha, 0.0);
    assert_eq!(result.f_alpha, 5.0);
}

#[test]
fn wolfe_steep_function() {
    // f(x) = exp(x), starting at x=10 with direction -1
    // grad = exp(10) ~ 22026
    let x0: f64 = 10.0;
    let f0 = x0.exp();
    let g0 = f0; // f'(x) = exp(x)
    let mut f = |x: &[f64]| x[0].exp();

    let result = wolfe_line_search(&mut f, &[x0], f0, &[g0], &[-1.0]);

    assert!(result.alpha > 0.0, "expected positive alpha");
    assert!(result.f_alpha < f0, "expected decrease from {}", f0);
}

#[test]
fn wolfe_large_step_decrease() {
    // f(x) = (x-10)^2, start at x=0, grad=-20, direction=1
    // g.d = -20 < 0 (descent). Minimum at x=10 (alpha=10).
    let mut f = |x: &[f64]| (x[0] - 10.0).powi(2);
    let result = wolfe_line_search(&mut f, &[0.0], 100.0, &[-20.0], &[1.0]);
    assert!(result.alpha > 0.0);
    assert!(result.f_alpha < 100.0);
}

// ---------------------------------------------------------------------------
// Backtracking line search tests
// ---------------------------------------------------------------------------

#[test]
fn backtracking_quadratic_1d() {
    let mut f = |x: &[f64]| x[0] * x[0];
    let result = backtracking_line_search(&mut f, &[5.0], 25.0, &[10.0], &[-1.0]);

    assert!(result.alpha > 0.0, "expected positive alpha");
    assert!(
        result.f_alpha < 25.0,
        "expected decrease, got f={}",
        result.f_alpha
    );
    // Verify Armijo condition
    let g0_dot_d = 10.0 * (-1.0);
    assert!(result.f_alpha <= 25.0 + C1 * result.alpha * g0_dot_d + 1e-12);
}

#[test]
fn backtracking_not_descent() {
    let mut f = |x: &[f64]| x[0] * x[0];
    let result = backtracking_line_search(&mut f, &[3.0], 9.0, &[6.0], &[1.0]);
    assert_eq!(result.alpha, 0.0);
}

#[test]
fn backtracking_sphere_2d() {
    // f(x,y) = x^2 + y^2
    let mut f = |x: &[f64]| x[0] * x[0] + x[1] * x[1];
    let x = [3.0, 4.0];
    let f0 = 25.0;
    let grad = [6.0, 8.0];
    let dir = [-6.0, -8.0];

    let result = backtracking_line_search(&mut f, &x, f0, &grad, &dir);

    assert!(result.alpha > 0.0);
    assert!(result.f_alpha < f0);
}

#[test]
fn backtracking_steep_descent() {
    // f(x) = x^4, at x=2, f=16, f'=32, direction=-1
    let mut f = |x: &[f64]| x[0].powi(4);
    let result = backtracking_line_search(&mut f, &[2.0], 16.0, &[32.0], &[-1.0]);

    assert!(result.alpha > 0.0);
    assert!(result.f_alpha < 16.0);
}

#[test]
fn wolfe_returns_finite_values() {
    // Ensure we never return NaN or infinity
    let mut f = |x: &[f64]| x[0] * x[0] + 3.0 * x[1] * x[1];
    let x = [10.0, -7.0];
    let f0 = f(&x);
    let grad = [20.0, -42.0];
    let dir = [-20.0, 42.0]; // steepest descent
    let result = wolfe_line_search(&mut f, &x, f0, &grad, &dir);

    assert!(result.alpha.is_finite(), "alpha must be finite");
    assert!(result.f_alpha.is_finite(), "f_alpha must be finite");
}

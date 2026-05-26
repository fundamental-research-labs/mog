//! Tests for finite difference gradient estimation.

use crate::finite_diff::{gradient, gradient_with_evals};

/// Central-difference accuracy bound: O(eps^(2/3)) ~ 3.7e-11
const ACCURACY: f64 = 1e-6;

#[test]
fn gradient_x_squared_at_3() {
    // f(x) = x^2, f'(3) = 6
    let mut f = |x: &[f64]| x[0] * x[0];
    let g = gradient(&mut f, &[3.0], 9.0);
    assert!((g[0] - 6.0).abs() < ACCURACY, "got {}", g[0]);
}

#[test]
fn gradient_sphere_2d() {
    // f(x,y) = x^2 + y^2, grad at (3,4) = (6,8)
    let mut f = |x: &[f64]| x[0] * x[0] + x[1] * x[1];
    let g = gradient(&mut f, &[3.0, 4.0], 25.0);
    assert!((g[0] - 6.0).abs() < ACCURACY, "g[0] = {}", g[0]);
    assert!((g[1] - 8.0).abs() < ACCURACY, "g[1] = {}", g[1]);
}

#[test]
fn gradient_at_zero() {
    // f(x) = x^2, f'(0) = 0
    // step_size uses max(|x|, 1.0) so h won't collapse
    let mut f = |x: &[f64]| x[0] * x[0];
    let g = gradient(&mut f, &[0.0], 0.0);
    assert!(g[0].abs() < ACCURACY, "got {}", g[0]);
}

#[test]
fn gradient_cos_at_zero() {
    // f(x) = cos(x), f'(0) = -sin(0) = 0
    let mut f = |x: &[f64]| x[0].cos();
    let g = gradient(&mut f, &[0.0], 1.0);
    assert!(g[0].abs() < ACCURACY, "got {}", g[0]);
}

#[test]
fn gradient_exp_at_1() {
    // f(x) = exp(x), f'(1) = e
    let e = std::f64::consts::E;
    let mut f = |x: &[f64]| x[0].exp();
    let g = gradient(&mut f, &[1.0], e);
    assert!((g[0] - e).abs() < ACCURACY, "expected ~{}, got {}", e, g[0]);
}

#[test]
fn gradient_high_dimensional() {
    // f(x) = sum(x_i^2), grad_i = 2*x_i
    let n = 10;
    let x: Vec<f64> = (1..=n).map(|i| i as f64).collect();
    let f_x: f64 = x.iter().map(|xi| xi * xi).sum();
    let mut f = |x: &[f64]| -> f64 { x.iter().map(|xi| xi * xi).sum() };
    let g = gradient(&mut f, &x, f_x);

    assert_eq!(g.len(), n);
    for i in 0..n {
        let expected = 2.0 * x[i];
        assert!(
            (g[i] - expected).abs() < ACCURACY,
            "g[{}] = {}, expected {}",
            i,
            g[i],
            expected
        );
    }
}

#[test]
fn gradient_nan_safe_fallback() {
    // f(x) = sqrt(x) -- NaN for negative x
    // At x=1, f'(1) = 0.5
    // Central diff: (sqrt(1+h) - sqrt(1-h)) / 2h -- both sides valid, should work
    let mut f = |x: &[f64]| {
        if x[0] < 0.0 { f64::NAN } else { x[0].sqrt() }
    };
    let g = gradient(&mut f, &[1.0], 1.0);
    assert!((g[0] - 0.5).abs() < 1e-4, "got {}", g[0]);
}

#[test]
fn gradient_nan_at_boundary() {
    // f(x) = sqrt(x), at x very close to 0
    // Central diff will try negative x -> NaN, should fall back to forward diff
    let mut f = |x: &[f64]| {
        if x[0] < 0.0 { f64::NAN } else { x[0].sqrt() }
    };
    let x0: f64 = 1e-8;
    let f_x = x0.sqrt();
    let g = gradient(&mut f, &[x0], f_x);
    // Forward difference should give something finite
    assert!(g[0].is_finite(), "expected finite, got {}", g[0]);
    // Derivative of sqrt at small x is large: 1/(2*sqrt(x))
    assert!(g[0] > 0.0, "expected positive gradient, got {}", g[0]);
}

#[test]
fn gradient_all_nan_returns_zero() {
    // Function that always returns NaN
    let mut f = |_x: &[f64]| f64::NAN;
    let g = gradient(&mut f, &[5.0], f64::NAN);
    assert_eq!(g[0], 0.0, "expected 0.0 for all-NaN, got {}", g[0]);
}

#[test]
fn gradient_with_evals_count() {
    // For n=3, central differences use 2*n = 6 evals (no NaN fallback)
    let mut f = |x: &[f64]| -> f64 { x.iter().map(|xi| xi * xi).sum() };
    let x = vec![1.0, 2.0, 3.0];
    let f_x: f64 = x.iter().map(|xi| xi * xi).sum();
    let (g, evals) = gradient_with_evals(&mut f, &x, f_x);
    assert_eq!(evals, 6, "expected 6 evals for 3D, got {}", evals);
    assert_eq!(g.len(), 3);
}

#[test]
fn gradient_accuracy_order() {
    // Central differences should achieve O(h^2) ~ O(eps^(2/3)) ~ 3.7e-11 accuracy
    // for smooth functions with well-chosen step size
    let mut f = |x: &[f64]| x[0].sin();
    let x = std::f64::consts::FRAC_PI_4;
    let f_x = x.sin();
    let g = gradient(&mut f, &[x], f_x);
    let exact = x.cos(); // cos(pi/4)
    let error = (g[0] - exact).abs();
    // Should be much better than 1e-6
    assert!(
        error < 1e-9,
        "expected high accuracy, error = {:.2e}",
        error
    );
}

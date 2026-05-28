//! Shared objectives and solver config builders for dispatch tests.

use crate::types::{Bound, Method, SolverConfig};

/// f(x) = sum(xi^2). Minimum at origin, f* = 0.
pub(super) fn sphere(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi * xi).sum()
}

/// Rosenbrock: f(x) = sum[ 100*(x_{i+1} - x_i^2)^2 + (1-x_i)^2 ].
/// Minimum at (1,1,...,1), f* = 0. Narrow curved valley.
pub(super) fn rosenbrock(x: &[f64]) -> f64 {
    x.windows(2)
        .map(|w| 100.0 * (w[1] - w[0].powi(2)).powi(2) + (1.0 - w[0]).powi(2))
        .sum()
}

/// Rastrigin: highly multimodal (many local minima). Global min at origin, f* = 0.
pub(super) fn rastrigin(x: &[f64]) -> f64 {
    let n = x.len() as f64;
    10.0 * n
        + x.iter()
            .map(|xi| xi * xi - 10.0 * (2.0 * std::f64::consts::PI * xi).cos())
            .sum::<f64>()
}

/// Booth function: f(x,y) = (x+2y-7)^2 + (2x+y-5)^2. Minimum at (1,3), f*=0.
pub(super) fn booth(x: &[f64]) -> f64 {
    (x[0] + 2.0 * x[1] - 7.0).powi(2) + (2.0 * x[0] + x[1] - 5.0).powi(2)
}

/// Simple linear function f(x) = 2x + 3 (for root finding: 2x+3=7 → x=2).
pub(super) fn linear(x: &[f64]) -> f64 {
    2.0 * x[0] + 3.0
}

/// Quadratic f(x) = x^2 - 4 (root at x=2: x^2=4).
pub(super) fn quadratic_1d(x: &[f64]) -> f64 {
    x[0] * x[0] - 4.0
}

/// Discontinuous step function (defeats gradient methods).
pub(super) fn step_function(x: &[f64]) -> f64 {
    x.iter().map(|xi| xi.floor().powi(2)).sum()
}

/// Ackley function: multimodal, global min at origin.
pub(super) fn ackley(x: &[f64]) -> f64 {
    let n = x.len() as f64;
    let sum_sq: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_cos: f64 = x
        .iter()
        .map(|xi| (2.0 * std::f64::consts::PI * xi).cos())
        .sum();
    -20.0 * (-0.2 * (sum_sq / n).sqrt()).exp() - (sum_cos / n).exp() + 20.0 + std::f64::consts::E
}

pub(super) fn config_nm(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        method: Method::NelderMead,
        x0,
        max_evals: 10_000,
        ..Default::default()
    }
}

pub(super) fn config_bfgs(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        method: Method::BFGS,
        x0,
        max_evals: 10_000,
        ..Default::default()
    }
}

pub(super) fn config_lbfgsb(x0: Vec<f64>, bounds: Vec<Bound>) -> SolverConfig {
    SolverConfig {
        method: Method::LBFGSB,
        x0,
        bounds,
        max_evals: 10_000,
        ..Default::default()
    }
}

pub(super) fn config_de(x0: Vec<f64>, bounds: Vec<Bound>) -> SolverConfig {
    SolverConfig {
        method: Method::DifferentialEvolution,
        x0,
        bounds,
        seed: Some(42),
        max_evals: 50_000,
        ..Default::default()
    }
}

pub(super) fn config_auto(x0: Vec<f64>) -> SolverConfig {
    SolverConfig {
        method: Method::Auto,
        x0,
        max_evals: 10_000,
        ..Default::default()
    }
}

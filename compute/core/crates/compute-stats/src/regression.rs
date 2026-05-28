//! Regression functions for chart trendlines.
//!
//! Supports linear, polynomial, exponential, logarithmic, and power
//! regression, plus simple moving average.
//!
//! Ported from `charts/src/math/regression.ts`.
//! All functions are pure — no closures in output (wire-safe for WASM).

mod dispatch;
mod format;
mod linear;
mod metrics;
mod moving_average;
mod points;
mod polynomial;
mod solver;
mod transformed;
mod types;

#[cfg(test)]
mod tests;

pub use dispatch::create_regression;
pub use linear::linear_regression;
pub use moving_average::moving_average;
pub use polynomial::polynomial_regression;
pub use transformed::{exponential_regression, logarithmic_regression, power_regression};
pub use types::{MovingAverageResult, RegressionOptions};

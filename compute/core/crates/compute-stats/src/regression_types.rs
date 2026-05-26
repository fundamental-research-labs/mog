//! Types for regression analysis.
//!
//! Shared by `compute-stats::regression` and consumed by `compute-core-wasm`.

use serde::{Deserialize, Serialize};

/// A 2D point.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    /// X coordinate.
    pub x: f64,
    /// Y coordinate.
    pub y: f64,
}

/// Supported regression methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RegressionMethod {
    /// Linear: y = mx + b
    Linear,
    /// Logarithmic: y = a + b * ln(x)
    Log,
    /// Exponential: y = a * e^(bx)
    Exp,
    /// Power: y = a * x^b
    Pow,
    /// Quadratic (polynomial degree 2)
    Quad,
    /// Polynomial (arbitrary degree)
    Poly,
}

/// Result of a regression computation.
///
/// Wire-safe: stores coefficients and pre-generated points, no closures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegressionOutput {
    /// Regression method used.
    pub method: RegressionMethod,
    /// Polynomial order (if applicable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// Regression coefficients (interpretation depends on method).
    pub coefficients: Vec<f64>,
    /// R-squared (coefficient of determination), in [0, 1].
    pub r_squared: f64,
    /// Pre-generated points for rendering the trendline.
    pub points: Vec<Point>,
    /// Human-readable equation string.
    pub equation: String,
}

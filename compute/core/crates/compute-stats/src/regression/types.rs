use serde::{Deserialize, Serialize};

use crate::Point;

/// Options for regression calculations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegressionOptions {
    /// Number of points to generate for rendering (default: 50).
    pub num_points: Option<usize>,
    /// Minimum x value for generated points (default: min of data).
    pub min_x: Option<f64>,
    /// Maximum x value for generated points (default: max of data).
    pub max_x: Option<f64>,
    /// Precision for equation display (default: 4 significant digits).
    pub precision: Option<usize>,
}

impl Default for RegressionOptions {
    fn default() -> Self {
        Self {
            num_points: Some(50),
            min_x: None,
            max_x: None,
            precision: Some(4),
        }
    }
}

/// Result of a moving-average computation.
#[derive(Debug, Clone)]
pub struct MovingAverageResult {
    /// Points representing the moving average.
    pub points: Vec<Point>,
}

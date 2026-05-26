//! Chart data transforms and statistical computations — stateless, no engine instance needed.

// Re-export the types consumers need
pub use compute_core::charts::regression::RegressionOptions;
pub use compute_core::charts::types::{
    DataRow, DensityResult, HistogramBin, Point, RegressionMethod, RegressionOutput, StackInput,
    StackMode, StackOutput, Transform,
};

use compute_core::bridge_pure::ChartBridge;

/// Apply a chain of data transforms (filter, aggregate, sort, bin, etc.).
pub fn apply_transforms(data: Vec<DataRow>, transforms: Vec<Transform>) -> Vec<DataRow> {
    ChartBridge::chart_apply_transforms(data, transforms)
}

/// Compute a regression (trendline) from (x, y) points.
pub fn compute_regression(
    points: Vec<Point>,
    method: RegressionMethod,
    degree: Option<u32>,
    options: RegressionOptions,
) -> RegressionOutput {
    ChartBridge::chart_compute_regression(points, method, degree, options)
}

/// Compute kernel density estimation.
pub fn compute_density(
    values: Vec<f64>,
    bandwidth: Option<f64>,
    steps: Option<usize>,
) -> DensityResult {
    ChartBridge::chart_compute_density(values, bandwidth, steps)
}

/// Compute histogram bins.
pub fn compute_bins(
    values: Vec<f64>,
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<HistogramBin> {
    ChartBridge::chart_compute_bins(values, maxbins, step, nice)
}

/// Compute stacked values for a stacked chart.
pub fn compute_stacking(inputs: Vec<StackInput>, mode: Option<StackMode>) -> Vec<StackOutput> {
    ChartBridge::chart_compute_stacking(inputs, mode)
}

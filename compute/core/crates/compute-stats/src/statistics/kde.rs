use super::bandwidth::silverman_bandwidth;
use super::descriptive::{max_val, min_val};
use super::kernels::kernel_fn;
use super::types::{KdeOptions, KdeResult, KernelChoice};

/// Kernel Density Estimation.
///
/// Estimates the probability density function of a continuous random variable.
/// Useful for violin plots, density plots, and smoothed histograms.
#[must_use]
pub fn kde(values: &[f64], options: &KdeOptions) -> KdeResult {
    if values.is_empty() {
        return KdeResult {
            x: vec![],
            y: vec![],
        };
    }

    let bandwidth = options
        .bandwidth
        .unwrap_or_else(|| silverman_bandwidth(values));
    let num_points = options.points.unwrap_or(100);
    let kern = kernel_fn(options.kernel.unwrap_or(KernelChoice::Gaussian));

    let data_min = min_val(values);
    let data_max = max_val(values);
    let padding = 3.0 * bandwidth;

    let x_min = options.min_x.unwrap_or(data_min - padding);
    let x_max = options.max_x.unwrap_or(data_max + padding);

    // Generate x values
    let step = if num_points > 1 {
        (x_max - x_min) / (num_points - 1) as f64
    } else {
        0.0
    };

    let n = values.len() as f64;
    let x: Vec<f64> = (0..num_points).map(|i| x_min + i as f64 * step).collect();
    let y: Vec<f64> = x
        .iter()
        .map(|&xi| {
            let density: f64 = values.iter().map(|&val| kern((xi - val) / bandwidth)).sum();
            density / (n * bandwidth)
        })
        .collect();

    KdeResult { x, y }
}

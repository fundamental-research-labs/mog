//! Density transform — kernel density estimation for chart data.
//!
//! Ported from `charts/src/grammar/transforms/density.ts`.
//! Delegates heavy KDE math to `crate::statistics`.

use serde_json::Value;

use crate::statistics::{self, KdeOptions, KernelChoice, kde, mean, quantile};
use crate::types::{DataRow, DensityResult, Point, ViolinShape, ViolinStats};

// =============================================================================
// Density Transform
// =============================================================================

/// Apply a density transform to data rows.
///
/// Extracts numeric values from the specified `field`, runs KDE, and returns
/// new data rows with `[value_field, density_field]` columns.
pub fn apply_density(
    data: &[DataRow],
    field: &str,
    bandwidth: Option<f64>,
    extent: Option<(f64, f64)>,
    steps: Option<usize>,
    as_fields: Option<&(String, String)>,
) -> Vec<DataRow> {
    let default_as = ("value".to_string(), "density".to_string());
    let (x_name, d_name) = as_fields.unwrap_or(&default_as);

    // Extract numeric values from the field.
    let values: Vec<f64> = data
        .iter()
        .filter_map(|row| match row.get(field) {
            Some(Value::Number(n)) => n.as_f64(),
            _ => None,
        })
        .filter(|v| v.is_finite())
        .collect();

    if values.is_empty() {
        return Vec::new();
    }

    let nsteps = steps.unwrap_or(100);

    // Build KDE options.
    let opts = KdeOptions {
        bandwidth,
        points: Some(nsteps),
        kernel: Some(KernelChoice::Gaussian),
        min_x: extent.map(|(lo, _)| lo),
        max_x: extent.map(|(_, hi)| hi),
    };

    let result = kde(&values, &opts);

    // Convert to DataRow output.
    result
        .x
        .iter()
        .zip(result.y.iter())
        .map(|(&x, &d)| {
            let mut row = DataRow::new();
            row.insert(x_name.clone(), Value::from(x));
            row.insert(d_name.clone(), Value::from(d));
            row
        })
        .collect()
}

// =============================================================================
// KDE convenience wrapper returning DensityResult
// =============================================================================

/// Compute kernel density estimation, returning a `DensityResult`.
pub fn kernel_density_estimation(
    values: &[f64],
    bandwidth: Option<f64>,
    extent: Option<(f64, f64)>,
    steps: Option<usize>,
) -> DensityResult {
    let opts = KdeOptions {
        bandwidth,
        points: steps.or(Some(100)),
        kernel: Some(KernelChoice::Gaussian),
        min_x: extent.map(|(lo, _)| lo),
        max_x: extent.map(|(_, hi)| hi),
    };

    let result = kde(values, &opts);

    let max_density = result.y.iter().copied().fold(f64::NEG_INFINITY, f64::max);

    DensityResult {
        x: result.x,
        density: result.y,
        bandwidth: bandwidth.unwrap_or_else(|| statistics::silverman_bandwidth(values)),
        max_density: if max_density.is_finite() {
            max_density
        } else {
            0.0
        },
    }
}

// =============================================================================
// Violin Plot Support
// =============================================================================

/// Generate violin plot shape from data values.
///
/// Returns left/right contour points and summary statistics.
pub fn violin_shape(
    values: &[f64],
    bandwidth: Option<f64>,
    steps: Option<usize>,
    max_width: Option<f64>,
) -> ViolinShape {
    let max_w = max_width.unwrap_or(1.0);
    let nsteps = steps.unwrap_or(50);

    if values.is_empty() {
        return ViolinShape {
            left: Vec::new(),
            right: Vec::new(),
            stats: ViolinStats {
                min: 0.0,
                max: 0.0,
                median: 0.0,
                q1: 0.0,
                q3: 0.0,
                mean: 0.0,
            },
        };
    }

    let density = kernel_density_estimation(values, bandwidth, None, Some(nsteps));

    // Scale to max_width.
    let scale = if density.max_density > 0.0 {
        max_w / (2.0 * density.max_density)
    } else {
        0.0
    };

    let left: Vec<Point> = density
        .x
        .iter()
        .zip(density.density.iter())
        .map(|(&y, &d)| Point { x: -(d * scale), y })
        .collect();

    let right: Vec<Point> = density
        .x
        .iter()
        .zip(density.density.iter())
        .map(|(&y, &d)| Point { x: d * scale, y })
        .collect();

    // Compute summary statistics.
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let stats = ViolinStats {
        min: sorted[0],
        max: sorted[sorted.len() - 1],
        median: quantile(&sorted, 0.5),
        q1: quantile(&sorted, 0.25),
        q3: quantile(&sorted, 0.75),
        mean: mean(values),
    };

    ViolinShape { left, right, stats }
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Compute density at a single point.
pub fn density_at(values: &[f64], x: f64, bandwidth: Option<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let h = bandwidth.unwrap_or_else(|| statistics::silverman_bandwidth(values));
    let n = values.len() as f64;
    let mut sum = 0.0;
    for &v in values {
        let u = (x - v) / h;
        sum += statistics::gaussian_kernel(u);
    }
    sum / (n * h)
}

/// Find the mode (peak of density).
pub fn find_mode(values: &[f64], bandwidth: Option<f64>, steps: Option<usize>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    if values.len() == 1 {
        return values[0];
    }

    let density = kernel_density_estimation(values, bandwidth, None, steps);

    let (max_idx, _) =
        density
            .density
            .iter()
            .enumerate()
            .fold((0, f64::NEG_INFINITY), |(mi, mv), (i, &v)| {
                if v > mv { (i, v) } else { (mi, mv) }
            });

    density.x[max_idx]
}

/// Check if distribution is multimodal.
pub fn is_multimodal(
    values: &[f64],
    bandwidth: Option<f64>,
    steps: Option<usize>,
    threshold: Option<f64>,
) -> bool {
    let thresh = threshold.unwrap_or(0.1);

    let density = kernel_density_estimation(values, bandwidth, None, steps);
    let max_density = density.max_density;
    let min_peak_height = max_density * thresh;

    let mut peaks = 0usize;
    let n = density.density.len();
    for i in 1..n.saturating_sub(1) {
        let prev = density.density[i - 1];
        let curr = density.density[i];
        let next = density.density[i + 1];

        if curr > prev && curr > next && curr > min_peak_height {
            peaks += 1;
        }
    }

    peaks > 1
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_row(field: &str, val: f64) -> DataRow {
        let mut row = DataRow::new();
        row.insert(field.to_string(), json!(val));
        row
    }

    #[test]
    fn apply_density_empty_data() {
        let result = apply_density(&[], "x", None, None, None, None);
        assert!(result.is_empty());
    }

    #[test]
    fn apply_density_no_numeric_values() {
        let mut row = DataRow::new();
        row.insert("x".to_string(), json!("hello"));
        let result = apply_density(&[row], "x", None, None, None, None);
        assert!(result.is_empty());
    }

    #[test]
    fn apply_density_basic() {
        let data: Vec<DataRow> = (0..50).map(|i| make_row("val", i as f64)).collect();

        let result = apply_density(&data, "val", None, None, Some(20), None);
        assert_eq!(result.len(), 20);

        // Default output fields.
        assert!(result[0].contains_key("value"));
        assert!(result[0].contains_key("density"));
    }

    #[test]
    fn apply_density_custom_as_fields() {
        let data: Vec<DataRow> = (0..20).map(|i| make_row("v", i as f64)).collect();
        let as_fields = ("x".to_string(), "d".to_string());

        let result = apply_density(&data, "v", None, None, Some(10), Some(&as_fields));
        assert!(result[0].contains_key("x"));
        assert!(result[0].contains_key("d"));
    }

    #[test]
    fn apply_density_with_extent() {
        let data: Vec<DataRow> = vec![make_row("v", 5.0), make_row("v", 10.0), make_row("v", 15.0)];
        let result = apply_density(&data, "v", None, Some((0.0, 20.0)), Some(5), None);
        assert_eq!(result.len(), 5);

        // First point should be near 0.
        let first_x = result[0].get("value").and_then(|v| v.as_f64()).unwrap();
        assert!((first_x - 0.0).abs() < 0.01);

        // Last point should be near 20.
        let last_x = result[4].get("value").and_then(|v| v.as_f64()).unwrap();
        assert!((last_x - 20.0).abs() < 0.01);
    }

    #[test]
    fn kernel_density_estimation_basic() {
        let values = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = kernel_density_estimation(&values, None, None, Some(10));
        assert_eq!(result.x.len(), 10);
        assert_eq!(result.density.len(), 10);
        assert!(result.max_density > 0.0);
        assert!(result.bandwidth > 0.0);
    }

    #[test]
    fn violin_shape_empty() {
        let shape = violin_shape(&[], None, None, None);
        assert!(shape.left.is_empty());
        assert!(shape.right.is_empty());
    }

    #[test]
    fn violin_shape_basic() {
        let values: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let shape = violin_shape(&values, None, Some(20), Some(2.0));

        assert_eq!(shape.left.len(), 20);
        assert_eq!(shape.right.len(), 20);

        // Left contour should have negative x, right positive.
        for pt in &shape.left {
            assert!(pt.x <= 0.0);
        }
        for pt in &shape.right {
            assert!(pt.x >= 0.0);
        }

        // Stats should be reasonable.
        assert!(shape.stats.min < shape.stats.max);
        assert!(shape.stats.q1 < shape.stats.q3);
    }

    #[test]
    fn density_at_basic() {
        let values = vec![0.0, 1.0, 2.0, 3.0, 4.0];
        let d = density_at(&values, 2.0, Some(1.0));
        assert!(d > 0.0);
    }

    #[test]
    fn density_at_empty() {
        assert_eq!(density_at(&[], 0.0, None), 0.0);
    }

    #[test]
    fn find_mode_empty() {
        assert_eq!(find_mode(&[], None, None), 0.0);
    }

    #[test]
    fn find_mode_single() {
        assert_eq!(find_mode(&[42.0], None, None), 42.0);
    }

    #[test]
    fn find_mode_peak() {
        // Clustered around 5.
        let values: Vec<f64> = (0..50).map(|_| 5.0).chain((0..10).map(|_| 20.0)).collect();
        let mode = find_mode(&values, Some(1.0), Some(200));
        assert!((mode - 5.0).abs() < 2.0);
    }

    #[test]
    fn is_multimodal_unimodal() {
        // Tight cluster = unimodal.
        let values: Vec<f64> = (0..100).map(|i| 50.0 + (i as f64) * 0.1).collect();
        assert!(!is_multimodal(&values, Some(1.0), Some(200), None));
    }

    #[test]
    fn is_multimodal_bimodal() {
        // Two well-separated clusters.
        let mut values: Vec<f64> = (0..100).map(|i| (i as f64) * 0.1).collect();
        values.extend((0..100).map(|i| 50.0 + (i as f64) * 0.1));
        assert!(is_multimodal(&values, Some(1.0), Some(200), None));
    }
}

//! Bin transform -- creates histogram bins for quantitative chart data.
//!
//! Ported from `charts/src/grammar/transforms/bin.ts`.
//! Provides bin assignment for data rows, histogram counting,
//! cumulative and normalized histograms, and nice-step utilities.

use serde_json::Value;

use crate::types::{BinSpec, DataRow, HistogramBin};

// =============================================================================
// Bin Parameters
// =============================================================================

/// Computed bin parameters describing the bin grid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BinParams {
    /// Start of the first bin (inclusive).
    pub start: f64,
    /// End of the last bin.
    pub stop: f64,
    /// Width of each bin.
    pub step: f64,
    /// Number of bins.
    pub count: usize,
}

// =============================================================================
// Nice Step
// =============================================================================

/// Round a step size to a "nice" number (1, 2, 5, or 10 times a power of 10).
///
/// This produces human-friendly axis tick intervals and bin widths.
///
/// Algorithm:
/// ```text
/// exp = floor(log10(step))
/// pow10 = 10^exp
/// fraction = step / pow10
/// if fraction <= 1 -> 1
/// else if <= 2 -> 2
/// else if <= 5 -> 5
/// else -> 10
/// result = niceFraction * pow10
/// ```
pub fn nice_step(step: f64) -> f64 {
    if step <= 0.0 || !step.is_finite() {
        return 1.0;
    }

    let exp = step.log10().floor();
    let pow10 = 10.0_f64.powf(exp);
    let fraction = step / pow10;

    let nice_fraction = if fraction <= 1.0 {
        1.0
    } else if fraction <= 2.0 {
        2.0
    } else if fraction <= 5.0 {
        5.0
    } else {
        10.0
    };

    nice_fraction * pow10
}

// =============================================================================
// Calculate Bins
// =============================================================================

/// Calculate bin parameters from a set of numeric values.
///
/// Handles edge cases:
/// - Empty values: returns a single bin `[0, 1)` with step 1.
/// - Single value (all same): returns a bin centered on the value (val-0.5 .. val+0.5).
///
/// If `explicit_step` is provided it overrides the `maxbins` heuristic.
/// When `nice` is true (default), boundaries snap to multiples of the step.
pub fn calculate_bins(
    values: &[f64],
    maxbins: Option<usize>,
    explicit_step: Option<f64>,
    nice: Option<bool>,
) -> BinParams {
    let nice = nice.unwrap_or(true);
    let maxbins = maxbins.unwrap_or(10).max(1);

    if values.is_empty() {
        return BinParams {
            start: 0.0,
            stop: 1.0,
            step: 1.0,
            count: 1,
        };
    }

    let mut min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let mut max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);

    // Single value edge case.
    if (min - max).abs() < f64::EPSILON {
        return BinParams {
            start: min - 0.5,
            stop: max + 0.5,
            step: 1.0,
            count: 1,
        };
    }

    let step = match explicit_step {
        Some(s) if s > 0.0 && s.is_finite() => s,
        _ => {
            let range = max - min;
            nice_step(range / maxbins as f64)
        }
    };

    if nice {
        min = (min / step).floor() * step;
        max = (max / step).ceil() * step;
    }

    let count = ((max - min) / step).ceil() as usize;
    let count = count.max(1);

    BinParams {
        start: min,
        stop: min + count as f64 * step,
        step,
        count,
    }
}

// =============================================================================
// Find Bin Index
// =============================================================================

/// Find the bin index for a value within the given bin params.
///
/// The result is clamped to `[0, bins.count - 1]` to handle edge cases
/// (e.g., value exactly at the upper boundary).
pub fn find_bin_index(value: f64, bins: &BinParams) -> usize {
    if bins.count == 0 {
        return 0;
    }
    let idx = ((value - bins.start) / bins.step).floor() as isize;
    idx.max(0).min((bins.count as isize) - 1) as usize
}

// =============================================================================
// Apply Bin Transform (DataRow pipeline -- individual params)
// =============================================================================

/// Apply a bin transform to data rows.
///
/// For each row:
/// - If the field is numeric: assigns `as_field` = bin start, `{as_field}_end` = bin end.
/// - If the field is missing or non-numeric: assigns `null` for both bin fields.
///
/// All original fields are preserved.
pub fn apply_bin(
    data: &[DataRow],
    field: &str,
    as_field: &str,
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<DataRow> {
    // Extract numeric values for bin parameter calculation.
    let values: Vec<f64> = data
        .iter()
        .filter_map(|row| match row.get(field) {
            Some(Value::Number(n)) => n.as_f64().filter(|v| v.is_finite()),
            _ => None,
        })
        .collect();

    let end_field = format!("{as_field}_end");

    if values.is_empty() {
        // No numeric values -- add null bin fields to every row.
        return data
            .iter()
            .map(|row| {
                let mut out = row.clone();
                out.insert(as_field.to_string(), Value::Null);
                out.insert(end_field.clone(), Value::Null);
                out
            })
            .collect();
    }

    let bins = calculate_bins(&values, maxbins, step, nice);

    data.iter()
        .map(|row| {
            let mut out = row.clone();

            match row
                .get(field)
                .and_then(|v| v.as_f64())
                .filter(|v| v.is_finite())
            {
                Some(val) => {
                    let idx = find_bin_index(val, &bins);
                    let bin_start = bins.start + (idx as f64) * bins.step;
                    let bin_end = bin_start + bins.step;
                    out.insert(as_field.to_string(), Value::from(bin_start));
                    out.insert(end_field.clone(), Value::from(bin_end));
                }
                None => {
                    out.insert(as_field.to_string(), Value::Null);
                    out.insert(end_field.clone(), Value::Null);
                }
            }

            out
        })
        .collect()
}

// =============================================================================
// Apply Bin Transform (BinSpec variant)
// =============================================================================

/// Apply a bin transform to data rows from a `BinSpec`.
///
/// Convenience wrapper around [`apply_bin`] that unpacks the spec fields.
pub fn apply_bin_spec(data: &[DataRow], spec: &BinSpec) -> Vec<DataRow> {
    apply_bin(
        data,
        &spec.field,
        &spec.as_field,
        spec.maxbins,
        spec.step,
        spec.nice,
    )
}

// =============================================================================
// Histogram
// =============================================================================

/// Create histogram bin counts from raw numeric values.
///
/// Non-finite values (NaN, Infinity) are silently filtered out.
/// Returns one `HistogramBin` per bin with the count of values falling
/// into `[bin0, bin1)` (last bin is inclusive on both ends).
pub fn histogram(
    values: &[f64],
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<HistogramBin> {
    let clean: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();

    if clean.is_empty() {
        return Vec::new();
    }

    let bins = calculate_bins(&clean, maxbins, step, nice);
    let mut counts = vec![0usize; bins.count];

    for &value in &clean {
        let idx = find_bin_index(value, &bins);
        counts[idx] += 1;
    }

    counts
        .iter()
        .enumerate()
        .map(|(i, &count)| HistogramBin {
            bin0: bins.start + (i as f64) * bins.step,
            bin1: bins.start + ((i + 1) as f64) * bins.step,
            count,
        })
        .collect()
}

/// Create histogram bin counts from data rows, extracting values from a named field.
pub fn histogram_from_data(
    data: &[DataRow],
    field: &str,
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<HistogramBin> {
    let values: Vec<f64> = data
        .iter()
        .filter_map(|row| match row.get(field) {
            Some(Value::Number(n)) => n.as_f64(),
            _ => None,
        })
        .collect();

    histogram(&values, maxbins, step, nice)
}

// =============================================================================
// Cumulative Histogram
// =============================================================================

/// A histogram bin extended with a cumulative count.
#[derive(Debug, Clone)]
pub struct CumulativeBin {
    /// Bin start (inclusive).
    pub bin0: f64,
    /// Bin end (exclusive, except last bin).
    pub bin1: f64,
    /// Count of values in this bin.
    pub count: usize,
    /// Cumulative count up to and including this bin.
    pub cumulative: usize,
}

/// Create a cumulative histogram from numeric values.
///
/// Each entry's `cumulative` field is the running total of counts
/// up to and including that bin.
pub fn cumulative_histogram(
    values: &[f64],
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<CumulativeBin> {
    let hist = histogram(values, maxbins, step, nice);
    let mut cumulative = 0usize;

    hist.into_iter()
        .map(|bin| {
            cumulative += bin.count;
            CumulativeBin {
                bin0: bin.bin0,
                bin1: bin.bin1,
                count: bin.count,
                cumulative,
            }
        })
        .collect()
}

// =============================================================================
// Normalized Histogram
// =============================================================================

/// A histogram bin extended with a density value.
#[derive(Debug, Clone)]
pub struct NormalizedBin {
    /// Bin start (inclusive).
    pub bin0: f64,
    /// Bin end (exclusive, except last bin).
    pub bin1: f64,
    /// Count of values in this bin.
    pub count: usize,
    /// Probability density: `count / (total * bin_width)`.
    pub density: f64,
}

/// Create a normalized histogram (probability density) from numeric values.
///
/// Each bin's `density = count / (total * bin_width)`, so that the histogram
/// integrates to approximately 1.0.
pub fn normalized_histogram(
    values: &[f64],
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<NormalizedBin> {
    let hist = histogram(values, maxbins, step, nice);
    let total: usize = hist.iter().map(|b| b.count).sum();

    if total == 0 {
        return hist
            .into_iter()
            .map(|bin| NormalizedBin {
                bin0: bin.bin0,
                bin1: bin.bin1,
                count: bin.count,
                density: 0.0,
            })
            .collect();
    }

    let bin_width = if !hist.is_empty() {
        hist[0].bin1 - hist[0].bin0
    } else {
        1.0
    };

    hist.into_iter()
        .map(|bin| {
            let density = bin.count as f64 / (total as f64 * bin_width);
            NormalizedBin {
                bin0: bin.bin0,
                bin1: bin.bin1,
                count: bin.count,
                density,
            }
        })
        .collect()
}

// =============================================================================
// Bin Boundaries
// =============================================================================

/// Get the bin boundary values for a given range.
///
/// Returns `count + 1` values representing the edges of each bin.
pub fn get_bin_boundaries(
    min: f64,
    max: f64,
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<f64> {
    let bins = calculate_bins(&[min, max], maxbins, step, nice);
    (0..=bins.count)
        .map(|i| bins.start + (i as f64) * bins.step)
        .collect()
}

// =============================================================================
// Per-Series Bin Config Resolution
// =============================================================================

use crate::types::PerSeriesBinConfig;

/// Resolve bin parameters by checking per-series config before chart-level defaults.
///
/// Returns `(maxbins, step, cumulative)` with per-series values taking precedence.
pub fn resolve_bin_params(
    series_config: Option<&PerSeriesBinConfig>,
    chart_maxbins: Option<usize>,
    chart_step: Option<f64>,
    chart_cumulative: Option<bool>,
) -> (Option<usize>, Option<f64>, bool) {
    let maxbins = series_config.and_then(|c| c.bin_count).or(chart_maxbins);
    let step = series_config.and_then(|c| c.bin_width).or(chart_step);
    let cumulative = series_config
        .and_then(|c| c.cumulative)
        .or(chart_cumulative)
        .unwrap_or(false);
    (maxbins, step, cumulative)
}

/// Create histogram bins using per-series config with chart-level fallbacks.
///
/// This is the preferred entry point for histogram computation when per-series
/// overrides are available. It resolves config, then delegates to `histogram()`
/// or `cumulative_histogram()` based on the resolved cumulative flag.
pub fn histogram_with_series_config(
    values: &[f64],
    series_config: Option<&PerSeriesBinConfig>,
    chart_maxbins: Option<usize>,
    chart_step: Option<f64>,
    chart_cumulative: Option<bool>,
    nice: Option<bool>,
) -> Vec<HistogramBin> {
    let (maxbins, step, _cumulative) =
        resolve_bin_params(series_config, chart_maxbins, chart_step, chart_cumulative);
    histogram(values, maxbins, step, nice)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // =========================================================================
    // Helpers
    // =========================================================================

    fn make_row(field: &str, val: f64) -> DataRow {
        let mut row = DataRow::new();
        row.insert(field.to_string(), json!(val));
        row
    }

    macro_rules! assert_approx {
        ($a:expr, $b:expr) => {
            assert_approx!($a, $b, 1e-10)
        };
        ($a:expr, $b:expr, $eps:expr) => {
            assert!(
                ($a - $b).abs() < $eps,
                "assert_approx failed: left = {:?}, right = {:?} (eps = {:?})",
                $a,
                $b,
                $eps
            );
        };
    }

    // =========================================================================
    // nice_step
    // =========================================================================

    #[test]
    fn nice_step_exact_powers_of_10() {
        assert_approx!(nice_step(1.0), 1.0);
        assert_approx!(nice_step(10.0), 10.0);
        assert_approx!(nice_step(100.0), 100.0);
        assert_approx!(nice_step(0.1), 0.1);
        assert_approx!(nice_step(0.01), 0.01);
    }

    #[test]
    fn nice_step_rounds_to_2() {
        assert_approx!(nice_step(1.5), 2.0);
        assert_approx!(nice_step(15.0), 20.0);
        assert_approx!(nice_step(0.15), 0.2);
        assert_approx!(nice_step(0.015), 0.02);
    }

    #[test]
    fn nice_step_rounds_to_5() {
        assert_approx!(nice_step(3.0), 5.0);
        assert_approx!(nice_step(4.0), 5.0);
        assert_approx!(nice_step(30.0), 50.0);
        assert_approx!(nice_step(0.3), 0.5);
    }

    #[test]
    fn nice_step_rounds_to_10() {
        assert_approx!(nice_step(7.0), 10.0);
        assert_approx!(nice_step(8.0), 10.0);
        assert_approx!(nice_step(70.0), 100.0);
        assert_approx!(nice_step(0.7), 1.0);
    }

    #[test]
    fn nice_step_zero_and_negative() {
        assert_approx!(nice_step(0.0), 1.0);
        assert_approx!(nice_step(-5.0), 1.0);
        assert_approx!(nice_step(-0.1), 1.0);
    }

    #[test]
    fn nice_step_non_finite() {
        assert_approx!(nice_step(f64::INFINITY), 1.0);
        assert_approx!(nice_step(f64::NEG_INFINITY), 1.0);
        assert_approx!(nice_step(f64::NAN), 1.0);
    }

    // =========================================================================
    // calculate_bins
    // =========================================================================

    #[test]
    fn calculate_bins_empty() {
        let bins = calculate_bins(&[], None, None, None);
        assert_eq!(bins.count, 1);
        assert_approx!(bins.start, 0.0);
        assert_approx!(bins.stop, 1.0);
        assert_approx!(bins.step, 1.0);
    }

    #[test]
    fn calculate_bins_single_value() {
        let bins = calculate_bins(&[5.0], None, None, None);
        assert_eq!(bins.count, 1);
        assert_approx!(bins.start, 4.5);
        assert_approx!(bins.stop, 5.5);
        assert_approx!(bins.step, 1.0);
    }

    #[test]
    fn calculate_bins_all_same_values() {
        let bins = calculate_bins(&[42.0, 42.0, 42.0, 42.0], None, None, None);
        assert_eq!(bins.count, 1);
        assert_approx!(bins.start, 41.5);
        assert_approx!(bins.stop, 42.5);
        assert_approx!(bins.step, 1.0);
    }

    #[test]
    fn calculate_bins_uniform_range() {
        let values: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let bins = calculate_bins(&values, Some(10), None, Some(true));
        assert!(bins.count >= 1);
        assert!(bins.step > 0.0);
        assert!(bins.start <= 0.0);
        assert!(bins.stop >= 99.0);
    }

    #[test]
    fn calculate_bins_nice_boundaries() {
        let values = vec![3.0, 7.0, 12.0, 18.0, 25.0];
        let bins = calculate_bins(&values, Some(5), None, Some(true));
        // With nice=true, start should be a multiple of step.
        let remainder = (bins.start / bins.step).fract().abs();
        assert!(
            remainder < 1e-10 || (1.0 - remainder).abs() < 1e-10,
            "Start {} is not a nice multiple of step {}",
            bins.start,
            bins.step
        );
    }

    #[test]
    fn calculate_bins_no_nice() {
        let values = vec![3.0, 7.0];
        let bins = calculate_bins(&values, Some(10), None, Some(false));
        // Without nice, start/stop should be the raw min/max.
        assert_approx!(bins.start, 3.0);
    }

    #[test]
    fn calculate_bins_explicit_step() {
        let values = vec![0.0, 100.0];
        let bins = calculate_bins(&values, None, Some(25.0), Some(true));
        assert_approx!(bins.step, 25.0);
        assert_eq!(bins.count, 4);
        assert_approx!(bins.start, 0.0);
        assert_approx!(bins.stop, 100.0);
    }

    #[test]
    fn calculate_bins_stop_equals_start_plus_count_times_step() {
        let values = vec![1.0, 2.0, 5.0, 8.0, 9.0];
        let bins = calculate_bins(&values, Some(5), None, Some(true));
        assert_approx!(bins.stop, bins.start + bins.count as f64 * bins.step);
    }

    #[test]
    fn calculate_bins_two_values() {
        let bins = calculate_bins(&[0.0, 100.0], Some(10), None, Some(true));
        assert!(bins.count >= 1);
        assert!(bins.start <= 0.0);
        assert!(bins.stop >= 100.0);
    }

    // =========================================================================
    // find_bin_index
    // =========================================================================

    #[test]
    fn find_bin_index_basic() {
        let bins = BinParams {
            start: 0.0,
            stop: 10.0,
            step: 2.0,
            count: 5,
        };
        assert_eq!(find_bin_index(0.0, &bins), 0);
        assert_eq!(find_bin_index(1.0, &bins), 0);
        assert_eq!(find_bin_index(2.0, &bins), 1);
        assert_eq!(find_bin_index(4.5, &bins), 2);
        assert_eq!(find_bin_index(9.9, &bins), 4);
    }

    #[test]
    fn find_bin_index_clamps_upper() {
        let bins = BinParams {
            start: 0.0,
            stop: 10.0,
            step: 2.0,
            count: 5,
        };
        // Value at the exact stop boundary should clamp to last bin.
        assert_eq!(find_bin_index(10.0, &bins), 4);
        // Value beyond stop.
        assert_eq!(find_bin_index(15.0, &bins), 4);
    }

    #[test]
    fn find_bin_index_clamps_lower() {
        let bins = BinParams {
            start: 0.0,
            stop: 10.0,
            step: 2.0,
            count: 5,
        };
        assert_eq!(find_bin_index(-1.0, &bins), 0);
        assert_eq!(find_bin_index(-100.0, &bins), 0);
    }

    #[test]
    fn find_bin_index_single_bin() {
        let bins = BinParams {
            start: 4.5,
            stop: 5.5,
            step: 1.0,
            count: 1,
        };
        assert_eq!(find_bin_index(5.0, &bins), 0);
        assert_eq!(find_bin_index(4.5, &bins), 0);
        assert_eq!(find_bin_index(5.5, &bins), 0);
    }

    // =========================================================================
    // apply_bin (individual params)
    // =========================================================================

    #[test]
    fn apply_bin_empty() {
        let result = apply_bin(&[], "x", "bin_x", None, None, None);
        assert!(result.is_empty());
    }

    #[test]
    fn apply_bin_no_numeric_values() {
        let mut row = DataRow::new();
        row.insert("x".to_string(), json!("text"));
        let result = apply_bin(&[row], "x", "bin_x", None, None, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("bin_x"), Some(&Value::Null));
        assert_eq!(result[0].get("bin_x_end"), Some(&Value::Null));
    }

    #[test]
    fn apply_bin_basic() {
        let data: Vec<DataRow> = vec![
            make_row("v", 1.5),
            make_row("v", 3.7),
            make_row("v", 7.2),
            make_row("v", 9.9),
        ];

        let result = apply_bin(&data, "v", "bin_v", Some(5), None, Some(true));
        assert_eq!(result.len(), 4);

        // Each row should have bin_v and bin_v_end.
        for row in &result {
            assert!(row.contains_key("bin_v"));
            assert!(row.contains_key("bin_v_end"));
            let start = row.get("bin_v").and_then(|v| v.as_f64()).unwrap();
            let end = row.get("bin_v_end").and_then(|v| v.as_f64()).unwrap();
            assert!(end > start, "bin_end ({}) should be > bin ({})", end, start);
        }
    }

    #[test]
    fn apply_bin_preserves_original_data() {
        let mut row = DataRow::new();
        row.insert("v".to_string(), json!(5.0));
        row.insert("name".to_string(), json!("test"));

        let result = apply_bin(&[row], "v", "bin_v", None, None, None);
        assert_eq!(result[0].get("name"), Some(&json!("test")));
        assert_eq!(result[0].get("v"), Some(&json!(5.0)));
    }

    #[test]
    fn apply_bin_single_value() {
        let data = vec![make_row("v", 5.0)];
        let result = apply_bin(&data, "v", "bin_v", None, None, None);
        assert_eq!(result.len(), 1);
        let start = result[0].get("bin_v").and_then(|v| v.as_f64()).unwrap();
        let end = result[0].get("bin_v_end").and_then(|v| v.as_f64()).unwrap();
        assert!(start <= 5.0);
        assert!(end >= 5.0);
    }

    #[test]
    fn apply_bin_explicit_step() {
        let data: Vec<DataRow> = (0..10).map(|i| make_row("v", i as f64)).collect();
        let result = apply_bin(&data, "v", "bin_v", None, Some(2.0), Some(true));

        for row in &result {
            let start = row.get("bin_v").and_then(|v| v.as_f64()).unwrap();
            let end = row.get("bin_v_end").and_then(|v| v.as_f64()).unwrap();
            assert_approx!(end - start, 2.0);
        }
    }

    #[test]
    fn apply_bin_mixed_types() {
        let mut data = vec![make_row("v", 1.0), make_row("v", 5.0)];
        let mut text_row = DataRow::new();
        text_row.insert("v".to_string(), json!("not a number"));
        data.push(text_row);

        let result = apply_bin(&data, "v", "bin_v", None, None, None);
        assert_eq!(result.len(), 3);
        // Numeric rows should have bin values.
        assert!(result[0].get("bin_v").unwrap().is_number());
        assert!(result[1].get("bin_v").unwrap().is_number());
        // Text row should have null bins.
        assert_eq!(result[2].get("bin_v"), Some(&Value::Null));
        assert_eq!(result[2].get("bin_v_end"), Some(&Value::Null));
    }

    #[test]
    fn apply_bin_null_values() {
        let mut data = vec![make_row("v", 3.0)];
        let mut null_row = DataRow::new();
        null_row.insert("v".to_string(), Value::Null);
        data.push(null_row);

        let result = apply_bin(&data, "v", "bin_v", None, None, None);
        assert_eq!(result.len(), 2);
        assert!(result[0].get("bin_v").unwrap().is_number());
        assert_eq!(result[1].get("bin_v"), Some(&Value::Null));
    }

    // =========================================================================
    // apply_bin_spec
    // =========================================================================

    #[test]
    fn apply_bin_spec_basic() {
        let data: Vec<DataRow> = (0..20).map(|i| make_row("x", i as f64)).collect();
        let spec = BinSpec {
            field: "x".to_string(),
            as_field: "bin_x".to_string(),
            maxbins: Some(5),
            step: None,
            nice: Some(true),
        };

        let result = apply_bin_spec(&data, &spec);
        assert_eq!(result.len(), 20);

        for row in &result {
            assert!(row.contains_key("bin_x"));
            assert!(row.contains_key("bin_x_end"));
            let b0 = row.get("bin_x").and_then(|v| v.as_f64()).unwrap();
            let b1 = row.get("bin_x_end").and_then(|v| v.as_f64()).unwrap();
            assert!(b1 > b0);
        }
    }

    #[test]
    fn apply_bin_spec_with_step() {
        let data: Vec<DataRow> = vec![make_row("x", 0.0), make_row("x", 5.0), make_row("x", 10.0)];
        let spec = BinSpec {
            field: "x".to_string(),
            as_field: "bin".to_string(),
            maxbins: None,
            step: Some(5.0),
            nice: Some(true),
        };

        let result = apply_bin_spec(&data, &spec);
        for row in &result {
            let b0 = row.get("bin").and_then(|v| v.as_f64()).unwrap();
            let b1 = row.get("bin_end").and_then(|v| v.as_f64()).unwrap();
            assert_approx!(b1 - b0, 5.0);
        }
    }

    // =========================================================================
    // histogram
    // =========================================================================

    #[test]
    fn histogram_empty() {
        let result = histogram(&[], None, None, None);
        assert!(result.is_empty());
    }

    #[test]
    fn histogram_single_value() {
        let result = histogram(&[5.0, 5.0, 5.0], None, None, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].count, 3);
    }

    #[test]
    fn histogram_basic_count_matches() {
        let values: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let result = histogram(&values, Some(10), None, Some(true));

        assert!(!result.is_empty());
        let total: usize = result.iter().map(|b| b.count).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn histogram_bins_are_contiguous() {
        let values: Vec<f64> = (0..50).map(|i| i as f64).collect();
        let result = histogram(&values, Some(5), None, Some(true));

        for i in 1..result.len() {
            assert_approx!(result[i].bin0, result[i - 1].bin1);
        }
    }

    #[test]
    fn histogram_filters_nan_and_inf() {
        let values = vec![1.0, f64::NAN, 2.0, f64::INFINITY, 3.0, f64::NEG_INFINITY];
        let result = histogram(&values, None, None, None);
        let total: usize = result.iter().map(|b| b.count).sum();
        assert_eq!(total, 3);
    }

    #[test]
    fn histogram_explicit_step() {
        let values: Vec<f64> = (0..20).map(|i| i as f64).collect();
        let result = histogram(&values, None, Some(5.0), Some(true));

        for bin in &result {
            assert_approx!(bin.bin1 - bin.bin0, 5.0);
        }
    }

    #[test]
    fn histogram_all_same_value() {
        let values = vec![7.0; 50];
        let result = histogram(&values, None, None, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].count, 50);
    }

    #[test]
    fn histogram_negative_values() {
        let values = vec![-10.0, -5.0, 0.0, 5.0, 10.0];
        let result = histogram(&values, Some(5), None, Some(true));
        let total: usize = result.iter().map(|b| b.count).sum();
        assert_eq!(total, 5);
    }

    // =========================================================================
    // histogram_from_data
    // =========================================================================

    #[test]
    fn histogram_from_data_basic() {
        let data: Vec<DataRow> = (0..20).map(|i| make_row("val", i as f64)).collect();
        let result = histogram_from_data(&data, "val", Some(5), None, None);
        let total: usize = result.iter().map(|b| b.count).sum();
        assert_eq!(total, 20);
    }

    #[test]
    fn histogram_from_data_missing_field() {
        let data = vec![make_row("other", 5.0)];
        let result = histogram_from_data(&data, "val", None, None, None);
        assert!(result.is_empty());
    }

    // =========================================================================
    // cumulative_histogram
    // =========================================================================

    #[test]
    fn cumulative_histogram_empty() {
        let result = cumulative_histogram(&[], None, None, None);
        assert!(result.is_empty());
    }

    #[test]
    fn cumulative_histogram_basic() {
        let values: Vec<f64> = (0..20).map(|i| i as f64).collect();
        let result = cumulative_histogram(&values, Some(5), None, Some(true));

        assert!(!result.is_empty());

        // Cumulative should be monotonically increasing.
        for i in 1..result.len() {
            assert!(result[i].cumulative >= result[i - 1].cumulative);
        }

        // Last cumulative should equal total count.
        let last = result.last().unwrap();
        assert_eq!(last.cumulative, 20);
    }

    #[test]
    fn cumulative_histogram_first_bin() {
        let values: Vec<f64> = (0..10).map(|i| i as f64).collect();
        let result = cumulative_histogram(&values, Some(5), None, Some(true));
        // First cumulative should equal first bin count.
        assert_eq!(result[0].cumulative, result[0].count);
    }

    // =========================================================================
    // normalized_histogram
    // =========================================================================

    #[test]
    fn normalized_histogram_empty() {
        let result = normalized_histogram(&[], None, None, None);
        assert!(result.is_empty());
    }

    #[test]
    fn normalized_histogram_integrates_to_one() {
        let values: Vec<f64> = (0..1000).map(|i| (i as f64) * 0.1).collect();
        let result = normalized_histogram(&values, Some(10), None, Some(true));

        // All densities should be non-negative.
        for bin in &result {
            assert!(bin.density >= 0.0);
        }

        // Sum of density * bin_width should be approximately 1.
        let integral: f64 = result.iter().map(|b| b.density * (b.bin1 - b.bin0)).sum();
        assert!(
            (integral - 1.0).abs() < 0.01,
            "Normalized histogram integral = {}, expected ~1.0",
            integral
        );
    }

    #[test]
    fn normalized_histogram_single_value() {
        let values = vec![5.0; 10];
        let result = normalized_histogram(&values, None, None, None);
        assert_eq!(result.len(), 1);
        // density * width should be 1.0
        let integral = result[0].density * (result[0].bin1 - result[0].bin0);
        assert_approx!(integral, 1.0, 1e-6);
    }

    // =========================================================================
    // get_bin_boundaries
    // =========================================================================

    #[test]
    fn get_bin_boundaries_basic() {
        let bounds = get_bin_boundaries(0.0, 10.0, Some(5), None, Some(true));
        assert!(bounds.len() >= 2);
        assert!(bounds[0] <= 0.0);
        assert!(*bounds.last().unwrap() >= 10.0);

        // Boundaries should be monotonically increasing.
        for i in 1..bounds.len() {
            assert!(bounds[i] > bounds[i - 1]);
        }
    }

    #[test]
    fn get_bin_boundaries_count_is_n_plus_1() {
        let bounds = get_bin_boundaries(0.0, 10.0, None, Some(2.0), Some(true));
        // With step=2, range 0..10: 5 bins -> 6 boundaries.
        assert_eq!(bounds.len(), 6);
        assert_approx!(bounds[0], 0.0);
        assert_approx!(bounds[5], 10.0);
    }

    #[test]
    fn get_bin_boundaries_negative_range() {
        let bounds = get_bin_boundaries(-10.0, 10.0, Some(4), None, Some(true));
        assert!(!bounds.is_empty());
        assert!(bounds[0] <= -10.0);
        assert!(*bounds.last().unwrap() >= 10.0);
    }

    // =========================================================================
    // Edge cases
    // =========================================================================

    #[test]
    fn bin_very_small_range() {
        let values = vec![1.0001, 1.0002, 1.0003, 1.0004];
        let result = histogram(&values, Some(4), None, Some(true));
        let total: usize = result.iter().map(|b| b.count).sum();
        assert_eq!(total, 4);
    }

    #[test]
    fn bin_large_dataset() {
        let values: Vec<f64> = (0..10000).map(|i| (i as f64) / 100.0).collect();
        let result = histogram(&values, Some(20), None, Some(true));
        let total: usize = result.iter().map(|b| b.count).sum();
        assert_eq!(total, 10000);
    }

    #[test]
    fn bin_two_values_wide_apart() {
        let values = vec![0.0, 1_000_000.0];
        let bins = calculate_bins(&values, Some(10), None, Some(true));
        assert!(bins.count >= 1);
        assert!(bins.start <= 0.0);
        assert!(bins.stop >= 1_000_000.0);
    }
}

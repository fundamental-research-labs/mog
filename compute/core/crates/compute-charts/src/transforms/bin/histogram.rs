use serde_json::Value;

use crate::types::{DataRow, HistogramBin};

use super::grid::{calculate_bins, find_bin_index};

/// Create histogram bin counts from raw numeric values.
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

use crate::types::{HistogramBin, PerSeriesBinConfig};

use super::histogram::histogram;

/// Resolve bin parameters by checking per-series config before chart-level defaults.
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

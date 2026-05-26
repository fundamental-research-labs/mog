//! Shared test utilities for the CF module.

use crate::stats::{RangeStatistics, canonical_bits, compute_mean_stddev};
use crate::types::CfRenderStyle;
use rustc_hash::FxHashMap;
use value_types::Color;

/// Build RangeStatistics from a slice of f64 values.
/// Sorts internally, computes all stats including frequency map.
/// Used by rule matchers that need full statistics.
pub fn stats_from_values(values: &[f64]) -> RangeStatistics {
    if values.is_empty() {
        return RangeStatistics::default();
    }

    let mut sorted = values.to_vec();
    sorted.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let count = sorted.len();
    let sum: f64 = sorted.iter().sum();
    let (mean, std_dev) = compute_mean_stddev(&sorted);

    let mut frequency = FxHashMap::default();
    for &v in &sorted {
        *frequency.entry(canonical_bits(v)).or_insert(0) += 1;
    }

    RangeStatistics {
        count,
        min: sorted[0],
        max: sorted[count - 1],
        sum,
        mean,
        std_dev,
        sorted_values: sorted,
        frequency,
        text_frequency: FxHashMap::default(),
        bool_frequency: FxHashMap::default(),
        numeric_text_frequency: FxHashMap::default(),
    }
}

/// Build RangeStatistics from pre-sorted values (no frequency map).
/// Used by visual modules (color_scale, data_bar, icon_set).
pub fn make_stats(sorted: &[f64]) -> RangeStatistics {
    if sorted.is_empty() {
        return RangeStatistics::default();
    }
    let count = sorted.len();
    let min = sorted[0];
    let max = sorted[count - 1];
    let sum: f64 = sorted.iter().sum();
    let (mean, std_dev) = compute_mean_stddev(sorted);
    RangeStatistics {
        count,
        min,
        max,
        sum,
        mean,
        std_dev,
        sorted_values: sorted.to_vec(),
        frequency: FxHashMap::default(),
        text_frequency: FxHashMap::default(),
        bool_frequency: FxHashMap::default(),
        numeric_text_frequency: FxHashMap::default(),
    }
}

/// Standard test style: red background.
pub fn test_style() -> CfRenderStyle {
    CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        ..Default::default()
    }
}

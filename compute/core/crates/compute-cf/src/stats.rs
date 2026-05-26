//! Range statistics for CF evaluation.
//!
//! Foundation for top-10, above-average, color scale, data bar, icon set rules.
//! Single-pass collection from caller-provided values + sort for percentile computation.

use rustc_hash::FxHashMap;

use value_types::CellValue;

// =============================================================================
// RangeStatistics
// =============================================================================

/// Pre-computed statistics for all numeric values in a CF range.
/// Computed once per range, reused for all cells in that range.
#[derive(Debug, Clone)]
pub struct RangeStatistics {
    /// Number of numeric values in the range.
    pub count: usize,
    /// Minimum numeric value (0.0 if empty).
    pub min: f64,
    /// Maximum numeric value (0.0 if empty).
    pub max: f64,
    /// Sum of all numeric values.
    pub sum: f64,
    /// Arithmetic mean (0.0 if empty).
    pub mean: f64,
    /// Sample standard deviation (0.0 if count <= 1).
    /// Uses n-1 divisor (STDEV.S), matching Excel's above-average CF rules.
    pub std_dev: f64,
    /// Sorted numeric values (ascending) for percentile computation.
    pub(crate) sorted_values: Vec<f64>,
    /// Frequency map: f64 bits -> count (for numeric duplicate detection).
    /// NaN values are canonicalized before converting to bits.
    /// -0.0 is normalized to +0.0.
    pub(crate) frequency: FxHashMap<u64, usize>,
    /// Text frequency map: lowercased string -> count (for duplicate detection).
    pub(crate) text_frequency: FxHashMap<String, usize>,
    /// Boolean frequency map: bool -> count (for duplicate detection).
    /// Booleans are tracked separately from text.
    pub(crate) bool_frequency: FxHashMap<bool, usize>,
    /// Pre-computed numeric frequency for text entries that parse as f64.
    /// Maps canonical_bits(parsed_number) -> count for cross-type duplicate detection.
    pub(crate) numeric_text_frequency: FxHashMap<u64, usize>,
}

impl Default for RangeStatistics {
    fn default() -> Self {
        Self {
            count: 0,
            min: 0.0,
            max: 0.0,
            sum: 0.0,
            mean: 0.0,
            std_dev: 0.0,
            sorted_values: Vec::new(),
            frequency: FxHashMap::default(),
            text_frequency: FxHashMap::default(),
            bool_frequency: FxHashMap::default(),
            numeric_text_frequency: FxHashMap::default(),
        }
    }
}

impl RangeStatistics {
    /// Merge multiple per-range statistics into a single combined statistics.
    ///
    /// Used when a CF rule applies to multiple disjoint ranges — the scheduler
    /// computes per-range stats then merges them for the rule.
    ///
    /// Implementation: concatenates sorted_values, re-sorts, merges all 4
    /// frequency maps, and recomputes mean/std_dev via Welford's algorithm
    /// (numerically stable).
    pub fn merge(stats: &[RangeStatistics]) -> RangeStatistics {
        if stats.is_empty() {
            return RangeStatistics::default();
        }
        if stats.len() == 1 {
            return stats[0].clone();
        }

        // Collect all sorted values and re-sort
        let total_count: usize = stats.iter().map(|s| s.count).sum();
        let mut all_values: Vec<f64> = Vec::with_capacity(total_count);
        for s in stats {
            all_values.extend_from_slice(&s.sorted_values);
        }
        all_values.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        if all_values.is_empty() {
            // All ranges had only non-numeric values — merge frequency maps only
            let mut frequency = FxHashMap::default();
            let mut text_frequency: FxHashMap<String, usize> = FxHashMap::default();
            let mut bool_frequency: FxHashMap<bool, usize> = FxHashMap::default();
            let mut numeric_text_frequency: FxHashMap<u64, usize> = FxHashMap::default();
            for s in stats {
                for (&bits, &cnt) in &s.frequency {
                    *frequency.entry(bits).or_insert(0) += cnt;
                }
                for (text, &cnt) in &s.text_frequency {
                    *text_frequency.entry(text.clone()).or_insert(0) += cnt;
                }
                for (&b, &cnt) in &s.bool_frequency {
                    *bool_frequency.entry(b).or_insert(0) += cnt;
                }
                for (&bits, &cnt) in &s.numeric_text_frequency {
                    *numeric_text_frequency.entry(bits).or_insert(0) += cnt;
                }
            }
            return RangeStatistics {
                frequency,
                text_frequency,
                bool_frequency,
                numeric_text_frequency,
                ..Default::default()
            };
        }

        // Compute mean + std_dev via Welford's (numerically stable)
        let (mean, std_dev) = compute_mean_stddev(&all_values);
        let count = all_values.len();
        let sum: f64 = all_values.iter().sum();
        let min = all_values[0];
        let max = all_values[count - 1];

        // Merge all 4 frequency maps
        let mut frequency = FxHashMap::default();
        let mut text_frequency: FxHashMap<String, usize> = FxHashMap::default();
        let mut bool_frequency: FxHashMap<bool, usize> = FxHashMap::default();
        let mut numeric_text_frequency: FxHashMap<u64, usize> = FxHashMap::default();
        for s in stats {
            for (&bits, &cnt) in &s.frequency {
                *frequency.entry(bits).or_insert(0) += cnt;
            }
            for (text, &cnt) in &s.text_frequency {
                *text_frequency.entry(text.clone()).or_insert(0) += cnt;
            }
            for (&b, &cnt) in &s.bool_frequency {
                *bool_frequency.entry(b).or_insert(0) += cnt;
            }
            for (&bits, &cnt) in &s.numeric_text_frequency {
                *numeric_text_frequency.entry(bits).or_insert(0) += cnt;
            }
        }

        RangeStatistics {
            count,
            min,
            max,
            sum,
            mean,
            std_dev,
            sorted_values: all_values,
            frequency,
            text_frequency,
            bool_frequency,
            numeric_text_frequency,
        }
    }
}

// =============================================================================
// Canonical NaN
// =============================================================================

/// Canonical NaN bits for frequency map keys.
/// All NaN values map to this single representation.
const CANONICAL_NAN_BITS: u64 = 0x7FF8_0000_0000_0000; // quiet NaN

/// Canonicalize an f64 for use as a frequency map key.
/// NaN -> canonical NaN bits, -0.0 -> +0.0, everything else -> f64::to_bits().
#[inline]
pub(crate) fn canonical_bits(v: f64) -> u64 {
    if v.is_nan() {
        CANONICAL_NAN_BITS
    } else if v == 0.0 {
        0.0_f64.to_bits() // normalize -0.0 to +0.0
    } else {
        v.to_bits()
    }
}

// =============================================================================
// Welford's online algorithm for mean and standard deviation
// =============================================================================

/// Compute mean and sample standard deviation from a slice of f64 values
/// using Welford's online algorithm. Numerically stable even for tightly
/// clustered large values (avoids catastrophic cancellation).
///
/// Returns (mean, std_dev). For count <= 1, std_dev is 0.0.
pub(crate) fn compute_mean_stddev(values: &[f64]) -> (f64, f64) {
    let count = values.len();
    if count == 0 {
        return (0.0, 0.0);
    }

    // Welford's online algorithm
    let (_n, mean, m2) = values
        .iter()
        .fold((0.0_f64, 0.0_f64, 0.0_f64), |(n, mean, m2), &x| {
            let n = n + 1.0;
            let delta = x - mean;
            let new_mean = mean + delta / n;
            let delta2 = x - new_mean;
            let new_m2 = m2 + delta * delta2;
            (n, new_mean, new_m2)
        });

    let std_dev = if count <= 1 {
        0.0
    } else {
        (m2 / (count - 1) as f64).sqrt()
    };

    (mean, std_dev)
}

// =============================================================================
// compute_range_stats
// =============================================================================

/// Compute statistics for a slice of cell values.
///
/// The caller is responsible for collecting cell values from whatever storage
/// layer is in use (CellMirror, Yrs, etc.) and passing them here.
///
/// O(n) single pass for collection + O(n log n) sort for percentile support.
/// Non-numeric cells (text, boolean, error, null) are skipped for numeric stats
/// but tracked in frequency maps for duplicate detection.
/// NaN and Infinity values are excluded from statistics (matching Excel behavior).
pub fn compute_range_stats(values: &[CellValue]) -> RangeStatistics {
    let mut nums: Vec<f64> = Vec::new();
    let mut frequency: FxHashMap<u64, usize> = FxHashMap::default();
    let mut text_frequency: FxHashMap<String, usize> = FxHashMap::default();
    let mut bool_frequency: FxHashMap<bool, usize> = FxHashMap::default();
    let mut sum: f64 = 0.0;

    // Single pass: collect numeric values + text/boolean frequencies
    for cell_value in values {
        match cell_value {
            CellValue::Number(n) => {
                let n = n.get();

                // Track frequency (FiniteF64 guarantees no NaN/Infinity)
                let bits = canonical_bits(n);
                *frequency.entry(bits).or_insert(0) += 1;

                nums.push(n);
                sum += n;
            }
            CellValue::Text(s) => {
                let key = s.to_lowercase();
                *text_frequency.entry(key).or_insert(0) += 1;
            }
            CellValue::Boolean(b) => {
                *bool_frequency.entry(*b).or_insert(0) += 1;
            }
            _ => {}
        }
    }

    let count = nums.len();

    if count == 0 {
        let numeric_text_frequency = build_numeric_text_frequency(&text_frequency);
        return RangeStatistics {
            count: 0,
            min: 0.0,
            max: 0.0,
            sum: 0.0,
            mean: 0.0,
            std_dev: 0.0,
            sorted_values: Vec::new(),
            frequency,
            text_frequency,
            bool_frequency,
            numeric_text_frequency,
        };
    }

    // Welford's online algorithm for numerically stable mean and std_dev
    let (mean, std_dev) = compute_mean_stddev(&nums);

    // Sort for percentile computation
    nums.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    // min/max from sorted (avoids edge case if only one value)
    let min = nums[0];
    let max = nums[count - 1];

    let numeric_text_frequency = build_numeric_text_frequency(&text_frequency);

    RangeStatistics {
        count,
        min,
        max,
        sum,
        mean,
        std_dev,
        sorted_values: nums,
        frequency,
        text_frequency,
        bool_frequency,
        numeric_text_frequency,
    }
}

/// Parse text as a plain number (no scientific notation) for cross-type coercion.
/// Excel only coerces plain numeric text ("100", "1.5", "-3") to numbers for
/// duplicate detection -- NOT scientific notation ("1e2", "1.5E3").
pub(crate) fn parse_plain_number(s: &str) -> Option<f64> {
    // Reject if it contains 'e' or 'E' (scientific notation)
    if s.contains('e') || s.contains('E') {
        return None;
    }
    s.parse::<f64>().ok()
}

/// Build cross-type numeric frequency map from text_frequency.
/// For each text entry that parses as f64, maps canonical_bits(parsed) -> count.
fn build_numeric_text_frequency(
    text_frequency: &FxHashMap<String, usize>,
) -> FxHashMap<u64, usize> {
    let mut map: FxHashMap<u64, usize> = FxHashMap::default();
    for (text, &cnt) in text_frequency {
        if let Some(parsed) = parse_plain_number(text) {
            let bits = canonical_bits(parsed);
            *map.entry(bits).or_insert(0) += cnt;
        }
    }
    map
}

// =============================================================================
// Percentile (Excel PERCENTILE.INC style)
// =============================================================================

/// Compute percentile from pre-sorted values using linear interpolation.
///
/// Uses Excel PERCENTILE.INC algorithm:
/// - For percentile p in [0, 1], rank = p * (n - 1)
/// - Linear interpolation between floor(rank) and ceil(rank) values.
///
/// # Arguments
/// - `sorted`: ascending-sorted slice of f64 values.
/// - `p`: percentile as a fraction in [0.0, 1.0].
///
/// # Returns
/// The interpolated percentile value, or 0.0 for empty input.
pub(crate) fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }

    // Clamp p to [0, 1]
    let p = p.clamp(0.0, 1.0);

    let n = sorted.len();
    let rank = p * (n - 1) as f64;
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;

    // Clamp indices (safety, though rank should be in [0, n-1])
    let lower = lower.min(n - 1);
    let upper = upper.min(n - 1);

    if lower == upper {
        return sorted[lower];
    }

    let fraction = rank - lower as f64;
    sorted[lower] + fraction * (sorted[upper] - sorted[lower])
}

#[cfg(test)]
#[path = "stats_tests.rs"]
mod tests;

//! Single-pass descriptive statistics over a set of cell values.
//!
//! The general "`df.describe()` / `summary()`" primitive. Used by conditional
//! formatting, status bar, pivot tables, charts, and sparklines.

use super::values::{cell_value_is_numeric, kahan_sum, welford_online};
use value_types::CellValue;

/// Single-pass descriptive statistics over numeric values.
///
/// Non-numeric cells (text, boolean, error, null) are excluded.
/// NaN and Infinity values are excluded (matching Excel behavior —
/// `FiniteF64` in `CellValue::Number` enforces this structurally).
#[derive(Debug, Clone)]
pub struct DescriptiveStats {
    /// Number of numeric values.
    pub count: usize,
    /// Minimum numeric value (0.0 if empty).
    pub min: f64,
    /// Maximum numeric value (0.0 if empty).
    pub max: f64,
    /// Sum of all numeric values (Kahan compensated).
    pub sum: f64,
    /// Arithmetic mean (0.0 if empty).
    pub mean: f64,
    /// Sample standard deviation (n-1 divisor, 0.0 if count <= 1).
    ///
    /// Matches Excel's `STDEV.S` function.
    pub std_dev: f64,
    /// Population standard deviation (n divisor, 0.0 if empty).
    ///
    /// Matches Excel's `STDEV.P` function.
    pub std_dev_pop: f64,
    /// Numeric values sorted ascending, for percentile and top-N computation.
    pub sorted_values: Vec<f64>,
}

impl Default for DescriptiveStats {
    fn default() -> Self {
        Self {
            count: 0,
            min: 0.0,
            max: 0.0,
            sum: 0.0,
            mean: 0.0,
            std_dev: 0.0,
            std_dev_pop: 0.0,
            sorted_values: Vec::new(),
        }
    }
}

/// Compute descriptive statistics from cell values.
///
/// Non-numeric cells (text, boolean, error, null) are excluded.
/// Collects numeric values in O(n), computes stats via Welford's
/// algorithm, then sorts for percentile support in O(n log n).
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
/// use compute_stats::describe::describe;
///
/// let values = vec![
///     CellValue::number(10.0),
///     CellValue::number(20.0),
///     CellValue::number(30.0),
/// ];
/// let stats = describe(&values);
/// assert_eq!(stats.count, 3);
/// assert_eq!(stats.mean, 20.0);
/// ```
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn describe(values: &[CellValue]) -> DescriptiveStats {
    // Collect numeric values
    let mut nums: Vec<f64> = Vec::new();
    for v in values {
        if cell_value_is_numeric(v)
            && let Some(n) = v.as_number()
        {
            nums.push(n);
        }
    }

    if nums.is_empty() {
        return DescriptiveStats::default();
    }

    let (mean, m2, _count) = welford_online(nums.iter().copied());
    let sum = kahan_sum(nums.iter().copied());

    let n = nums.len();
    let std_dev = if n <= 1 {
        0.0
    } else {
        (m2 / (n - 1) as f64).sqrt()
    };
    let std_dev_pop = if n == 0 { 0.0 } else { (m2 / n as f64).sqrt() };

    // Sort for percentile
    nums.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let min = nums[0];
    let max = nums[n - 1];

    DescriptiveStats {
        count: n,
        min,
        max,
        sum,
        mean,
        std_dev,
        std_dev_pop,
        sorted_values: nums,
    }
}

/// Compute percentile from pre-sorted values (Excel `PERCENTILE.INC`).
///
/// Uses linear interpolation between `floor(rank)` and `ceil(rank)`.
/// Rank is computed as `p * (n - 1)`.
///
/// # Arguments
///
/// * `sorted` — ascending-sorted slice of f64 values
/// * `p` — percentile as a fraction in \[0.0, 1.0\] (clamped)
///
/// # Returns
///
/// The interpolated percentile value, or 0.0 for empty input.
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }

    let p = p.clamp(0.0, 1.0);
    let n = sorted.len();
    let rank = p * (n - 1) as f64;
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;

    let lower = lower.min(n - 1);
    let upper = upper.min(n - 1);

    if lower == upper {
        return sorted[lower];
    }

    let fraction = rank - lower as f64;
    sorted[lower] + fraction * (sorted[upper] - sorted[lower])
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, CellValue, FiniteF64};

    fn n(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::new(v).unwrap())
    }

    // ---- describe: empty ----

    #[test]
    fn describe_empty() {
        let stats = describe(&[]);
        assert_eq!(stats.count, 0);
        assert_eq!(stats.min, 0.0);
        assert_eq!(stats.max, 0.0);
        assert_eq!(stats.sum, 0.0);
        assert_eq!(stats.mean, 0.0);
        assert_eq!(stats.std_dev, 0.0);
        assert_eq!(stats.std_dev_pop, 0.0);
        assert!(stats.sorted_values.is_empty());
    }

    // ---- describe: single value ----

    #[test]
    fn describe_single() {
        let stats = describe(&[n(42.0)]);
        assert_eq!(stats.count, 1);
        assert_eq!(stats.min, 42.0);
        assert_eq!(stats.max, 42.0);
        assert_eq!(stats.sum, 42.0);
        assert_eq!(stats.mean, 42.0);
        assert_eq!(stats.std_dev, 0.0);
        assert_eq!(stats.std_dev_pop, 0.0);
        assert_eq!(stats.sorted_values, vec![42.0]);
    }

    // ---- describe: multiple values ----

    #[test]
    fn describe_multiple() {
        let stats = describe(&[n(10.0), n(20.0), n(30.0), n(40.0), n(50.0)]);
        assert_eq!(stats.count, 5);
        assert_eq!(stats.min, 10.0);
        assert_eq!(stats.max, 50.0);
        assert_eq!(stats.sum, 150.0);
        assert_eq!(stats.mean, 30.0);
        // Sample variance = 1000/4 = 250, stddev = sqrt(250) ≈ 15.811
        let expected_std_dev = (250.0_f64).sqrt();
        assert!((stats.std_dev - expected_std_dev).abs() < 1e-10);
        // Population variance = 1000/5 = 200, stddev = sqrt(200) ≈ 14.142
        let expected_std_dev_pop = (200.0_f64).sqrt();
        assert!((stats.std_dev_pop - expected_std_dev_pop).abs() < 1e-10);
        assert_eq!(stats.sorted_values, vec![10.0, 20.0, 30.0, 40.0, 50.0]);
    }

    // ---- describe: mixed types (non-numeric excluded) ----

    #[test]
    fn describe_mixed_types() {
        let values = vec![
            n(10.0),
            CellValue::Text("hello".into()),
            n(20.0),
            CellValue::Boolean(true),
            CellValue::Null,
            n(30.0),
            CellValue::Error(CellError::Value, None),
        ];
        let stats = describe(&values);
        assert_eq!(stats.count, 3);
        assert_eq!(stats.min, 10.0);
        assert_eq!(stats.max, 30.0);
        assert_eq!(stats.sum, 60.0);
        assert_eq!(stats.mean, 20.0);
    }

    // ---- describe: negative values ----

    #[test]
    fn describe_negative() {
        let stats = describe(&[n(-30.0), n(-10.0), n(0.0), n(10.0), n(30.0)]);
        assert_eq!(stats.count, 5);
        assert_eq!(stats.min, -30.0);
        assert_eq!(stats.max, 30.0);
        assert!(stats.mean.abs() < 1e-10);
    }

    // ---- describe: Welford numerical precision ----

    #[test]
    fn describe_welford_precision() {
        let stats = describe(&[n(1e15 + 1.0), n(1e15 + 2.0), n(1e15 + 3.0)]);
        assert_eq!(stats.count, 3);
        assert!((stats.mean - (1e15 + 2.0)).abs() < 1e-6);
        assert!((stats.std_dev - 1.0).abs() < 1e-6);
    }

    // ---- describe: all same values ----

    #[test]
    fn describe_all_same() {
        let stats = describe(&[n(5.0), n(5.0), n(5.0)]);
        assert_eq!(stats.count, 3);
        assert_eq!(stats.mean, 5.0);
        assert_eq!(stats.std_dev, 0.0);
        assert_eq!(stats.std_dev_pop, 0.0);
    }

    // ---- percentile: empty ----

    #[test]
    fn percentile_empty() {
        assert_eq!(percentile(&[], 0.5), 0.0);
    }

    // ---- percentile: single ----

    #[test]
    fn percentile_single() {
        assert_eq!(percentile(&[42.0], 0.0), 42.0);
        assert_eq!(percentile(&[42.0], 0.5), 42.0);
        assert_eq!(percentile(&[42.0], 1.0), 42.0);
    }

    // ---- percentile: two values ----

    #[test]
    fn percentile_two() {
        assert_eq!(percentile(&[10.0, 20.0], 0.0), 10.0);
        assert_eq!(percentile(&[10.0, 20.0], 0.5), 15.0);
        assert_eq!(percentile(&[10.0, 20.0], 1.0), 20.0);
        assert_eq!(percentile(&[10.0, 20.0], 0.25), 12.5);
    }

    // ---- percentile: five values (Excel PERCENTILE.INC) ----

    #[test]
    fn percentile_five_values() {
        let sorted = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(percentile(&sorted, 0.0), 1.0);
        assert_eq!(percentile(&sorted, 0.25), 2.0);
        assert_eq!(percentile(&sorted, 0.5), 3.0);
        assert_eq!(percentile(&sorted, 0.75), 4.0);
        assert_eq!(percentile(&sorted, 1.0), 5.0);
        // p=0.3: rank=1.2 → 2 + 0.2*(3-2) = 2.2
        assert!((percentile(&sorted, 0.3) - 2.2).abs() < 1e-10);
    }

    // ---- percentile: clamping ----

    #[test]
    fn percentile_clamped() {
        let sorted = vec![10.0, 20.0, 30.0];
        assert_eq!(percentile(&sorted, -0.5), 10.0);
        assert_eq!(percentile(&sorted, 1.5), 30.0);
    }

    // ---- describe: mathematical verification with known dataset ----

    #[test]
    fn describe_known_dataset_2_4_4_4_5_5_7_9() {
        // [2, 4, 4, 4, 5, 5, 7, 9]
        // count=8, sum=40, mean=5, min=2, max=9
        // pop_var = ((2-5)^2 + 3*(4-5)^2 + 2*(5-5)^2 + (7-5)^2 + (9-5)^2) / 8
        //         = (9 + 3 + 0 + 4 + 16) / 8 = 32/8 = 4
        // pop_std_dev = sqrt(4) = 2.0
        // sample_var = 32/7
        // sample_std_dev = sqrt(32/7) ≈ 2.13809...
        let values = vec![
            n(2.0),
            n(4.0),
            n(4.0),
            n(4.0),
            n(5.0),
            n(5.0),
            n(7.0),
            n(9.0),
        ];
        let stats = describe(&values);

        assert_eq!(stats.count, 8);
        assert!((stats.sum - 40.0).abs() < 1e-10);
        assert!((stats.mean - 5.0).abs() < 1e-10);
        assert_eq!(stats.min, 2.0);
        assert_eq!(stats.max, 9.0);

        let expected_sample_std = (32.0_f64 / 7.0).sqrt();
        assert!(
            (stats.std_dev - expected_sample_std).abs() < 1e-10,
            "sample std_dev: expected {expected_sample_std}, got {}",
            stats.std_dev
        );

        assert!(
            (stats.std_dev_pop - 2.0).abs() < 1e-10,
            "pop std_dev: expected 2.0, got {}",
            stats.std_dev_pop
        );

        assert_eq!(
            stats.sorted_values,
            vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
        );
    }

    // ---- describe: two values ----

    #[test]
    fn describe_two_values_3_7() {
        // [3, 7]: count=2, sum=10, mean=5, min=3, max=7
        // m2 = (3-5)^2 + (7-5)^2 = 4 + 4 = 8
        // sample_std = sqrt(8/1) = sqrt(8) ≈ 2.828...
        // pop_std = sqrt(8/2) = sqrt(4) = 2.0
        let stats = describe(&[n(3.0), n(7.0)]);

        assert_eq!(stats.count, 2);
        assert!((stats.sum - 10.0).abs() < 1e-10);
        assert!((stats.mean - 5.0).abs() < 1e-10);
        assert_eq!(stats.min, 3.0);
        assert_eq!(stats.max, 7.0);

        let expected_sample_std = 8.0_f64.sqrt();
        assert!(
            (stats.std_dev - expected_sample_std).abs() < 1e-10,
            "sample std_dev: expected {expected_sample_std}, got {}",
            stats.std_dev
        );
        assert!(
            (stats.std_dev_pop - 2.0).abs() < 1e-10,
            "pop std_dev: expected 2.0, got {}",
            stats.std_dev_pop
        );
    }

    // ---- percentile: mathematical verification with 1..=10 ----

    #[test]
    fn percentile_ten_values_p0() {
        let sorted: Vec<f64> = (1..=10).map(|x| x as f64).collect();
        assert_eq!(percentile(&sorted, 0.0), 1.0);
    }

    #[test]
    fn percentile_ten_values_p25() {
        // index = (10-1)*0.25 = 2.25
        // sorted[2]=3, sorted[3]=4, weight=0.25
        // result = 3 + 0.25*(4-3) = 3.25
        let sorted: Vec<f64> = (1..=10).map(|x| x as f64).collect();
        assert!((percentile(&sorted, 0.25) - 3.25).abs() < 1e-10);
    }

    #[test]
    fn percentile_ten_values_p50() {
        // index = 9*0.5 = 4.5
        // sorted[4]=5, sorted[5]=6, weight=0.5
        // result = 5 + 0.5*(6-5) = 5.5
        let sorted: Vec<f64> = (1..=10).map(|x| x as f64).collect();
        assert!((percentile(&sorted, 0.5) - 5.5).abs() < 1e-10);
    }

    #[test]
    fn percentile_ten_values_p100() {
        let sorted: Vec<f64> = (1..=10).map(|x| x as f64).collect();
        assert_eq!(percentile(&sorted, 1.0), 10.0);
    }

    // ---- percentile vs describe consistency ----

    #[test]
    fn percentile_median_matches_describe_sorted() {
        let values = vec![
            n(3.0),
            n(1.0),
            n(4.0),
            n(1.0),
            n(5.0),
            n(9.0),
            n(2.0),
            n(6.0),
        ];
        let stats = describe(&values);

        // The median from percentile on describe's sorted_values should match
        // a direct computation.
        let median_from_percentile = percentile(&stats.sorted_values, 0.5);

        // Manual: sorted = [1,1,2,3,4,5,6,9], n=8
        // index = 7*0.5 = 3.5 → sorted[3]=3, sorted[4]=4
        // median = 3 + 0.5*(4-3) = 3.5
        assert!(
            (median_from_percentile - 3.5).abs() < 1e-10,
            "Expected median 3.5, got {median_from_percentile}"
        );
    }

    // ---- describe: only non-numeric values ----

    #[test]
    fn describe_only_non_numeric() {
        let values = vec![
            CellValue::Text("hello".into()),
            CellValue::Boolean(true),
            CellValue::Null,
        ];
        let stats = describe(&values);

        assert_eq!(stats.count, 0);
        assert_eq!(stats.min, 0.0);
        assert_eq!(stats.max, 0.0);
        assert_eq!(stats.sum, 0.0);
        assert_eq!(stats.mean, 0.0);
        assert_eq!(stats.std_dev, 0.0);
        assert_eq!(stats.std_dev_pop, 0.0);
        assert!(stats.sorted_values.is_empty());
    }
}

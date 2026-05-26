use super::*;
use value_types::{CellValue, FiniteF64};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

fn values_from_f64s(vals: &[f64]) -> Vec<CellValue> {
    vals.iter().map(|&v| CellValue::number(v)).collect()
}

// -----------------------------------------------------------------------
// Empty range
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_empty_range() {
    let values: Vec<CellValue> = vec![];
    let stats = compute_range_stats(&values);
    assert_eq!(stats.count, 0);
    assert_eq!(stats.min, 0.0);
    assert_eq!(stats.max, 0.0);
    assert_eq!(stats.sum, 0.0);
    assert_eq!(stats.mean, 0.0);
    assert_eq!(stats.std_dev, 0.0);
    assert!(stats.sorted_values.is_empty());
}

// -----------------------------------------------------------------------
// Single value
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_single_value() {
    let values = values_from_f64s(&[42.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 1);
    assert_eq!(stats.min, 42.0);
    assert_eq!(stats.max, 42.0);
    assert_eq!(stats.sum, 42.0);
    assert_eq!(stats.mean, 42.0);
    assert_eq!(stats.std_dev, 0.0);
    assert_eq!(stats.sorted_values, vec![42.0]);
}

// -----------------------------------------------------------------------
// All same values
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_all_same_values() {
    let values = values_from_f64s(&[5.0, 5.0, 5.0, 5.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 4);
    assert_eq!(stats.min, 5.0);
    assert_eq!(stats.max, 5.0);
    assert_eq!(stats.sum, 20.0);
    assert_eq!(stats.mean, 5.0);
    assert_eq!(stats.std_dev, 0.0);
    assert_eq!(stats.sorted_values, vec![5.0, 5.0, 5.0, 5.0]);
}

// -----------------------------------------------------------------------
// Mixed values
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_mixed_values() {
    let values = values_from_f64s(&[10.0, 20.0, 30.0, 40.0, 50.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 5);
    assert_eq!(stats.min, 10.0);
    assert_eq!(stats.max, 50.0);
    assert_eq!(stats.sum, 150.0);
    assert_eq!(stats.mean, 30.0);

    // Sample stddev (STDEV.S) for [10, 20, 30, 40, 50]
    // Variance = ((10-30)^2 + (20-30)^2 + (30-30)^2 + (40-30)^2 + (50-30)^2) / (5-1)
    //          = (400 + 100 + 0 + 100 + 400) / 4 = 250
    // StdDev = sqrt(250) ~= 15.811
    let expected_std_dev = (250.0_f64).sqrt();
    assert!((stats.std_dev - expected_std_dev).abs() < 1e-10);

    assert_eq!(stats.sorted_values, vec![10.0, 20.0, 30.0, 40.0, 50.0]);
}

// -----------------------------------------------------------------------
// Negative values
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_negative_values() {
    let values = values_from_f64s(&[-30.0, -10.0, 0.0, 10.0, 30.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 5);
    assert_eq!(stats.min, -30.0);
    assert_eq!(stats.max, 30.0);
    assert_eq!(stats.sum, 0.0);
    // Welford's mean may have tiny floating-point residual vs exact 0.0
    assert!(
        stats.mean.abs() < 1e-10,
        "mean should be ~0.0 but got {}",
        stats.mean
    );
    assert_eq!(stats.sorted_values, vec![-30.0, -10.0, 0.0, 10.0, 30.0]);
}

// -----------------------------------------------------------------------
// Non-numeric cells are skipped
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_non_numeric_cells_skipped() {
    let values = vec![
        n(10.0),
        CellValue::Text("hello".into()),
        n(20.0),
        CellValue::Boolean(true),
        CellValue::Null,
        n(30.0),
    ];
    let stats = compute_range_stats(&values);

    // Only 3 numeric values
    assert_eq!(stats.count, 3);
    assert_eq!(stats.min, 10.0);
    assert_eq!(stats.max, 30.0);
    assert_eq!(stats.sum, 60.0);
    assert_eq!(stats.mean, 20.0);
    assert_eq!(stats.sorted_values, vec![10.0, 20.0, 30.0]);
}

// -----------------------------------------------------------------------
// NaN handling
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_nan_values_excluded_from_stats() {
    let values = values_from_f64s(&[10.0, f64::NAN, 20.0, f64::NAN, 30.0]);
    let stats = compute_range_stats(&values);

    // NaN values become CellValue::Error via CellValue::number(),
    // so they are excluded from both stats AND frequency tracking.
    assert_eq!(stats.count, 3);
    assert_eq!(stats.min, 10.0);
    assert_eq!(stats.max, 30.0);
    assert_eq!(stats.sorted_values, vec![10.0, 20.0, 30.0]);

    // NaN is no longer stored as Number (FiniteF64 invariant), so not in frequency
    assert!(!stats.frequency.contains_key(&CANONICAL_NAN_BITS));
}

#[test]
fn test_cf_stats_infinity_excluded_from_stats() {
    let values = values_from_f64s(&[10.0, f64::INFINITY, 20.0, f64::NEG_INFINITY]);
    let stats = compute_range_stats(&values);

    // Infinity values become CellValue::Error via CellValue::number(),
    // so only the two finite values are counted.
    assert_eq!(stats.count, 2);
    assert_eq!(stats.min, 10.0);
    assert_eq!(stats.max, 20.0);
}

// -----------------------------------------------------------------------
// Frequency map
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_frequency_map() {
    let values = values_from_f64s(&[10.0, 20.0, 10.0, 30.0, 10.0, 20.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.frequency[&10.0_f64.to_bits()], 3);
    assert_eq!(stats.frequency[&20.0_f64.to_bits()], 2);
    assert_eq!(stats.frequency[&30.0_f64.to_bits()], 1);
}

// -----------------------------------------------------------------------
// Sorted values
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_sorted_values_unsorted_input() {
    let values = values_from_f64s(&[50.0, 10.0, 40.0, 20.0, 30.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.sorted_values, vec![10.0, 20.0, 30.0, 40.0, 50.0]);
}

// -----------------------------------------------------------------------
// Percentile: empty
// -----------------------------------------------------------------------

#[test]
fn test_cf_percentile_empty() {
    assert_eq!(percentile(&[], 0.5), 0.0);
}

// -----------------------------------------------------------------------
// Percentile: single value
// -----------------------------------------------------------------------

#[test]
fn test_cf_percentile_single_value() {
    assert_eq!(percentile(&[42.0], 0.0), 42.0);
    assert_eq!(percentile(&[42.0], 0.5), 42.0);
    assert_eq!(percentile(&[42.0], 1.0), 42.0);
}

// -----------------------------------------------------------------------
// Percentile: two values
// -----------------------------------------------------------------------

#[test]
fn test_cf_percentile_two_values() {
    let sorted = vec![10.0, 20.0];

    assert_eq!(percentile(&sorted, 0.0), 10.0);
    assert_eq!(percentile(&sorted, 0.5), 15.0); // interpolation
    assert_eq!(percentile(&sorted, 1.0), 20.0);
    assert_eq!(percentile(&sorted, 0.25), 12.5);
    assert_eq!(percentile(&sorted, 0.75), 17.5);
}

// -----------------------------------------------------------------------
// Percentile: Excel PERCENTILE.INC style
// -----------------------------------------------------------------------

#[test]
fn test_cf_percentile_inc_five_values() {
    // Excel PERCENTILE.INC({1,2,3,4,5}, 0.25) = 2
    // rank = 0.25 * 4 = 1.0 -> sorted[1] = 2
    let sorted = vec![1.0, 2.0, 3.0, 4.0, 5.0];

    assert_eq!(percentile(&sorted, 0.0), 1.0);
    assert_eq!(percentile(&sorted, 0.25), 2.0);
    assert_eq!(percentile(&sorted, 0.5), 3.0);
    assert_eq!(percentile(&sorted, 0.75), 4.0);
    assert_eq!(percentile(&sorted, 1.0), 5.0);

    // Excel PERCENTILE.INC({1,2,3,4,5}, 0.3) = 2.2
    // rank = 0.3 * 4 = 1.2 -> sorted[1] + 0.2 * (sorted[2] - sorted[1]) = 2 + 0.2 = 2.2
    let p30 = percentile(&sorted, 0.3);
    assert!((p30 - 2.2).abs() < 1e-10);

    // Excel PERCENTILE.INC({1,2,3,4,5}, 0.1) = 1.4
    // rank = 0.1 * 4 = 0.4 -> sorted[0] + 0.4 * (sorted[1] - sorted[0]) = 1 + 0.4 = 1.4
    let p10 = percentile(&sorted, 0.1);
    assert!((p10 - 1.4).abs() < 1e-10);
}

// -----------------------------------------------------------------------
// Percentile: edge cases -- clamping
// -----------------------------------------------------------------------

#[test]
fn test_cf_percentile_clamped() {
    let sorted = vec![10.0, 20.0, 30.0];

    // p < 0 clamped to 0
    assert_eq!(percentile(&sorted, -0.5), 10.0);

    // p > 1 clamped to 1
    assert_eq!(percentile(&sorted, 1.5), 30.0);
}

// -----------------------------------------------------------------------
// Population std dev correctness
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_sample_std_dev() {
    // Known dataset: {2, 4, 4, 4, 5, 5, 7, 9}
    // Mean = 40/8 = 5
    // Sample Variance = sum((xi-5)^2) / (8-1)
    //   = (9 + 1 + 1 + 1 + 0 + 0 + 4 + 16) / 7 = 32/7 ~= 4.5714
    // Sample StdDev = sqrt(32/7) ~= 2.1381
    let values = values_from_f64s(&[2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 8);
    assert_eq!(stats.mean, 5.0);
    let expected = (32.0_f64 / 7.0).sqrt();
    assert!((stats.std_dev - expected).abs() < 1e-10);
}

// -----------------------------------------------------------------------
// 2D range (multiple columns) -- now just a flat Vec of 9 values
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_2d_range() {
    // Values 1-9 (was a 3x3 grid, now flat)
    let values = values_from_f64s(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 9);
    assert_eq!(stats.min, 1.0);
    assert_eq!(stats.max, 9.0);
    assert_eq!(stats.sum, 45.0);
    assert_eq!(stats.mean, 5.0);
    assert_eq!(
        stats.sorted_values,
        vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    );
}

// -----------------------------------------------------------------------
// Partial range (subset of sheet) -- caller passes subset directly
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_partial_range() {
    // Only the subset values (was rows 3-7 of a 10-row column: 4,5,6,7,8)
    let values = values_from_f64s(&[4.0, 5.0, 6.0, 7.0, 8.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 5);
    assert_eq!(stats.min, 4.0);
    assert_eq!(stats.max, 8.0);
    assert_eq!(stats.sorted_values, vec![4.0, 5.0, 6.0, 7.0, 8.0]);
}

// -----------------------------------------------------------------------
// Large value correctness (no overflow issues)
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_large_values() {
    let values = values_from_f64s(&[1e15, 2e15, 3e15]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 3);
    assert_eq!(stats.min, 1e15);
    assert_eq!(stats.max, 3e15);
    assert!((stats.mean - 2e15).abs() < 1.0); // floating point tolerance
}

// -----------------------------------------------------------------------
// Negative zero (-0.0) handling
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_negative_zero() {
    let values = values_from_f64s(&[-0.0, 0.0, 1.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 3);
    // min should be -0.0 or 0.0 (both are == 0.0)
    assert_eq!(stats.min, 0.0);
    assert_eq!(stats.max, 1.0);
}

// -----------------------------------------------------------------------
// -0.0 and 0.0 have the same frequency map key
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_negative_zero_same_frequency_key() {
    let values = values_from_f64s(&[-0.0, 0.0]);
    let stats = compute_range_stats(&values);

    // Both -0.0 and 0.0 should map to the same canonical key (+0.0 bits)
    let zero_bits = 0.0_f64.to_bits();
    assert_eq!(stats.frequency.get(&zero_bits).copied().unwrap_or(0), 2);
    // There should be only one key for zero in the frequency map
    let neg_zero_bits = (-0.0_f64).to_bits();
    assert_eq!(stats.frequency.get(&neg_zero_bits).copied().unwrap_or(0), 0);
}

// -----------------------------------------------------------------------
// Text/boolean frequency map
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_text_frequency_case_insensitive() {
    let values = vec![
        CellValue::Text("Hello".into()),
        CellValue::Text("hello".into()),
        CellValue::Text("HELLO".into()),
        CellValue::Text("world".into()),
    ];
    let stats = compute_range_stats(&values);

    assert_eq!(stats.text_frequency.get("hello").copied().unwrap_or(0), 3);
    assert_eq!(stats.text_frequency.get("world").copied().unwrap_or(0), 1);
}

#[test]
fn test_cf_stats_boolean_frequency() {
    let values = vec![
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        CellValue::Boolean(true),
    ];
    let stats = compute_range_stats(&values);

    assert_eq!(stats.bool_frequency.get(&true).copied().unwrap_or(0), 2);
    assert_eq!(stats.bool_frequency.get(&false).copied().unwrap_or(0), 1);
}

// -----------------------------------------------------------------------
// Percentile: all-identical values
// -----------------------------------------------------------------------

#[test]
fn test_percentile_all_same_values() {
    let sorted = vec![5.0, 5.0, 5.0, 5.0];
    // All percentile points should return 5.0
    assert_eq!(percentile(&sorted, 0.0), 5.0);
    assert_eq!(percentile(&sorted, 0.25), 5.0);
    assert_eq!(percentile(&sorted, 0.5), 5.0);
    assert_eq!(percentile(&sorted, 0.75), 5.0);
    assert_eq!(percentile(&sorted, 1.0), 5.0);
}

// -----------------------------------------------------------------------
// Percentile: empty slice returns 0.0
// -----------------------------------------------------------------------

#[test]
fn test_percentile_empty_slice() {
    let sorted: Vec<f64> = vec![];
    // Empty slice returns 0.0 (documented behavior)
    assert_eq!(percentile(&sorted, 0.0), 0.0);
    assert_eq!(percentile(&sorted, 0.5), 0.0);
    assert_eq!(percentile(&sorted, 1.0), 0.0);
}

// -----------------------------------------------------------------------
// Percentile: two identical values
// -----------------------------------------------------------------------

#[test]
fn test_percentile_two_identical() {
    let sorted = vec![7.0, 7.0];
    assert_eq!(percentile(&sorted, 0.0), 7.0);
    assert_eq!(percentile(&sorted, 0.5), 7.0);
    assert_eq!(percentile(&sorted, 1.0), 7.0);
}

// -----------------------------------------------------------------------
// Welford's algorithm: numerical precision for large clustered values
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_welford_numerical_precision() {
    // Tightly clustered large values: naive two-pass approach suffers from
    // catastrophic cancellation, Welford's online algorithm does not.
    let values = values_from_f64s(&[1e15 + 1.0, 1e15 + 2.0, 1e15 + 3.0]);
    let stats = compute_range_stats(&values);

    assert_eq!(stats.count, 3);
    // Mean should be 1e15 + 2.0
    assert!((stats.mean - (1e15 + 2.0)).abs() < 1e-6);
    // Sample std_dev for [1, 2, 3] offset by 1e15 should be 1.0
    // (variance = ((-1)^2 + 0^2 + 1^2) / 2 = 1.0, std_dev = 1.0)
    assert!(
        stats.std_dev > 0.0,
        "std_dev must be non-zero for distinct values"
    );
    assert!(
        (stats.std_dev - 1.0).abs() < 1e-6,
        "std_dev should be ~1.0 but got {}",
        stats.std_dev
    );
}

#[test]
fn test_compute_mean_stddev_standalone() {
    // Direct test of the shared helper function
    let (mean, std_dev) = compute_mean_stddev(&[1e15 + 1.0, 1e15 + 2.0, 1e15 + 3.0]);
    assert!((mean - (1e15 + 2.0)).abs() < 1e-6);
    assert!((std_dev - 1.0).abs() < 1e-6);

    // Empty
    let (mean, std_dev) = compute_mean_stddev(&[]);
    assert_eq!(mean, 0.0);
    assert_eq!(std_dev, 0.0);

    // Single value
    let (mean, std_dev) = compute_mean_stddev(&[42.0]);
    assert_eq!(mean, 42.0);
    assert_eq!(std_dev, 0.0);
}

// -----------------------------------------------------------------------
// Error cell values are excluded from statistics
// -----------------------------------------------------------------------

#[test]
fn test_cf_stats_error_cells_excluded() {
    use value_types::CellError;
    let values = vec![
        n(10.0),
        CellValue::Error(CellError::Value, None),
        n(20.0),
        CellValue::Error(CellError::Div0, None),
        n(30.0),
        CellValue::Error(CellError::Na, None),
    ];
    let stats = compute_range_stats(&values);

    // Only 3 numeric values (errors are skipped entirely)
    assert_eq!(stats.count, 3);
    assert_eq!(stats.min, 10.0);
    assert_eq!(stats.max, 30.0);
    assert_eq!(stats.sum, 60.0);
    assert_eq!(stats.mean, 20.0);
    assert_eq!(stats.sorted_values, vec![10.0, 20.0, 30.0]);
    // Errors should not appear in frequency map (they are not Number variants)
    assert!(stats.frequency.is_empty() || stats.frequency.len() == 3);
}

// -----------------------------------------------------------------------
// RangeStatistics::merge
// -----------------------------------------------------------------------

#[test]
fn test_merge_empty() {
    let merged = RangeStatistics::merge(&[]);
    assert_eq!(merged.count, 0);
    assert_eq!(merged.min, 0.0);
    assert_eq!(merged.max, 0.0);
    assert_eq!(merged.mean, 0.0);
    assert_eq!(merged.std_dev, 0.0);
    assert!(merged.sorted_values.is_empty());
}

#[test]
fn test_merge_single() {
    let stats = compute_range_stats(&values_from_f64s(&[1.0, 2.0, 3.0]));
    let merged = RangeStatistics::merge(&[stats.clone()]);
    assert_eq!(merged.count, stats.count);
    assert_eq!(merged.min, stats.min);
    assert_eq!(merged.max, stats.max);
    assert!((merged.mean - stats.mean).abs() < 1e-10);
    assert!((merged.std_dev - stats.std_dev).abs() < 1e-10);
    assert_eq!(merged.sorted_values, stats.sorted_values);
}

#[test]
fn test_merge_two_disjoint_ranges() {
    let s1 = compute_range_stats(&values_from_f64s(&[1.0, 2.0, 3.0]));
    let s2 = compute_range_stats(&values_from_f64s(&[7.0, 8.0, 9.0]));
    let merged = RangeStatistics::merge(&[s1, s2]);
    assert_eq!(merged.count, 6);
    assert_eq!(merged.min, 1.0);
    assert_eq!(merged.max, 9.0);
    assert_eq!(merged.sorted_values, vec![1.0, 2.0, 3.0, 7.0, 8.0, 9.0]);
    assert!((merged.mean - 5.0).abs() < 1e-10);
}

#[test]
fn test_merge_overlapping_frequency() {
    // Both ranges have value 5.0 — frequency should sum
    let s1 = compute_range_stats(&values_from_f64s(&[5.0, 5.0, 10.0]));
    let s2 = compute_range_stats(&values_from_f64s(&[5.0, 20.0]));
    let merged = RangeStatistics::merge(&[s1, s2]);
    let bits_5 = canonical_bits(5.0);
    assert_eq!(merged.frequency.get(&bits_5).copied().unwrap_or(0), 3);
    assert_eq!(merged.count, 5);
}

#[test]
fn test_merge_text_and_bool_frequency() {
    let s1 = compute_range_stats(&[
        CellValue::Text("hello".into()),
        CellValue::Boolean(true),
        n(1.0),
    ]);
    let s2 = compute_range_stats(&[
        CellValue::Text("hello".into()),
        CellValue::Boolean(false),
        CellValue::Boolean(true),
        n(2.0),
    ]);
    let merged = RangeStatistics::merge(&[s1, s2]);
    // "hello" appears in both ranges
    assert_eq!(merged.text_frequency.get("hello").copied().unwrap_or(0), 2);
    // true: 1 + 1 = 2, false: 0 + 1 = 1
    assert_eq!(merged.bool_frequency.get(&true).copied().unwrap_or(0), 2);
    assert_eq!(merged.bool_frequency.get(&false).copied().unwrap_or(0), 1);
    // Numeric stats
    assert_eq!(merged.count, 2);
    assert_eq!(merged.min, 1.0);
    assert_eq!(merged.max, 2.0);
}

#[test]
fn test_merge_std_dev_via_welford() {
    // Tightly clustered large values — naive variance would lose precision
    let base = 1e15;
    let s1 = compute_range_stats(&values_from_f64s(&[base + 1.0, base + 2.0]));
    let s2 = compute_range_stats(&values_from_f64s(&[base + 3.0, base + 4.0]));
    let merged = RangeStatistics::merge(&[s1, s2]);

    // Expected: values [base+1, base+2, base+3, base+4], mean = base+2.5
    // Sample std_dev = sqrt(((−1.5)² + (−0.5)² + (0.5)² + (1.5)²) / 3) = sqrt(5/3) ≈ 1.2909944
    let expected_std_dev = (5.0_f64 / 3.0).sqrt();
    assert!(
        (merged.std_dev - expected_std_dev).abs() < 1e-6,
        "std_dev {} should be close to {} (Welford's precision)",
        merged.std_dev,
        expected_std_dev
    );
}

// -----------------------------------------------------------------------
// Merge of text-only ranges (no numeric values)
// -----------------------------------------------------------------------

#[test]
fn test_merge_text_only_ranges() {
    // In Excel, conditional formatting ranges can contain only text.
    // When merging stats from such ranges, there are no numeric values,
    // but text frequency maps must still be correctly combined.
    let s1 = compute_range_stats(&[
        CellValue::Text("apple".into()),
        CellValue::Text("banana".into()),
        CellValue::Text("Apple".into()), // same as "apple" case-insensitively
    ]);
    let s2 = compute_range_stats(&[
        CellValue::Text("banana".into()),
        CellValue::Text("cherry".into()),
    ]);

    // Pre-merge: verify each range has no numeric data
    assert_eq!(s1.count, 0);
    assert!(s1.sorted_values.is_empty());
    assert_eq!(s2.count, 0);
    assert!(s2.sorted_values.is_empty());

    let merged = RangeStatistics::merge(&[s1, s2]);

    // Numeric stats should all be zero/empty
    assert_eq!(merged.count, 0);
    assert_eq!(merged.min, 0.0);
    assert_eq!(merged.max, 0.0);
    assert_eq!(merged.mean, 0.0);
    assert_eq!(merged.std_dev, 0.0);
    assert!(merged.sorted_values.is_empty());

    // Text frequencies should be merged correctly (case-insensitive keys)
    assert_eq!(
        merged.text_frequency.get("apple").copied().unwrap_or(0),
        2,
        "apple appears twice (Apple + apple)"
    );
    assert_eq!(
        merged.text_frequency.get("banana").copied().unwrap_or(0),
        2,
        "banana appears once in each range"
    );
    assert_eq!(merged.text_frequency.get("cherry").copied().unwrap_or(0), 1);
}

// -----------------------------------------------------------------------
// Merge of boolean-only ranges
// -----------------------------------------------------------------------

#[test]
fn test_merge_boolean_only_ranges() {
    // Excel tracks booleans separately for duplicate detection in CF.
    // Two ranges with only booleans should merge their bool_frequency maps.
    let s1 = compute_range_stats(&[
        CellValue::Boolean(true),
        CellValue::Boolean(true),
        CellValue::Boolean(false),
    ]);
    let s2 = compute_range_stats(&[CellValue::Boolean(false), CellValue::Boolean(false)]);

    assert_eq!(s1.count, 0);
    assert_eq!(s2.count, 0);

    let merged = RangeStatistics::merge(&[s1, s2]);

    assert_eq!(merged.count, 0);
    assert!(merged.sorted_values.is_empty());
    assert_eq!(merged.bool_frequency.get(&true).copied().unwrap_or(0), 2);
    assert_eq!(merged.bool_frequency.get(&false).copied().unwrap_or(0), 3);
}

// -----------------------------------------------------------------------
// Merge preserves numeric_text_frequency across ranges
// -----------------------------------------------------------------------

#[test]
fn test_merge_preserves_numeric_text_frequency() {
    // In Excel, text cells like "100" are coerced to numbers for cross-type
    // duplicate detection (e.g., "100" and 100 are duplicates). The
    // numeric_text_frequency map tracks these parsed values.
    let s1 = compute_range_stats(&[
        CellValue::Text("100".into()),
        CellValue::Text("1.5".into()),
        n(50.0),
    ]);
    let s2 = compute_range_stats(&[
        CellValue::Text("100".into()),
        CellValue::Text("-3".into()),
        n(50.0),
    ]);

    // Verify numeric_text_frequency is built per-range
    let bits_100 = canonical_bits(100.0);
    let bits_1_5 = canonical_bits(1.5);
    let bits_neg3 = canonical_bits(-3.0);

    assert_eq!(
        s1.numeric_text_frequency
            .get(&bits_100)
            .copied()
            .unwrap_or(0),
        1
    );
    assert_eq!(
        s1.numeric_text_frequency
            .get(&bits_1_5)
            .copied()
            .unwrap_or(0),
        1
    );

    let merged = RangeStatistics::merge(&[s1, s2]);

    // numeric_text_frequency should combine: "100" appears in both ranges
    assert_eq!(
        merged
            .numeric_text_frequency
            .get(&bits_100)
            .copied()
            .unwrap_or(0),
        2,
        "100 parsed from text in both ranges"
    );
    assert_eq!(
        merged
            .numeric_text_frequency
            .get(&bits_1_5)
            .copied()
            .unwrap_or(0),
        1
    );
    assert_eq!(
        merged
            .numeric_text_frequency
            .get(&bits_neg3)
            .copied()
            .unwrap_or(0),
        1
    );

    // Numeric frequency for actual Number cells should also merge
    let bits_50 = canonical_bits(50.0);
    assert_eq!(
        merged.frequency.get(&bits_50).copied().unwrap_or(0),
        2,
        "50.0 appears as Number in both ranges"
    );
}

// -----------------------------------------------------------------------
// parse_plain_number: rejects scientific notation, accepts plain numbers
// -----------------------------------------------------------------------

#[test]
fn test_parse_plain_number_rejects_scientific_notation() {
    // Excel only coerces plain decimal text to numbers for CF duplicate
    // detection. Scientific notation like "1e2" is NOT treated as numeric.
    use super::parse_plain_number;

    // Should reject scientific notation
    assert_eq!(parse_plain_number("1e2"), None);
    assert_eq!(parse_plain_number("1.5E3"), None);
    assert_eq!(parse_plain_number("1E0"), None);
    assert_eq!(parse_plain_number("-2.5e10"), None);

    // Should accept plain numbers
    assert_eq!(parse_plain_number("100"), Some(100.0));
    assert_eq!(parse_plain_number("1.5"), Some(1.5));
    assert_eq!(parse_plain_number("-3"), Some(-3.0));
    assert_eq!(parse_plain_number("0"), Some(0.0));
    assert_eq!(parse_plain_number("0.0"), Some(0.0));
    assert_eq!(parse_plain_number("-0"), Some(0.0)); // -0.0 == 0.0

    // Edge cases
    assert_eq!(parse_plain_number(""), None);
    assert_eq!(parse_plain_number("abc"), None);
    assert_eq!(parse_plain_number("12.34.56"), None);
}

// -----------------------------------------------------------------------
// canonical_bits: NaN consistency and -0.0/+0.0 normalization
// -----------------------------------------------------------------------

#[test]
fn test_canonical_bits_nan_consistent() {
    // All NaN representations must produce the same canonical bits,
    // so that frequency maps don't fragment NaN entries.
    let nan1 = f64::NAN;
    let nan2 = -f64::NAN;
    let nan3 = f64::from_bits(0x7FF0_0000_0000_0001); // signaling NaN

    let bits1 = canonical_bits(nan1);
    let bits2 = canonical_bits(nan2);
    let bits3 = canonical_bits(nan3);

    assert_eq!(bits1, bits2, "NaN and -NaN must have same canonical bits");
    assert_eq!(bits1, bits3, "All NaN variants must canonicalize the same");
    assert_eq!(bits1, CANONICAL_NAN_BITS);
}

#[test]
fn test_canonical_bits_negative_zero_normalized() {
    // -0.0 and +0.0 are equal in IEEE 754 but have different bit patterns.
    // For frequency counting, they must map to the same key.
    let pos_zero = canonical_bits(0.0);
    let neg_zero = canonical_bits(-0.0);

    assert_eq!(
        pos_zero, neg_zero,
        "+0.0 and -0.0 must have same canonical bits"
    );
    assert_eq!(pos_zero, 0.0_f64.to_bits());
}

#[test]
fn test_canonical_bits_normal_values_unchanged() {
    // For regular finite non-zero values, canonical_bits should just be to_bits()
    assert_eq!(canonical_bits(1.0), 1.0_f64.to_bits());
    assert_eq!(canonical_bits(-1.0), (-1.0_f64).to_bits());
    assert_eq!(canonical_bits(42.5), 42.5_f64.to_bits());
}

// -----------------------------------------------------------------------
// compute_range_stats with mixed types: text + numbers + booleans
// -----------------------------------------------------------------------

#[test]
fn test_compute_range_stats_mixed_types_all_frequency_maps() {
    // Excel CF ranges often contain a mix of types. All frequency maps
    // should be populated correctly for duplicate detection rules.
    let values = vec![
        n(10.0),
        n(20.0),
        n(10.0), // duplicate number
        CellValue::Text("hello".into()),
        CellValue::Text("Hello".into()), // same as "hello" case-insensitively
        CellValue::Text("100".into()),   // numeric text — should appear in numeric_text_frequency
        CellValue::Boolean(true),
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        CellValue::Null, // ignored
    ];
    let stats = compute_range_stats(&values);

    // Numeric stats: only actual Number cells
    assert_eq!(stats.count, 3);
    assert_eq!(stats.min, 10.0);
    assert_eq!(stats.max, 20.0);
    assert_eq!(stats.sorted_values, vec![10.0, 10.0, 20.0]);

    // Numeric frequency
    assert_eq!(
        stats
            .frequency
            .get(&canonical_bits(10.0))
            .copied()
            .unwrap_or(0),
        2
    );
    assert_eq!(
        stats
            .frequency
            .get(&canonical_bits(20.0))
            .copied()
            .unwrap_or(0),
        1
    );

    // Text frequency (case-insensitive)
    assert_eq!(stats.text_frequency.get("hello").copied().unwrap_or(0), 2);
    assert_eq!(stats.text_frequency.get("100").copied().unwrap_or(0), 1);

    // Boolean frequency
    assert_eq!(stats.bool_frequency.get(&true).copied().unwrap_or(0), 2);
    assert_eq!(stats.bool_frequency.get(&false).copied().unwrap_or(0), 1);

    // numeric_text_frequency: "100" parses as 100.0
    let bits_100 = canonical_bits(100.0);
    assert_eq!(
        stats
            .numeric_text_frequency
            .get(&bits_100)
            .copied()
            .unwrap_or(0),
        1,
        "text '100' should be tracked in numeric_text_frequency"
    );
    // "hello" does not parse as a number
    assert!(
        stats.numeric_text_frequency.len() == 1,
        "only '100' should be in numeric_text_frequency"
    );
}

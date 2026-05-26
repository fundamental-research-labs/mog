use super::*;
use crate::test_helpers::stats_from_values;
use value_types::FiniteF64;

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

// -----------------------------------------------------------------------
// Top 3 values
// -----------------------------------------------------------------------

#[test]
fn test_top_3_values() {
    // sorted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    let stats = stats_from_values(&[5.0, 3.0, 8.0, 1.0, 10.0, 7.0, 2.0, 6.0, 9.0, 4.0]);

    // rank=3, not percent, not bottom -> top 3
    // index = min(3-1, 9) = 2; threshold = sorted[10-1-2] = sorted[7] = 8.0
    assert!(evaluate_top_bottom(&n(10.0), 3, false, false, &stats));
    assert!(evaluate_top_bottom(&n(9.0), 3, false, false, &stats));
    assert!(evaluate_top_bottom(&n(8.0), 3, false, false, &stats));
    // 7.0 < 8.0 threshold
    assert!(!evaluate_top_bottom(&n(7.0), 3, false, false, &stats));
    assert!(!evaluate_top_bottom(&n(1.0), 3, false, false, &stats));
}

// -----------------------------------------------------------------------
// Bottom 3 values
// -----------------------------------------------------------------------

#[test]
fn test_bottom_3_values() {
    let stats = stats_from_values(&[5.0, 3.0, 8.0, 1.0, 10.0, 7.0, 2.0, 6.0, 9.0, 4.0]);

    // rank=3, not percent, bottom -> bottom 3
    // index = min(2, 9) = 2; threshold = sorted[2] = 3.0
    assert!(evaluate_top_bottom(&n(1.0), 3, false, true, &stats));
    assert!(evaluate_top_bottom(&n(2.0), 3, false, true, &stats));
    assert!(evaluate_top_bottom(&n(3.0), 3, false, true, &stats));
    // 4.0 > 3.0 threshold
    assert!(!evaluate_top_bottom(&n(4.0), 3, false, true, &stats));
    assert!(!evaluate_top_bottom(&n(10.0), 3, false, true, &stats));
}

// -----------------------------------------------------------------------
// Top 10%
// -----------------------------------------------------------------------

#[test]
fn test_top_10_percent() {
    // 10 values: [1..10]. Top 10% = values >= 90th percentile.
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]);

    // percent=true, bottom=false, rank=10
    // p = (100-10)/100 = 0.9
    // percentile([1..10], 0.9) = 0.9 * 9 = 8.1 -> sorted[8] + 0.1*(sorted[9]-sorted[8]) = 9 + 0.1*1 = 9.1
    assert!(evaluate_top_bottom(&n(10.0), 10, true, false, &stats));
    assert!(evaluate_top_bottom(&n(9.1), 10, true, false, &stats)); // 9.1 >= 9.1
    assert!(!evaluate_top_bottom(&n(9.0), 10, true, false, &stats)); // 9.0 < 9.1
}

// -----------------------------------------------------------------------
// Bottom 10%
// -----------------------------------------------------------------------

#[test]
fn test_bottom_10_percent() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]);

    // percent=true, bottom=true, rank=10
    // p = 10/100 = 0.1
    // percentile([1..10], 0.1) = 0.1*9 = 0.9 -> sorted[0] + 0.9*(sorted[1]-sorted[0]) = 1 + 0.9 = 1.9
    assert!(evaluate_top_bottom(&n(1.0), 10, true, true, &stats)); // 1.0 <= 1.9
    assert!(evaluate_top_bottom(&n(1.9), 10, true, true, &stats)); // 1.9 <= 1.9
    assert!(!evaluate_top_bottom(&n(2.0), 10, true, true, &stats)); // 2.0 > 1.9
}

// -----------------------------------------------------------------------
// Rank greater than count
// -----------------------------------------------------------------------

#[test]
fn test_rank_greater_than_count() {
    // 5 values, rank=10
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // Top 10, but only 5 values -> index = min(9, 4) = 4
    // threshold = sorted[5-1-4] = sorted[0] = 1.0
    // Everything >= 1.0 matches
    assert!(evaluate_top_bottom(&n(1.0), 10, false, false, &stats));
    assert!(evaluate_top_bottom(&n(5.0), 10, false, false, &stats));

    // Bottom 10, but only 5 values -> index = min(9, 4) = 4
    // threshold = sorted[4] = 5.0
    // Everything <= 5.0 matches
    assert!(evaluate_top_bottom(&n(5.0), 10, false, true, &stats));
    assert!(evaluate_top_bottom(&n(1.0), 10, false, true, &stats));
}

// -----------------------------------------------------------------------
// Empty stats
// -----------------------------------------------------------------------

#[test]
fn test_empty_stats() {
    let stats = RangeStatistics::default();

    assert!(!evaluate_top_bottom(&n(5.0), 3, false, false, &stats));
    assert!(!evaluate_top_bottom(&n(5.0), 3, true, false, &stats));
}

// -----------------------------------------------------------------------
// Non-numeric values
// -----------------------------------------------------------------------

#[test]
fn test_non_numeric_values() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0]);

    assert!(!evaluate_top_bottom(
        &CellValue::Text("hello".into()),
        1,
        false,
        false,
        &stats
    ));
    assert!(!evaluate_top_bottom(
        &CellValue::Boolean(true),
        1,
        false,
        false,
        &stats
    ));
    assert!(!evaluate_top_bottom(
        &CellValue::Null,
        1,
        false,
        false,
        &stats
    ));
}

// -----------------------------------------------------------------------
// Top 1 (single top value)
// -----------------------------------------------------------------------

#[test]
fn test_top_1() {
    let stats = stats_from_values(&[10.0, 20.0, 30.0]);

    // rank=1, top -> index=0, threshold = sorted[2-0] = sorted[2] = 30.0
    assert!(evaluate_top_bottom(&n(30.0), 1, false, false, &stats));
    assert!(!evaluate_top_bottom(&n(20.0), 1, false, false, &stats));
}

// -----------------------------------------------------------------------
// Bottom 1 (single bottom value)
// -----------------------------------------------------------------------

#[test]
fn test_bottom_1() {
    let stats = stats_from_values(&[10.0, 20.0, 30.0]);

    // rank=1, bottom -> index=0, threshold = sorted[0] = 10.0
    assert!(evaluate_top_bottom(&n(10.0), 1, false, true, &stats));
    assert!(!evaluate_top_bottom(&n(20.0), 1, false, true, &stats));
}

// -----------------------------------------------------------------------
// Rank = 0 edge case
// -----------------------------------------------------------------------

#[test]
fn test_rank_zero_returns_none() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // Top 0 should match nothing
    assert!(!evaluate_top_bottom(&n(5.0), 0, false, false, &stats));
    // Bottom 0 should match nothing
    assert!(!evaluate_top_bottom(&n(1.0), 0, false, true, &stats));
    // Top 0% should match nothing
    assert!(!evaluate_top_bottom(&n(5.0), 0, true, false, &stats));
    // Bottom 0% should match nothing
    assert!(!evaluate_top_bottom(&n(1.0), 0, true, true, &stats));
}

// -----------------------------------------------------------------------
// All same values
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Rank > 100 with percent=true should not panic (u32 underflow guard)
// -----------------------------------------------------------------------

#[test]
fn test_rank_over_100_percent_no_panic() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // rank=150, percent=true, bottom=false
    // saturating_sub: 100 - 150 = 0, so p = 0.0
    // percentile at 0.0 = min value = 1.0
    // Everything >= 1.0 matches (i.e., all values)
    assert!(evaluate_top_bottom(&n(1.0), 150, true, false, &stats));
    assert!(evaluate_top_bottom(&n(5.0), 150, true, false, &stats));
    assert!(evaluate_top_bottom(&n(3.0), 150, true, false, &stats));

    // rank=150, percent=true, bottom=true
    // min(150, 100) = 100, so p = 1.0
    // percentile at 1.0 = max value = 5.0
    // Everything <= 5.0 matches (i.e., all values)
    assert!(evaluate_top_bottom(&n(1.0), 150, true, true, &stats));
    assert!(evaluate_top_bottom(&n(5.0), 150, true, true, &stats));
}

// -----------------------------------------------------------------------
// All same values
// -----------------------------------------------------------------------

#[test]
fn test_all_same_values() {
    let stats = stats_from_values(&[5.0, 5.0, 5.0, 5.0]);

    // Top 1: threshold = 5.0, 5.0 >= 5.0 -> matches
    assert!(evaluate_top_bottom(&n(5.0), 1, false, false, &stats));
    // Bottom 1: threshold = 5.0, 5.0 <= 5.0 -> matches
    assert!(evaluate_top_bottom(&n(5.0), 1, false, true, &stats));
}

// -----------------------------------------------------------------------
// Top 100% and Bottom 100% (should match everything)
// -----------------------------------------------------------------------

#[test]
fn test_top_100_percent_matches_all() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // Top 100%: p = (100-100)/100 = 0.0 -> percentile at 0.0 = min = 1.0
    // Everything >= 1.0 matches
    assert!(evaluate_top_bottom(&n(1.0), 100, true, false, &stats));
    assert!(evaluate_top_bottom(&n(3.0), 100, true, false, &stats));
    assert!(evaluate_top_bottom(&n(5.0), 100, true, false, &stats));
}

#[test]
fn test_bottom_100_percent_matches_all() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // Bottom 100%: p = min(100, 100)/100 = 1.0 -> percentile at 1.0 = max = 5.0
    // Everything <= 5.0 matches
    assert!(evaluate_top_bottom(&n(1.0), 100, true, true, &stats));
    assert!(evaluate_top_bottom(&n(3.0), 100, true, true, &stats));
    assert!(evaluate_top_bottom(&n(5.0), 100, true, true, &stats));
}

// -----------------------------------------------------------------------
// Single-element range
// -----------------------------------------------------------------------

#[test]
fn test_single_element_range() {
    let stats = stats_from_values(&[42.0]);

    // Top 1 of single element: 42.0 >= 42.0 -> matches
    assert!(evaluate_top_bottom(&n(42.0), 1, false, false, &stats));
    // Bottom 1 of single element: 42.0 <= 42.0 -> matches
    assert!(evaluate_top_bottom(&n(42.0), 1, false, true, &stats));
    // Top 50% of single element: p = (100-50)/100 = 0.5 -> percentile at 0.5 = 42.0
    // 42.0 >= 42.0 -> matches
    assert!(evaluate_top_bottom(&n(42.0), 50, true, false, &stats));
    // A different value should not match top 1
    assert!(!evaluate_top_bottom(&n(41.0), 1, false, false, &stats));
}

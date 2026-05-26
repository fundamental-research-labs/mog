use super::*;
use crate::test_helpers::stats_from_values;
use value_types::FiniteF64;

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

// -----------------------------------------------------------------------
// Above average (no equal, no std_dev)
// -----------------------------------------------------------------------

#[test]
fn test_above_average() {
    // Values: [1, 2, 3, 4, 5], mean = 3.0
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // above=true, equal_average=false, std_dev_count=0
    assert!(evaluate_above_average(&n(4.0), true, false, 0, &stats));
    assert!(evaluate_above_average(&n(5.0), true, false, 0, &stats));
    // Equal to mean: should NOT match (equal_average=false)
    assert!(!evaluate_above_average(&n(3.0), true, false, 0, &stats));
    assert!(!evaluate_above_average(&n(2.0), true, false, 0, &stats));
}

// -----------------------------------------------------------------------
// Below average (no equal, no std_dev)
// -----------------------------------------------------------------------

#[test]
fn test_below_average() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // above=false, equal_average=false, std_dev_count=0
    assert!(evaluate_above_average(&n(2.0), false, false, 0, &stats));
    assert!(evaluate_above_average(&n(1.0), false, false, 0, &stats));
    // Equal to mean: should NOT match
    assert!(!evaluate_above_average(&n(3.0), false, false, 0, &stats));
    assert!(!evaluate_above_average(&n(4.0), false, false, 0, &stats));
}

// -----------------------------------------------------------------------
// Above average with equal
// -----------------------------------------------------------------------

#[test]
fn test_above_average_with_equal() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // above=true, equal_average=true, std_dev_count=0
    // Equal to mean: should match now
    assert!(evaluate_above_average(&n(3.0), true, true, 0, &stats));
    assert!(evaluate_above_average(&n(4.0), true, true, 0, &stats));
    assert!(!evaluate_above_average(&n(2.0), true, true, 0, &stats));
}

// -----------------------------------------------------------------------
// Below average with equal
// -----------------------------------------------------------------------

#[test]
fn test_below_average_with_equal() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);

    // above=false, equal_average=true, std_dev_count=0
    assert!(evaluate_above_average(&n(3.0), false, true, 0, &stats));
    assert!(evaluate_above_average(&n(2.0), false, true, 0, &stats));
    assert!(!evaluate_above_average(&n(4.0), false, true, 0, &stats));
}

// -----------------------------------------------------------------------
// Above average with 1 std_dev
// -----------------------------------------------------------------------

#[test]
fn test_above_average_with_1_std_dev() {
    // Values: [10, 20, 30, 40, 50], mean=30, sample stddev=sqrt(250)~=15.811
    let stats = stats_from_values(&[10.0, 20.0, 30.0, 40.0, 50.0]);

    // threshold = mean + 1*stddev = 30 + 15.811 = 45.811
    // above=true, equal_average=false, std_dev_count=1
    assert!(evaluate_above_average(&n(50.0), true, false, 1, &stats));
    assert!(evaluate_above_average(&n(46.0), true, false, 1, &stats));
    assert!(!evaluate_above_average(&n(45.0), true, false, 1, &stats));
    assert!(!evaluate_above_average(&n(30.0), true, false, 1, &stats));
}

// -----------------------------------------------------------------------
// Below average with 1 std_dev
// -----------------------------------------------------------------------

#[test]
fn test_below_average_with_1_std_dev() {
    // Values: [10, 20, 30, 40, 50], mean=30, sample stddev=sqrt(250)~=15.811
    let stats = stats_from_values(&[10.0, 20.0, 30.0, 40.0, 50.0]);

    // threshold = mean - 1*stddev = 30 - 15.811 = 14.189
    // above=false, equal_average=false, std_dev_count=1
    assert!(evaluate_above_average(&n(10.0), false, false, 1, &stats));
    assert!(evaluate_above_average(&n(14.0), false, false, 1, &stats));
    assert!(!evaluate_above_average(&n(15.0), false, false, 1, &stats));
    assert!(!evaluate_above_average(&n(30.0), false, false, 1, &stats));
}

// -----------------------------------------------------------------------
// Above average with 2 std_dev
// -----------------------------------------------------------------------

#[test]
fn test_above_average_with_2_std_dev() {
    // Values: [10, 20, 30, 40, 50], mean=30, sample stddev=sqrt(250)~=15.811
    let stats = stats_from_values(&[10.0, 20.0, 30.0, 40.0, 50.0]);

    // threshold = mean + 2*stddev = 30 + 31.623 = 61.623
    // above=true, equal_average=false, std_dev_count=2
    assert!(evaluate_above_average(&n(62.0), true, false, 2, &stats));
    // 50.0 < 61.623
    assert!(!evaluate_above_average(&n(50.0), true, false, 2, &stats));
}

// -----------------------------------------------------------------------
// Empty stats
// -----------------------------------------------------------------------

#[test]
fn test_empty_stats() {
    let stats = RangeStatistics::default();

    assert!(!evaluate_above_average(&n(5.0), true, false, 0, &stats));
    assert!(!evaluate_above_average(&n(5.0), false, true, 1, &stats));
}

// -----------------------------------------------------------------------
// Non-numeric values
// -----------------------------------------------------------------------

#[test]
fn test_non_numeric_values() {
    let stats = stats_from_values(&[1.0, 2.0, 3.0]);

    assert!(!evaluate_above_average(
        &CellValue::Text("hello".into()),
        true,
        false,
        0,
        &stats,
    ));
    assert!(!evaluate_above_average(
        &CellValue::Boolean(true),
        true,
        false,
        0,
        &stats
    ));
    assert!(!evaluate_above_average(
        &CellValue::Null,
        true,
        false,
        0,
        &stats
    ));
}

// -----------------------------------------------------------------------
// All same values
// -----------------------------------------------------------------------

#[test]
fn test_all_same_values() {
    // All values = 5.0, mean=5.0, std_dev=0.0
    let stats = stats_from_values(&[5.0, 5.0, 5.0, 5.0]);

    // above, no equal: 5.0 > 5.0 is false
    assert!(!evaluate_above_average(&n(5.0), true, false, 0, &stats));
    // above, with equal: 5.0 >= 5.0 is true
    assert!(evaluate_above_average(&n(5.0), true, true, 0, &stats));
    // below, no equal: 5.0 < 5.0 is false
    assert!(!evaluate_above_average(&n(5.0), false, false, 0, &stats));
    // below, with equal: 5.0 <= 5.0 is true
    assert!(evaluate_above_average(&n(5.0), false, true, 0, &stats));
}

// -----------------------------------------------------------------------
// Std dev with equal_average
// -----------------------------------------------------------------------

#[test]
fn test_std_dev_with_equal_average() {
    let stats = stats_from_values(&[10.0, 20.0, 30.0, 40.0, 50.0]);

    // threshold = mean + 1*stddev = 30 + 15.811 = 45.811
    // above=true, equal_average=true, std_dev_count=1
    let threshold = stats.mean + stats.std_dev;

    // Value exactly at threshold should match with equal_average
    assert!(evaluate_above_average(&n(threshold), true, true, 1, &stats,));
    // Without equal_average, exact threshold should NOT match
    assert!(!evaluate_above_average(
        &n(threshold),
        true,
        false,
        1,
        &stats,
    ));
}

// -----------------------------------------------------------------------
// Error cell values are excluded
// -----------------------------------------------------------------------

#[test]
fn test_error_cell_excluded() {
    use value_types::CellError;
    let stats = stats_from_values(&[1.0, 2.0, 3.0, 4.0, 5.0]);
    let result = evaluate_above_average(
        &CellValue::Error(CellError::Value, None),
        true,
        false,
        0,
        &stats,
    );
    assert!(!result);
}

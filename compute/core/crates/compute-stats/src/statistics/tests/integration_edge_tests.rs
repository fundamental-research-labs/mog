use super::*;

#[test]
fn test_single_element_across_functions() {
    let data = [42.0];
    assert_approx!(mean(&data), 42.0);
    assert_approx!(median(&data), 42.0);
    assert_approx!(variance(&data), 0.0);
    assert!(sample_variance(&data).is_nan());
    assert_approx!(std_dev(&data), 0.0);
    assert_approx!(min_val(&data), 42.0);
    assert_approx!(max_val(&data), 42.0);
    assert_approx!(range(&data), 0.0);
    assert_approx!(sum(&data), 42.0);
    assert_approx!(iqr(&data), 0.0);
}

// =========================================================================
// Edge case: two elements
// =========================================================================

#[test]
fn test_two_elements() {
    let data = [10.0, 20.0];
    assert_approx!(mean(&data), 15.0);
    assert_approx!(median(&data), 15.0);
    assert_approx!(variance(&data), 25.0);
    assert_approx!(sample_variance(&data), 50.0);
}

// =========================================================================
// Large dataset smoke test
// =========================================================================

#[test]
fn test_large_dataset() {
    let data: Vec<f64> = (0..10000).map(|i| (i as f64) / 100.0).collect();
    let m = mean(&data);
    assert!(m > 49.0 && m < 51.0);
    let s = std_dev(&data);
    assert!(s > 0.0);
    let h = silverman_bandwidth(&data);
    assert!(h > 0.0 && h.is_finite());
}

// =========================================================================
// Numerical stability (Welford + Kahan upgrades)

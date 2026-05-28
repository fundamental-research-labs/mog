use super::*;

#[test]
fn test_mean_empty() {
    assert!(mean(&[]).is_nan());
}

#[test]
fn test_mean_single() {
    assert_approx!(mean(&[42.0]), 42.0);
}

#[test]
fn test_mean_basic() {
    assert_approx!(mean(&[1.0, 2.0, 3.0, 4.0, 5.0]), 3.0);
}

#[test]
fn test_mean_negative() {
    assert_approx!(mean(&[-2.0, -1.0, 0.0, 1.0, 2.0]), 0.0);
}

#[test]
fn test_mean_all_same() {
    assert_approx!(mean(&[7.0, 7.0, 7.0]), 7.0);
}

// =========================================================================
// median
// =========================================================================

#[test]
fn test_median_empty() {
    assert!(median(&[]).is_nan());
}

#[test]
fn test_median_single() {
    assert_approx!(median(&[5.0]), 5.0);
}

#[test]
fn test_median_odd() {
    assert_approx!(median(&[3.0, 1.0, 2.0]), 2.0);
}

#[test]
fn test_median_even() {
    assert_approx!(median(&[1.0, 2.0, 3.0, 4.0]), 2.5);
}

// =========================================================================
// variance / sample_variance / std_dev / sample_std_dev
// =========================================================================

#[test]
fn test_variance_empty() {
    assert!(variance(&[]).is_nan());
}

#[test]
fn test_variance_single() {
    assert_approx!(variance(&[5.0]), 0.0);
}

#[test]
fn test_variance_known() {
    // [2, 4, 4, 4, 5, 5, 7, 9] mean=5, pop_var=4
    let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
    assert_approx!(variance(&data), 4.0);
}

#[test]
fn test_sample_variance_less_than_2() {
    assert!(sample_variance(&[]).is_nan());
    assert!(sample_variance(&[1.0]).is_nan());
}

#[test]
fn test_sample_variance_known() {
    // [2, 4, 4, 4, 5, 5, 7, 9] sample_var = 32/7
    let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
    assert_approx!(sample_variance(&data), 32.0 / 7.0, 1e-10);
}

#[test]
fn test_std_dev_known() {
    let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
    assert_approx!(std_dev(&data), 2.0);
}

#[test]
fn test_sample_std_dev_known() {
    let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
    assert_approx!(sample_std_dev(&data), (32.0_f64 / 7.0).sqrt(), 1e-10);
}

#[test]
fn test_std_dev_empty() {
    assert!(std_dev(&[]).is_nan());
}

#[test]
fn test_variance_all_same() {
    assert_approx!(variance(&[3.0, 3.0, 3.0, 3.0]), 0.0);
}

// =========================================================================
// min_val / max_val / range / sum
// =========================================================================

#[test]
fn test_min_val_empty() {
    assert_eq!(min_val(&[]), f64::INFINITY);
}

#[test]
fn test_max_val_empty() {
    assert_eq!(max_val(&[]), f64::NEG_INFINITY);
}

#[test]
fn test_min_max_basic() {
    let data = [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0];
    assert_approx!(min_val(&data), 1.0);
    assert_approx!(max_val(&data), 9.0);
}

#[test]
fn test_min_max_negative() {
    let data = [-5.0, -1.0, -3.0];
    assert_approx!(min_val(&data), -5.0);
    assert_approx!(max_val(&data), -1.0);
}

#[test]
fn test_range_empty() {
    assert!(range(&[]).is_nan());
}

#[test]
fn test_range_basic() {
    assert_approx!(range(&[1.0, 5.0, 3.0]), 4.0);
}

#[test]
fn test_range_all_same() {
    assert_approx!(range(&[7.0, 7.0, 7.0]), 0.0);
}

#[test]
fn test_sum_empty() {
    assert_approx!(sum(&[]), 0.0);
}

#[test]
fn test_sum_basic() {
    assert_approx!(sum(&[1.0, 2.0, 3.0, 4.0, 5.0]), 15.0);
}

// =========================================================================
// quantile

#[test]
fn test_sum_kahan_compensated() {
    // Without Kahan: 1e15 + 1.0 - 1e15 = 0.0 (catastrophic cancellation).
    assert_approx!(sum(&[1e15, 1.0, -1e15]), 1.0);
}

#[test]
fn test_sum_many_small_values() {
    // 10,000 copies of 0.1 — naive sum accumulates error.
    let data: Vec<f64> = vec![0.1; 10_000];
    assert!((sum(&data) - 1000.0).abs() < 1e-10);
}

#[test]
fn test_mean_kahan_compensated() {
    assert_approx!(mean(&[1e15, 1.0, -1e15]), 1.0 / 3.0, 1e-10);
}

#[test]
fn test_variance_welford_large_offset() {
    // Values close together with large magnitude — naive two-pass fails.
    let data: Vec<f64> = (1..=10).map(|i| 1e12 + i as f64).collect();
    // Population variance of [1,2,...,10] = 8.25
    assert_approx!(variance(&data), 8.25, 1e-6);
}

#[test]
fn test_sample_variance_welford_large_offset() {
    let data: Vec<f64> = (1..=10).map(|i| 1e12 + i as f64).collect();
    // Sample variance = 8.25 * 10/9 ≈ 9.1667
    assert_approx!(sample_variance(&data), 8.25 * 10.0 / 9.0, 1e-6);
}

#[test]
fn test_variance_two_elements() {
    // [4, 8]: mean=6, pop_var = ((4-6)^2 + (8-6)^2)/2 = (4+4)/2 = 4.0
    assert_approx!(variance(&[4.0, 8.0]), 4.0, 1e-10);
}

#[test]
fn test_sample_variance_two_elements() {
    // [4, 8]: mean=6, sample_var = ((4-6)^2 + (8-6)^2)/1 = 8.0
    assert_approx!(sample_variance(&[4.0, 8.0]), 8.0, 1e-10);
}

#[test]
fn test_variance_relationship_pop_sample() {
    // sample_var = pop_var * n/(n-1)
    let data = [1.0, 3.0, 5.0, 7.0, 9.0];
    let n = data.len() as f64;
    let pop = variance(&data);
    let samp = sample_variance(&data);
    assert_approx!(samp, pop * n / (n - 1.0), 1e-10);
}

// =========================================================================
// First-principles: Outlier detection (Tukey)
// =========================================================================

use super::*;

#[test]
fn test_quantile_empty() {
    assert!(quantile(&[], 0.5).is_nan());
}

#[test]
fn test_quantile_single() {
    assert_approx!(quantile(&[42.0], 0.0), 42.0);
    assert_approx!(quantile(&[42.0], 0.5), 42.0);
    assert_approx!(quantile(&[42.0], 1.0), 42.0);
}

#[test]
#[should_panic(expected = "Quantile p must be in range")]
fn test_quantile_out_of_range_low() {
    let _ = quantile(&[1.0, 2.0], -0.1);
}

#[test]
#[should_panic(expected = "Quantile p must be in range")]
fn test_quantile_out_of_range_high() {
    let _ = quantile(&[1.0, 2.0], 1.1);
}

#[test]
fn test_quantile_endpoints() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    assert_approx!(quantile(&data, 0.0), 1.0);
    assert_approx!(quantile(&data, 1.0), 5.0);
}

#[test]
fn test_quantile_r7_interpolation() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    assert_approx!(quantile(&data, 0.25), 2.0);
    assert_approx!(quantile(&data, 0.75), 4.0);
}

#[test]
fn test_quantile_interpolation_between() {
    let data = [1.0, 2.0, 3.0, 4.0];
    assert_approx!(quantile(&data, 0.1), 1.3, 1e-10);
}

#[test]
fn test_quantile_unsorted_input() {
    let data = [5.0, 1.0, 3.0, 2.0, 4.0];
    assert_approx!(quantile(&data, 0.5), 3.0);
}

// =========================================================================
// quartiles / iqr
// =========================================================================

#[test]
fn test_quartiles_basic() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let q = quartiles(&data);
    assert_approx!(q.q1, 3.25, 1e-10);
    assert_approx!(q.median, 5.5, 1e-10);
    assert_approx!(q.q3, 7.75, 1e-10);
}

#[test]
fn test_iqr_empty() {
    assert!(iqr(&[]).is_nan());
}

#[test]
fn test_iqr_basic() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    assert_approx!(iqr(&data), 4.5, 1e-10);
}

#[test]
fn test_quantile_median_4elem() {
    // [1,2,3,4] at p=0.5: index = 3*0.5 = 1.5
    // interpolate between sorted[1]=2 and sorted[2]=3 => 2.5
    let data = [1.0, 2.0, 3.0, 4.0];
    assert_approx!(quantile(&data, 0.5), 2.5, 1e-10);
}

#[test]
#[should_panic(expected = "Quantile p must be in range")]
fn test_quantile_negative_p() {
    let _ = quantile(&[1.0, 2.0, 3.0], -0.01);
}

#[test]
#[should_panic(expected = "Quantile p must be in range")]
fn test_quantile_p_above_one() {
    let _ = quantile(&[1.0, 2.0, 3.0], 1.01);
}

// =========================================================================
// First-principles: KDE sanity checks

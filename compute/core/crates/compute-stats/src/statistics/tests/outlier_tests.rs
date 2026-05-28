use super::*;

#[test]
fn test_outlier_bounds_basic() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let bounds = outlier_bounds(&data, 1.5);
    assert_approx!(bounds.lower, -3.5, 1e-10);
    assert_approx!(bounds.upper, 14.5, 1e-10);
}

#[test]
fn test_outliers_with_outlier() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
    let out = outliers(&data, 1.5);
    assert!(out.contains(&100.0));
}

#[test]
fn test_remove_outliers_basic() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
    let clean = remove_outliers(&data, 1.5);
    assert!(!clean.contains(&100.0));
    for v in &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0] {
        assert!(clean.contains(v), "Expected {} in cleaned data", v);
    }
}

#[test]
fn test_outliers_with_larger_multiplier() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
    let out = outliers(&data, 3.0);
    assert!(out.contains(&100.0));
}

// =========================================================================
// covariance / sample_covariance / correlation

#[test]
fn test_outlier_bounds_with_outlier_dataset() {
    // [1,2,3,4,5,6,7,8,9,100]
    // R-7 Q1: index = 9*0.25 = 2.25 => 3 + 0.25*(4-3) = 3.25
    // R-7 Q3: index = 9*0.75 = 6.75 => 7 + 0.75*(8-7) = 7.75
    // IQR = 4.5, lower = 3.25 - 6.75 = -3.5, upper = 7.75 + 6.75 = 14.5
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
    let bounds = outlier_bounds(&data, 1.5);
    assert_approx!(bounds.lower, -3.5, 1e-10);
    assert_approx!(bounds.upper, 14.5, 1e-10);
}

#[test]
fn test_outliers_exact_set() {
    // Only 100 should be an outlier (>14.5). 1 is within [-3.5, 14.5].
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
    let out = outliers(&data, 1.5);
    assert_eq!(out.len(), 1);
    assert_approx!(out[0], 100.0);
}

#[test]
fn test_outliers_none_when_clean() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let out = outliers(&data, 1.5);
    assert!(out.is_empty());
}

// =========================================================================
// First-principles: Z-scores
// =========================================================================

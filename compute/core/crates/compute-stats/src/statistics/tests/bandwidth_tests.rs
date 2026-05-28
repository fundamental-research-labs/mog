use super::*;

#[test]
fn test_silverman_bandwidth_empty() {
    assert_approx!(silverman_bandwidth(&[]), 1.0);
}

#[test]
fn test_silverman_bandwidth_all_same() {
    assert_approx!(silverman_bandwidth(&[5.0, 5.0, 5.0, 5.0]), 1.0);
}

#[test]
fn test_silverman_bandwidth_positive() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let h = silverman_bandwidth(&data);
    assert!(h > 0.0);
    assert!(h.is_finite());
}

#[test]
fn test_scott_bandwidth_empty() {
    assert_approx!(scott_bandwidth(&[]), 1.0);
}

#[test]
fn test_scott_bandwidth_all_same() {
    assert_approx!(scott_bandwidth(&[3.0, 3.0, 3.0]), 1.0);
}

#[test]
fn test_scott_bandwidth_positive() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let h = scott_bandwidth(&data);
    assert!(h > 0.0);
    assert!(h.is_finite());
}

// =========================================================================

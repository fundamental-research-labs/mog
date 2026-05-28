use super::*;

#[test]
fn test_sturges_bins_zero() {
    assert_eq!(sturges_bins(0), 1);
}

#[test]
fn test_sturges_bins_one() {
    assert_eq!(sturges_bins(1), 1);
}

#[test]
fn test_sturges_bins_typical() {
    assert_eq!(sturges_bins(100), 8);
}

#[test]
fn test_sturges_bins_power_of_2() {
    assert_eq!(sturges_bins(8), 4);
}

#[test]
fn test_freedman_diaconis_bins_empty() {
    assert_eq!(freedman_diaconis_bins(&[]), 1);
}

#[test]
fn test_freedman_diaconis_bins_all_same() {
    assert_eq!(freedman_diaconis_bins(&[5.0; 10]), sturges_bins(10));
}

#[test]
fn test_freedman_diaconis_bins_positive() {
    let data: Vec<f64> = (1..=100).map(|x| x as f64).collect();
    let bins = freedman_diaconis_bins(&data);
    assert!(bins >= 1);
    assert!(bins <= 100);
}

// =========================================================================
// Edge case: single element across various functions

#[test]
fn test_sturges_bins_1024() {
    // log2(1024) = 10, ceil(10 + 1) = 11
    assert_eq!(sturges_bins(1024), 11);
}

#[test]
fn test_sturges_bins_8() {
    // log2(8) = 3, ceil(3 + 1) = 4
    assert_eq!(sturges_bins(8), 4);
}

#[test]
fn test_freedman_diaconis_constant_falls_back() {
    // Constant data: IQR=0 => falls back to sturges
    let data = vec![3.0; 50];
    assert_eq!(freedman_diaconis_bins(&data), sturges_bins(data.len()));
}

use crate::transforms::bin::{calculate_bins, histogram};

#[test]
fn bin_very_small_range() {
    let values = vec![1.0001, 1.0002, 1.0003, 1.0004];
    let result = histogram(&values, Some(4), None, Some(true));
    let total: usize = result.iter().map(|b| b.count).sum();
    assert_eq!(total, 4);
}

#[test]
fn bin_large_dataset() {
    let values: Vec<f64> = (0..10000).map(|i| (i as f64) / 100.0).collect();
    let result = histogram(&values, Some(20), None, Some(true));
    let total: usize = result.iter().map(|b| b.count).sum();
    assert_eq!(total, 10000);
}

#[test]
fn bin_two_values_wide_apart() {
    let values = vec![0.0, 1_000_000.0];
    let bins = calculate_bins(&values, Some(10), None, Some(true));
    assert!(bins.count >= 1);
    assert!(bins.start <= 0.0);
    assert!(bins.stop >= 1_000_000.0);
}

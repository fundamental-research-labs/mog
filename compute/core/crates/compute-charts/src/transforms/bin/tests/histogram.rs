use crate::transforms::bin::{
    cumulative_histogram, histogram, histogram_from_data, normalized_histogram,
};
use crate::types::DataRow;

use super::helpers::make_row;

#[test]
fn histogram_empty() {
    let result = histogram(&[], None, None, None);
    assert!(result.is_empty());
}

#[test]
fn histogram_single_value() {
    let result = histogram(&[5.0, 5.0, 5.0], None, None, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].count, 3);
}

#[test]
fn histogram_basic_count_matches() {
    let values: Vec<f64> = (0..100).map(|i| i as f64).collect();
    let result = histogram(&values, Some(10), None, Some(true));

    assert!(!result.is_empty());
    let total: usize = result.iter().map(|b| b.count).sum();
    assert_eq!(total, 100);
}

#[test]
fn histogram_bins_are_contiguous() {
    let values: Vec<f64> = (0..50).map(|i| i as f64).collect();
    let result = histogram(&values, Some(5), None, Some(true));

    for i in 1..result.len() {
        assert_approx!(result[i].bin0, result[i - 1].bin1);
    }
}

#[test]
fn histogram_filters_nan_and_inf() {
    let values = vec![1.0, f64::NAN, 2.0, f64::INFINITY, 3.0, f64::NEG_INFINITY];
    let result = histogram(&values, None, None, None);
    let total: usize = result.iter().map(|b| b.count).sum();
    assert_eq!(total, 3);
}

#[test]
fn histogram_explicit_step() {
    let values: Vec<f64> = (0..20).map(|i| i as f64).collect();
    let result = histogram(&values, None, Some(5.0), Some(true));

    for bin in &result {
        assert_approx!(bin.bin1 - bin.bin0, 5.0);
    }
}

#[test]
fn histogram_all_same_value() {
    let values = vec![7.0; 50];
    let result = histogram(&values, None, None, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].count, 50);
}

#[test]
fn histogram_negative_values() {
    let values = vec![-10.0, -5.0, 0.0, 5.0, 10.0];
    let result = histogram(&values, Some(5), None, Some(true));
    let total: usize = result.iter().map(|b| b.count).sum();
    assert_eq!(total, 5);
}

#[test]
fn histogram_from_data_basic() {
    let data: Vec<DataRow> = (0..20).map(|i| make_row("val", i as f64)).collect();
    let result = histogram_from_data(&data, "val", Some(5), None, None);
    let total: usize = result.iter().map(|b| b.count).sum();
    assert_eq!(total, 20);
}

#[test]
fn histogram_from_data_missing_field() {
    let data = vec![make_row("other", 5.0)];
    let result = histogram_from_data(&data, "val", None, None, None);
    assert!(result.is_empty());
}

#[test]
fn cumulative_histogram_empty() {
    let result = cumulative_histogram(&[], None, None, None);
    assert!(result.is_empty());
}

#[test]
fn cumulative_histogram_basic() {
    let values: Vec<f64> = (0..20).map(|i| i as f64).collect();
    let result = cumulative_histogram(&values, Some(5), None, Some(true));

    assert!(!result.is_empty());

    for i in 1..result.len() {
        assert!(result[i].cumulative >= result[i - 1].cumulative);
    }

    let last = result.last().unwrap();
    assert_eq!(last.cumulative, 20);
}

#[test]
fn cumulative_histogram_first_bin() {
    let values: Vec<f64> = (0..10).map(|i| i as f64).collect();
    let result = cumulative_histogram(&values, Some(5), None, Some(true));
    assert_eq!(result[0].cumulative, result[0].count);
}

#[test]
fn normalized_histogram_empty() {
    let result = normalized_histogram(&[], None, None, None);
    assert!(result.is_empty());
}

#[test]
fn normalized_histogram_integrates_to_one() {
    let values: Vec<f64> = (0..1000).map(|i| (i as f64) * 0.1).collect();
    let result = normalized_histogram(&values, Some(10), None, Some(true));

    for bin in &result {
        assert!(bin.density >= 0.0);
    }

    let integral: f64 = result.iter().map(|b| b.density * (b.bin1 - b.bin0)).sum();
    assert!(
        (integral - 1.0).abs() < 0.01,
        "Normalized histogram integral = {}, expected ~1.0",
        integral
    );
}

#[test]
fn normalized_histogram_single_value() {
    let values = vec![5.0; 10];
    let result = normalized_histogram(&values, None, None, None);
    assert_eq!(result.len(), 1);
    let integral = result[0].density * (result[0].bin1 - result[0].bin0);
    assert_approx!(integral, 1.0, 1e-6);
}

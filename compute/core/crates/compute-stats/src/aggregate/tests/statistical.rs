use value_types::CellValue;

use super::fixtures::{assert_close, assert_null, assert_num, empty};
use crate::aggregate::statistical::{pivot_stdev, pivot_stdevp, pivot_var, pivot_varp};

fn hand_computed_values() -> Vec<CellValue> {
    vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
        .into_iter()
        .map(CellValue::number)
        .collect()
}

#[test]
fn test_stdev_numerical_stability_large_values() {
    let vals: Vec<CellValue> = (1..=10)
        .map(|i| CellValue::number(1e12 + i as f64))
        .collect();
    let result = pivot_stdevp(&vals);
    assert_close(result, 2.8722813232690143, 1e-6);
}

#[test]
fn test_stdev_calculates_sample_stdev() {
    assert_close(pivot_stdev(&hand_computed_values()), 2.138, 0.001);
}

#[test]
fn test_stdev_returns_null_for_single_value() {
    assert_null(pivot_stdev(&[CellValue::number(5.0)]));
}

#[test]
fn test_stdev_returns_null_for_empty() {
    assert_null(pivot_stdev(&empty()));
}

#[test]
fn test_stdevp_calculates_population_stdev() {
    assert_close(pivot_stdevp(&hand_computed_values()), 2.0, 0.001);
}

#[test]
fn test_stdevp_returns_value_for_single_element() {
    assert_num(pivot_stdevp(&[CellValue::number(5.0)]), 0.0);
}

#[test]
fn test_stdevp_returns_null_for_empty() {
    assert_null(pivot_stdevp(&empty()));
}

#[test]
fn test_var_calculates_sample_variance() {
    assert_close(pivot_var(&hand_computed_values()), 4.571, 0.001);
}

#[test]
fn test_var_returns_null_for_single_value() {
    assert_null(pivot_var(&[CellValue::number(5.0)]));
}

#[test]
fn test_varp_calculates_population_variance() {
    assert_close(pivot_varp(&hand_computed_values()), 4.0, 0.001);
}

#[test]
fn test_varp_returns_0_for_single_element() {
    assert_num(pivot_varp(&[CellValue::number(5.0)]), 0.0);
}

#[test]
fn test_variance_stddev_hand_computed_exact() {
    let vals = hand_computed_values();
    assert_num(pivot_varp(&vals), 4.0);

    let sample_var = pivot_var(&vals);
    assert!(
        (sample_var.as_number().unwrap() - 32.0 / 7.0).abs() < 1e-10,
        "sample variance should be 32/7, got {}",
        sample_var.as_number().unwrap()
    );

    assert_num(pivot_stdevp(&vals), 2.0);

    let sample_sd = pivot_stdev(&vals);
    let expected_sd = (32.0_f64 / 7.0).sqrt();
    assert!(
        (sample_sd.as_number().unwrap() - expected_sd).abs() < 1e-10,
        "sample stddev should be sqrt(32/7) = {}, got {}",
        expected_sd,
        sample_sd.as_number().unwrap()
    );
}

#[test]
fn test_variance_two_values() {
    let vals = vec![CellValue::number(3.0), CellValue::number(7.0)];
    assert_num(pivot_varp(&vals), 4.0);
    assert_num(pivot_var(&vals), 8.0);
    assert_num(pivot_stdevp(&vals), 2.0);
    assert_num(pivot_stdev(&vals), (8.0_f64).sqrt());
}

#[test]
fn test_variance_identical_values() {
    let vals: Vec<CellValue> = vec![5.0; 10].into_iter().map(CellValue::number).collect();
    assert_num(pivot_varp(&vals), 0.0);
    assert_num(pivot_var(&vals), 0.0);
    assert_num(pivot_stdevp(&vals), 0.0);
    assert_num(pivot_stdev(&vals), 0.0);
}

#[test]
fn test_stdev_ignores_non_numeric_in_computation() {
    let vals = vec![
        CellValue::number(10.0),
        CellValue::Text("x".into()),
        CellValue::number(20.0),
    ];
    assert_num(pivot_varp(&vals), 25.0);
    assert_num(pivot_var(&vals), 50.0);
    assert_num(pivot_stdevp(&vals), 5.0);
    assert_num(pivot_stdev(&vals), (50.0_f64).sqrt());
}

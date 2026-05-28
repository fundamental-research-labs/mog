use value_types::{CellControl, CellError, CellValue};

use super::fixtures::{
    all_nulls, assert_null, assert_num, empty, mixed_numbers, numbers, strings, with_errors,
};
use crate::aggregate::numeric::{
    pivot_average, pivot_count, pivot_max, pivot_min, pivot_product, pivot_sum,
};

#[test]
fn test_sum_numeric_values() {
    assert_num(pivot_sum(&numbers()), 15.0);
}

#[test]
fn test_sum_ignores_non_numeric() {
    assert_num(pivot_sum(&mixed_numbers()), 100.0);
}

#[test]
fn test_sum_empty_array() {
    assert_null(pivot_sum(&empty()));
}

#[test]
fn test_sum_all_nulls() {
    assert_null(pivot_sum(&all_nulls()));
}

#[test]
fn test_sum_ignores_errors() {
    assert_num(pivot_sum(&with_errors()), 6.0);
}

#[test]
fn test_sum_kahan_compensated() {
    let vals = vec![
        CellValue::number(1e15),
        CellValue::number(1.0),
        CellValue::number(-1e15),
    ];
    assert_num(pivot_sum(&vals), 1.0);
}

#[test]
fn test_sum_ignores_string_numbers() {
    let vals = vec![
        CellValue::number(10.0),
        CellValue::Text("20".into()),
        CellValue::Text("30".into()),
    ];
    assert_num(pivot_sum(&vals), 10.0);
}

#[test]
fn test_sum_many_small_values() {
    let vals: Vec<CellValue> = (0..10000).map(|_| CellValue::number(0.1)).collect();
    let result = pivot_sum(&vals);
    assert!(
        (result.as_number().unwrap() - 1000.0).abs() < 1e-6,
        "sum of 10000 * 0.1 should be ~1000.0, got {}",
        result.as_number().unwrap()
    );
}

#[test]
fn test_sum_associativity() {
    let vals_a = vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(3.0),
    ];
    let vals_b = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::number(2.0),
    ];
    let a = pivot_sum(&vals_a).as_number().unwrap();
    let b = pivot_sum(&vals_b).as_number().unwrap();
    assert!((a - b).abs() < 1e-10, "sum should be order-independent");
}

#[test]
fn test_count_numeric_values_only() {
    assert_num(pivot_count(&numbers()), 5.0);
}

#[test]
fn test_count_ignores_non_numeric() {
    assert_num(pivot_count(&mixed_numbers()), 4.0);
}

#[test]
fn test_count_empty_array() {
    assert_null(pivot_count(&empty()));
}

#[test]
fn test_count_returns_null_for_strings() {
    assert_null(pivot_count(&strings()));
}

#[test]
fn test_count_ignores_string_numbers() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::Text("2".into()),
        CellValue::Text("nope".into()),
    ];
    assert_num(pivot_count(&vals), 1.0);
}

#[test]
fn test_count_zero_for_all_non_numeric() {
    let vals = vec![
        CellValue::Text("hello".into()),
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        CellValue::Error(CellError::Value, None),
    ];
    assert_null(pivot_count(&vals));
}

#[test]
fn test_average_calculates_average() {
    assert_num(pivot_average(&numbers()), 3.0);
}

#[test]
fn test_average_ignores_non_numeric() {
    assert_num(pivot_average(&mixed_numbers()), 25.0);
}

#[test]
fn test_average_returns_null_for_empty() {
    assert_null(pivot_average(&empty()));
}

#[test]
fn test_average_returns_null_for_all_non_numeric() {
    assert_null(pivot_average(&strings()));
}

#[test]
fn test_average_basic() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(3.0),
    ];
    assert_num(pivot_average(&vals), 2.0);
}

#[test]
fn test_average_ignores_non_numeric_mixed() {
    let vals = vec![
        CellValue::number(10.0),
        CellValue::Text("x".into()),
        CellValue::number(20.0),
        CellValue::Null,
    ];
    assert_num(pivot_average(&vals), 15.0);
}

#[test]
fn test_average_empty_is_null() {
    assert_null(pivot_average(&[]));
}

#[test]
fn test_average_all_non_numeric_is_null() {
    let vals = vec![CellValue::Text("a".into()), CellValue::Boolean(true)];
    assert_null(pivot_average(&vals));
}

#[test]
fn test_average_large_equal_values() {
    let vals: Vec<CellValue> = (0..1000).map(|_| CellValue::number(3.14159)).collect();
    assert_num(pivot_average(&vals), 3.14159);
}

#[test]
fn test_min_finds_minimum() {
    assert_num(pivot_min(&numbers()), 1.0);
}

#[test]
fn test_min_ignores_non_numeric() {
    assert_num(pivot_min(&mixed_numbers()), 10.0);
}

#[test]
fn test_min_returns_null_for_empty() {
    assert_null(pivot_min(&empty()));
}

#[test]
fn test_min_handles_negative_numbers() {
    let vals = vec![
        CellValue::number(-5.0),
        CellValue::number(-2.0),
        CellValue::number(0.0),
        CellValue::number(3.0),
    ];
    assert_num(pivot_min(&vals), -5.0);
}

#[test]
fn test_max_finds_maximum() {
    assert_num(pivot_max(&numbers()), 5.0);
}

#[test]
fn test_max_ignores_non_numeric() {
    assert_num(pivot_max(&mixed_numbers()), 40.0);
}

#[test]
fn test_max_returns_null_for_empty() {
    assert_null(pivot_max(&empty()));
}

#[test]
fn test_max_handles_negative_numbers() {
    let vals = vec![
        CellValue::number(-5.0),
        CellValue::number(-2.0),
        CellValue::number(0.0),
        CellValue::number(3.0),
    ];
    assert_num(pivot_max(&vals), 3.0);
}

#[test]
fn test_min_max_ignores_text_that_looks_numeric() {
    let vals = vec![
        CellValue::number(5.0),
        CellValue::Text("1".into()),
        CellValue::number(3.0),
    ];
    assert_num(pivot_min(&vals), 3.0);
    assert_num(pivot_max(&vals), 5.0);
}

#[test]
fn test_min_max_all_non_numeric_is_null() {
    let vals = vec![
        CellValue::Text("100".into()),
        CellValue::Boolean(true),
        CellValue::Error(CellError::Na, None),
    ];
    assert_null(pivot_min(&vals));
    assert_null(pivot_max(&vals));
}

#[test]
fn test_min_max_single_numeric_among_non_numeric() {
    let vals = vec![
        CellValue::Text("hello".into()),
        CellValue::number(42.0),
        CellValue::Boolean(false),
    ];
    assert_num(pivot_min(&vals), 42.0);
    assert_num(pivot_max(&vals), 42.0);
}

#[test]
fn test_min_max_with_negative_zero() {
    let vals = vec![CellValue::number(-0.0), CellValue::number(0.0)];
    assert_num(pivot_min(&vals), 0.0);
    assert_num(pivot_max(&vals), 0.0);
}

#[test]
fn test_product_calculates_product() {
    assert_num(pivot_product(&numbers()), 120.0);
}

#[test]
fn test_product_ignores_non_numeric() {
    let vals = vec![
        CellValue::number(2.0),
        CellValue::number(3.0),
        CellValue::Text("text".into()),
        CellValue::number(4.0),
    ];
    assert_num(pivot_product(&vals), 24.0);
}

#[test]
fn test_product_returns_null_for_empty() {
    assert_null(pivot_product(&empty()));
}

#[test]
fn test_product_handles_zero() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(0.0),
        CellValue::number(3.0),
    ];
    assert_num(pivot_product(&vals), 0.0);
}

#[test]
fn test_product_basic() {
    let vals = vec![
        CellValue::number(2.0),
        CellValue::number(3.0),
        CellValue::number(4.0),
    ];
    assert_num(pivot_product(&vals), 24.0);
}

#[test]
fn test_product_zero_absorbs() {
    let vals = vec![
        CellValue::number(0.0),
        CellValue::number(5.0),
        CellValue::number(10.0),
    ];
    assert_num(pivot_product(&vals), 0.0);
}

#[test]
fn test_product_negative() {
    let vals = vec![CellValue::number(-2.0), CellValue::number(3.0)];
    assert_num(pivot_product(&vals), -6.0);
}

#[test]
fn test_product_single_value() {
    let vals = vec![CellValue::number(7.0)];
    assert_num(pivot_product(&vals), 7.0);
}

#[test]
fn test_product_ignores_non_numeric_mixed() {
    let vals = vec![
        CellValue::number(2.0),
        CellValue::Text("x".into()),
        CellValue::number(3.0),
    ];
    assert_num(pivot_product(&vals), 6.0);
}

#[test]
fn test_product_two_negatives() {
    let vals = vec![CellValue::number(-3.0), CellValue::number(-4.0)];
    assert_num(pivot_product(&vals), 12.0);
}

#[test]
fn test_nan_inputs_ignored_in_all_aggregations() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::number(f64::NAN),
        CellValue::number(3.0),
    ];
    assert_num(pivot_sum(&vals), 4.0);
    assert_num(pivot_count(&vals), 2.0);
    assert_num(pivot_average(&vals), 2.0);
    assert_num(pivot_min(&vals), 1.0);
    assert_num(pivot_max(&vals), 3.0);
}

#[test]
fn test_infinity_inputs_ignored() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::number(f64::INFINITY),
        CellValue::number(3.0),
    ];
    assert_num(pivot_sum(&vals), 4.0);
    assert_num(pivot_count(&vals), 2.0);
}

#[test]
fn test_boolean_values_ignored_in_numeric_aggregations() {
    let vals = vec![
        CellValue::number(5.0),
        CellValue::Boolean(true),
        CellValue::Boolean(false),
    ];
    assert_num(pivot_sum(&vals), 5.0);
    assert_num(pivot_count(&vals), 1.0);
}

#[test]
fn test_controls_ignored_in_numeric_aggregations() {
    let vals = vec![
        CellValue::number(5.0),
        CellValue::Control(CellControl::checkbox(true)),
        CellValue::Control(CellControl::checkbox(false)),
    ];
    assert_num(pivot_sum(&vals), 5.0);
    assert_num(pivot_count(&vals), 1.0);
}

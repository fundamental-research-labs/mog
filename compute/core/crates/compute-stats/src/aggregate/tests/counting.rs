use std::sync::Arc;

use value_types::{CellArray, CellControl, CellError, CellImage, CellImageSizing, CellValue};

use super::fixtures::{assert_null, assert_num, empty, numbers, strings, with_errors, with_nulls};
use crate::aggregate::counting::{pivot_counta, pivot_countunique};
use crate::aggregate::numeric::pivot_count;

#[test]
fn test_counta_counts_non_empty() {
    assert_num(pivot_counta(&numbers()), 5.0);
}

#[test]
fn test_counta_counts_strings() {
    assert_num(pivot_counta(&strings()), 3.0);
}

#[test]
fn test_counta_ignores_nulls() {
    assert_num(pivot_counta(&with_nulls()), 3.0);
}

#[test]
fn test_counta_counts_errors() {
    assert_num(pivot_counta(&with_errors()), 4.0);
}

#[test]
fn test_counta_empty_array() {
    assert_null(pivot_counta(&empty()));
}

#[test]
fn test_counta_excludes_blank_text() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::Text("".into()),
        CellValue::Text("   ".into()),
        CellValue::Text("x".into()),
    ];
    assert_num(pivot_counta(&vals), 2.0);
}

#[test]
fn test_counta_counts_controls_images_arrays() {
    let image = CellValue::Image(CellImage::new(
        "https://example.test/image.png",
        None,
        CellImageSizing::Fit,
        None,
        None,
    ));
    let array = CellValue::Array(Arc::new(CellArray::new(vec![CellValue::number(1.0)], 1)));
    let vals = vec![
        CellValue::Control(CellControl::checkbox(true)),
        image,
        array,
        CellValue::Null,
    ];
    assert_num(pivot_counta(&vals), 3.0);
}

#[test]
fn test_countunique_counts_unique_values() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(2.0),
        CellValue::number(3.0),
        CellValue::number(3.0),
        CellValue::number(3.0),
    ];
    assert_num(pivot_countunique(&vals), 3.0);
}

#[test]
fn test_countunique_case_insensitive_strings() {
    let vals = vec![
        CellValue::Text("A".into()),
        CellValue::Text("a".into()),
        CellValue::Text("B".into()),
        CellValue::Text("b".into()),
    ];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_case_insensitive_three_cases() {
    let vals = vec![
        CellValue::Text("Apple".into()),
        CellValue::Text("apple".into()),
        CellValue::Text("APPLE".into()),
    ];
    assert_num(pivot_countunique(&vals), 1.0);
}

#[test]
fn test_countunique_ignores_nulls() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::number(2.0),
    ];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_boolean_text_are_distinct_types() {
    let vals = vec![
        CellValue::Boolean(true),
        CellValue::Text("TRUE".into()),
        CellValue::Text("true".into()),
    ];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_number_text_no_collision() {
    let vals = vec![CellValue::number(1.0), CellValue::Text("1".into())];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_cross_type_number_vs_text() {
    let vals = vec![CellValue::number(1.0), CellValue::Text("1".into())];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_handles_errors_as_unique() {
    let e1 = CellValue::Error(CellError::Div0, None);
    let e1_dup = CellValue::Error(CellError::Div0, None);
    let e2 = CellValue::Error(CellError::Value, None);
    let vals = vec![e1, e1_dup, e2];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_no_trimming() {
    let vals = vec![
        CellValue::Text("hello".into()),
        CellValue::Text("  hello  ".into()),
    ];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_null_and_empty_text_both_blank() {
    let vals = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::number(1.0),
    ];
    assert_num(pivot_countunique(&vals), 1.0);
}

#[test]
fn test_countunique_empty_input() {
    assert_null(pivot_countunique(&empty()));
}

#[test]
fn test_countunique_all_blanks() {
    let vals = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::Text("   ".into()),
    ];
    assert_null(pivot_countunique(&vals));
}

#[test]
fn test_countunique_single_value() {
    let vals = vec![CellValue::number(42.0)];
    assert_num(pivot_countunique(&vals), 1.0);
}

#[test]
fn test_countunique_mixed_types() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::Text("hello".into()),
        CellValue::Boolean(true),
        CellValue::Error(CellError::Na, None),
    ];
    assert_num(pivot_countunique(&vals), 4.0);
}

#[test]
fn test_countunique_blanks_excluded() {
    let vals = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::number(1.0),
    ];
    assert_num(pivot_countunique(&vals), 1.0);
}

#[test]
fn test_countunique_negative_zero_canonicalized() {
    let vals = vec![CellValue::number(0.0), CellValue::number(-0.0)];
    assert_num(pivot_countunique(&vals), 1.0);
}

#[test]
fn test_countunique_nan_values_excluded() {
    let vals = vec![
        CellValue::number(f64::NAN),
        CellValue::number(f64::NAN),
        CellValue::number(1.0),
    ];
    assert_num(pivot_countunique(&vals), 2.0);
}

#[test]
fn test_countunique_controls_images_arrays() {
    let image = CellValue::Image(CellImage::new(
        "https://example.test/image.png",
        Some(Arc::from("alt")),
        CellImageSizing::Fit,
        None,
        None,
    ));
    let array = CellValue::Array(Arc::new(CellArray::new(vec![CellValue::number(1.0)], 1)));
    let vals = vec![
        CellValue::Control(CellControl::checkbox(true)),
        CellValue::Control(CellControl::checkbox(true)),
        image.clone(),
        image,
        array.clone(),
        array,
    ];
    assert_num(pivot_countunique(&vals), 3.0);
}

#[test]
fn test_count_vs_counta_mixed_types() {
    let vals = vec![
        CellValue::number(1.0),
        CellValue::Text("a".into()),
        CellValue::Boolean(true),
        CellValue::Null,
        CellValue::Error(CellError::Div0, None),
        CellValue::number(2.0),
    ];
    assert_num(pivot_count(&vals), 2.0);
    assert_num(pivot_counta(&vals), 5.0);
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
    assert_num(pivot_counta(&vals), 4.0);
}

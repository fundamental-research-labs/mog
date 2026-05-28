use std::sync::Arc;

use value_types::{
    CellArray, CellControl, CellError, CellImage, CellImageSizing, CellValue, FiniteF64,
};

use super::coerce;
use crate::types::{CellValueResult, CoercionResult, SchemaType};

mod currency;
mod date_time;
mod non_scalar_values;
mod null_and_any;
mod number;
mod percentage;
mod scalar;
mod semantic_strings;

fn num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(n).unwrap())
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn error_value() -> CellValue {
    CellValue::Error(CellError::Value, None)
}

fn array_value() -> CellValue {
    CellValue::Array(Arc::new(CellArray::single_row(vec![])))
}

fn control_value() -> CellValue {
    CellValue::Control(CellControl::checkbox(true))
}

fn image_value() -> CellValue {
    CellValue::Image(CellImage::new(
        "https://example.com/image.png",
        Some(Arc::<str>::from("Example image")),
        CellImageSizing::Fit,
        None,
        None,
    ))
}

fn assert_num_result(result: &CoercionResult, expected: f64) {
    assert!(
        result.success,
        "expected success, got error: {:?}",
        result.error
    );
    match &result.value {
        Some(CellValueResult::Number(n)) => {
            assert!(
                (n - expected).abs() < 0.001,
                "expected ~{expected}, got {n}"
            );
        }
        other => panic!("expected Number({expected}), got {other:?}"),
    }
}

fn assert_text_result(result: &CoercionResult, expected: &str) {
    assert!(
        result.success,
        "expected success, got error: {:?}",
        result.error
    );
    match &result.value {
        Some(CellValueResult::Text(s)) => assert_eq!(s, expected),
        other => panic!("expected Text(\"{expected}\"), got {other:?}"),
    }
}

fn assert_bool_result(result: &CoercionResult, expected: bool) {
    assert!(
        result.success,
        "expected success, got error: {:?}",
        result.error
    );
    match &result.value {
        Some(CellValueResult::Boolean(b)) => assert_eq!(*b, expected),
        other => panic!("expected Boolean({expected}), got {other:?}"),
    }
}

fn assert_null_result(result: &CoercionResult) {
    assert!(
        result.success,
        "expected success, got error: {:?}",
        result.error
    );
    assert_eq!(result.value, Some(CellValueResult::Null));
}

fn assert_err(result: &CoercionResult) {
    assert!(
        !result.success,
        "expected error, got success: {:?}",
        result.value
    );
    assert!(result.error.is_some());
}

use value_types::CellValue;

use crate::types::{SchemaConstraints, SchemaType, ValidationErrorCode};
use crate::validator::validate;

use super::helpers::*;

#[test]
fn within_min_max() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(0.0),
            max: Some(100.0),
            ..Default::default()
        },
    );
    let result = validate(&num(50.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn below_min() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(0.0),
            ..Default::default()
        },
    );
    let result = validate(&num(-5.0), &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::MinValue)
    );
}

#[test]
fn above_max() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            max: Some(100.0),
            ..Default::default()
        },
    );
    let result = validate(&num(150.0), &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::MaxValue)
    );
}

#[test]
fn text_within_length() {
    let schema = make_schema_with_constraints(
        SchemaType::String,
        SchemaConstraints {
            max_length: Some(10),
            ..Default::default()
        },
    );
    let result = validate(&text("hello"), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn text_exceeds_length() {
    let schema = make_schema_with_constraints(
        SchemaType::String,
        SchemaConstraints {
            max_length: Some(5),
            ..Default::default()
        },
    );
    let result = validate(&text("hello world"), &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::MaxLength)
    );
}

#[test]
fn pattern_match() {
    let schema = make_schema_with_constraints(
        SchemaType::String,
        SchemaConstraints {
            pattern: Some("^[A-Z]+$".into()),
            ..Default::default()
        },
    );
    let result = validate(&text("ABC"), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn pattern_fail() {
    let schema = make_schema_with_constraints(
        SchemaType::String,
        SchemaConstraints {
            pattern: Some("^[A-Z]+$".into()),
            ..Default::default()
        },
    );
    let result = validate(&text("abc"), &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::Pattern)
    );
}

#[test]
fn coercion_fallback_should_still_check_constraints() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            max: Some(100.0),
            ..Default::default()
        },
    );
    let result = validate(&CellValue::Boolean(true), &schema);
    assert!(result.valid, "Coerced 1.0 should pass max:100");

    let result = validate(&text("150"), &schema);
    assert!(
        !result.valid,
        "Coerced 150.0 should fail max:100 constraint"
    );
}

#[test]
fn constraints_are_checked_after_coercion_fallback() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(2.0),
            ..Default::default()
        },
    );
    let result = validate(&CellValue::Boolean(true), &schema);
    assert!(!result.valid);
    assert!(result.coerced_value.is_some());
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::MinValue)
    );
}

#[test]
fn enum_constraint_should_apply_to_numbers() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            enum_values: Some(vec!["1".into(), "2".into(), "3".into()]),
            ..Default::default()
        },
    );
    let result_invalid = validate(&num(4.0), &schema);
    assert!(
        !result_invalid.valid,
        "Number 4.0 not in enum [1,2,3] should fail"
    );
}

#[test]
fn enum_constraint_applies_to_booleans() {
    let schema = make_schema_with_constraints(
        SchemaType::Boolean,
        SchemaConstraints {
            enum_values: Some(vec!["true".into()]),
            ..Default::default()
        },
    );
    let result_true = validate(&CellValue::Boolean(true), &schema);
    assert!(result_true.valid);
    let result_false = validate(&CellValue::Boolean(false), &schema);
    assert!(
        !result_false.valid,
        "Boolean false not in enum [true] should fail"
    );
}

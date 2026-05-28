use value_types::CellValue;

use crate::types::{SchemaConstraints, SchemaType, ValidationErrorCode};
use crate::validator::{is_valid, validate};

use super::helpers::*;

#[test]
fn valid_number() {
    let schema = make_schema(SchemaType::Number);
    let result = validate(&num(42.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn valid_integer() {
    let schema = make_schema(SchemaType::Integer);
    let result = validate(&num(42.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn float_fails_integer() {
    let schema = make_schema(SchemaType::Integer);
    let result = validate(&num(3.14), &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::InvalidInteger)
    );
}

#[test]
fn valid_text() {
    let schema = make_schema(SchemaType::String);
    let result = validate(&text("hello"), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn null_valid_not_required() {
    let schema = make_schema(SchemaType::String);
    let result = validate(&CellValue::Null, &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn null_invalid_required() {
    let schema = make_schema_with_constraints(
        SchemaType::String,
        SchemaConstraints {
            required: Some(true),
            ..Default::default()
        },
    );
    let result = validate(&CellValue::Null, &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::Required)
    );
}

#[test]
fn number_for_date() {
    let schema = make_schema(SchemaType::Date);
    let result = validate(&num(45000.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn number_for_percentage() {
    let schema = make_schema(SchemaType::Percentage);
    let result = validate(&num(0.5), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn any_accepts_all() {
    let schema = make_schema(SchemaType::Any);
    assert!(validate(&num(42.0), &schema).valid);
    assert!(validate(&text("hello"), &schema).valid);
    assert!(validate(&CellValue::Boolean(true), &schema).valid);
    assert!(validate(&CellValue::Null, &schema).valid);
}

#[test]
fn is_valid_convenience() {
    let schema = make_schema(SchemaType::Number);
    assert!(is_valid(&num(42.0), &schema));
}

#[test]
fn coercion_fallback() {
    let schema = make_schema(SchemaType::Number);
    let result = validate(&CellValue::Boolean(true), &schema);
    assert!(result.valid);
    assert!(result.coerced_value.is_some());
}

#[test]
fn empty_string_not_required() {
    let schema = make_schema(SchemaType::String);
    let result = validate(&text(""), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn empty_string_triggers_required() {
    let schema = make_schema_with_constraints(
        SchemaType::String,
        SchemaConstraints {
            required: Some(true),
            ..Default::default()
        },
    );
    let result = validate(&text(""), &schema);
    assert!(
        !result.valid,
        "Empty string should fail required constraint"
    );
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::Required)
    );
}

#[test]
fn required_empty_return_has_only_required_and_inferred_type_for_null() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            required: Some(true),
            min: Some(1.0),
            ..Default::default()
        },
    );
    let result = validate(&CellValue::Null, &schema);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].code, ValidationErrorCode::Required);
    assert_eq!(result.inferred_type, Some(SchemaType::Null));
    assert!(result.coerced_value.is_none());
}

#[test]
fn required_empty_return_has_only_required_and_inferred_type_for_empty_text() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            required: Some(true),
            min: Some(1.0),
            ..Default::default()
        },
    );
    let result = validate(&text(""), &schema);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].code, ValidationErrorCode::Required);
    assert_eq!(result.inferred_type, Some(SchemaType::Null));
    assert!(result.coerced_value.is_none());
}

#[test]
fn inferred_type_always_present() {
    let schema = make_schema(SchemaType::Number);
    assert!(validate(&num(42.0), &schema).inferred_type.is_some());
    assert!(validate(&text("hello"), &schema).inferred_type.is_some());
    assert!(validate(&CellValue::Null, &schema).inferred_type.is_some());
    assert!(
        validate(&CellValue::Boolean(true), &schema)
            .inferred_type
            .is_some()
    );
}

#[test]
fn unsupported_variants_preserve_inferred_type_and_coercion_behavior() {
    let any_schema = make_schema(SchemaType::Any);
    assert_eq!(
        validate(&error_value(), &any_schema).inferred_type,
        Some(SchemaType::Any)
    );
    assert_eq!(
        validate(&array_value(), &any_schema).inferred_type,
        Some(SchemaType::Any)
    );
    assert_eq!(
        validate(&image_value(), &any_schema).inferred_type,
        Some(SchemaType::Any)
    );
    assert_eq!(
        validate(&control_value(), &any_schema).inferred_type,
        Some(SchemaType::Boolean)
    );

    let string_schema = make_schema(SchemaType::String);
    assert!(validate(&error_value(), &string_schema).valid);
    assert!(validate(&array_value(), &string_schema).valid);
    assert!(validate(&image_value(), &string_schema).valid);

    let boolean_schema = make_schema(SchemaType::Boolean);
    assert!(validate(&control_value(), &boolean_schema).valid);
}

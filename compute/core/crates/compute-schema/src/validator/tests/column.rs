use value_types::CellValue;

use crate::types::{SchemaConstraints, SchemaType, ValidationErrorCode};
use crate::validator::validate_column;

use super::helpers::*;

#[test]
fn validate_column_all_valid() {
    let schema = make_schema(SchemaType::Number);
    let values = vec![num(1.0), num(2.0), num(3.0)];
    let result = validate_column(&values, &schema, false);
    assert!(result.valid);
    assert!(result.row_errors.is_empty());
}

#[test]
fn validate_column_with_errors() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(0.0),
            ..Default::default()
        },
    );
    let values = vec![num(1.0), num(-5.0), num(3.0)];
    let result = validate_column(&values, &schema, false);
    assert!(!result.valid);
    assert_eq!(result.row_errors.len(), 1);
    assert_eq!(result.row_errors[0].row, 1);
}

#[test]
fn validate_column_uniqueness() {
    let schema = make_schema(SchemaType::Number);
    let values = vec![num(1.0), num(2.0), num(1.0)];
    let result = validate_column(&values, &schema, true);
    assert!(!result.valid);
    assert_eq!(result.row_errors.len(), 1);
    assert_eq!(result.row_errors[0].row, 2);
    assert!(
        result.row_errors[0]
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::Unique)
    );
}

#[test]
fn validate_column_uniqueness_skips_empty() {
    let schema = make_schema(SchemaType::String);
    let values = vec![
        CellValue::Null,
        text("hello"),
        CellValue::Null,
        text("world"),
    ];
    let result = validate_column(&values, &schema, true);
    assert!(result.valid);
}

#[test]
fn validate_column_unique_constraint_in_schema() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            unique: Some(true),
            ..Default::default()
        },
    );
    let values = vec![num(1.0), num(2.0), num(1.0)];
    let result = validate_column(&values, &schema, false);
    assert!(!result.valid);
}

#[test]
fn column_uniqueness_is_case_sensitive() {
    let schema = make_schema(SchemaType::String);
    let values = vec![text("Hello"), text("hello"), text("HELLO")];
    let result = validate_column(&values, &schema, true);
    assert!(
        result.valid,
        "Case-different strings should be considered unique"
    );
}

#[test]
fn column_uniqueness_with_mixed_types() {
    let schema = make_schema(SchemaType::Any);
    let values = vec![num(1.0), text("hello"), CellValue::Boolean(true), num(2.0)];
    let result = validate_column(&values, &schema, true);
    assert!(result.valid, "All different values should be unique");
}

#[test]
fn uniqueness_keys_for_display_equivalent_values_are_exact() {
    let schema = make_schema(SchemaType::Any);
    let values = vec![
        num(1.0),
        num(1.0),
        text("1"),
        CellValue::Boolean(true),
        text("true"),
    ];
    let result = validate_column(&values, &schema, true);
    assert!(!result.valid);
    assert_eq!(result.row_errors.len(), 1);
    assert_eq!(result.row_errors[0].row, 1);
    assert!(
        result.row_errors[0]
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::Unique)
    );
}

#[test]
fn unsupported_non_empty_values_share_empty_uniqueness_key() {
    let schema = make_schema(SchemaType::Any);
    let values = vec![error_value(), array_value(), control_value(), image_value()];
    let result = validate_column(&values, &schema, true);
    assert!(!result.valid);
    assert_eq!(result.row_errors.len(), 3);
    assert_eq!(result.row_errors[0].row, 1);
    assert_eq!(result.row_errors[1].row, 2);
    assert_eq!(result.row_errors[2].row, 3);
}

use value_types::CellValue;

use crate::types::{SchemaConstraints, SchemaType, ValidationErrorCode};
use crate::validator::validate_with_formula_evaluator;

use super::helpers::*;

#[test]
fn formula_evaluator_adds_to_existing_errors() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(10.0),
            formula: Some("=CUSTOM()".into()),
            ..Default::default()
        },
    );
    let result =
        validate_with_formula_evaluator(&num(5.0), &schema, |_| Some(CellValue::Boolean(false)));
    assert!(!result.valid);
    let has_min = result
        .errors
        .iter()
        .any(|e| e.code == ValidationErrorCode::MinValue);
    let has_formula = result
        .errors
        .iter()
        .any(|e| e.code == ValidationErrorCode::Formula);
    assert!(has_min, "Should have MinValue error");
    assert!(has_formula, "Should have Formula error");
}

#[test]
fn formula_pass_does_not_override_other_failures() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(10.0),
            formula: Some("=TRUE".into()),
            ..Default::default()
        },
    );
    let result =
        validate_with_formula_evaluator(&num(5.0), &schema, |_| Some(CellValue::Boolean(true)));
    assert!(
        !result.valid,
        "Min violation should not be overridden by passing formula"
    );
}

#[test]
fn formula_and_validation_both_pass() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            min: Some(0.0),
            formula: Some("=A1>0".into()),
            ..Default::default()
        },
    );
    let result =
        validate_with_formula_evaluator(&num(50.0), &schema, |_| Some(CellValue::Boolean(true)));
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn formula_failure_appends_to_type_error() {
    let schema = make_schema_with_constraints(
        SchemaType::Number,
        SchemaConstraints {
            formula: Some("=CUSTOM()".into()),
            ..Default::default()
        },
    );
    let result = validate_with_formula_evaluator(&text("not a number"), &schema, |_| {
        Some(CellValue::Boolean(false))
    });
    assert!(!result.valid);
    assert!(result.errors.len() >= 2);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::TypeMismatch)
    );
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::Formula)
    );
}

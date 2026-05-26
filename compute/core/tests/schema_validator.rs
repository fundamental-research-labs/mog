//! Integration tests for schema::validator module.

use compute_core::schema::types::*;
use compute_core::schema::validator::{is_valid, validate, validate_column};
use value_types::{CellValue, FiniteF64};

fn num(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(v).unwrap())
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn make_schema(schema_type: SchemaType) -> ColumnSchema {
    ColumnSchema {
        id: "test".into(),
        name: "Test".into(),
        schema_type,
        constraints: None,
        distribution: None,
        description: None,
    }
}

fn make_schema_with_constraints(
    schema_type: SchemaType,
    constraints: SchemaConstraints,
) -> ColumnSchema {
    ColumnSchema {
        id: "test".into(),
        name: "Test".into(),
        schema_type,
        constraints: Some(constraints),
        distribution: None,
        description: None,
    }
}

// 1. valid_number
#[test]
fn valid_number() {
    let schema = make_schema(SchemaType::Number);
    let result = validate(&num(42.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 2. valid_integer
#[test]
fn valid_integer() {
    let schema = make_schema(SchemaType::Integer);
    let result = validate(&num(42.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 3. float_fails_integer
#[test]
fn float_fails_integer() {
    let schema = make_schema(SchemaType::Integer);
    #[allow(clippy::approx_constant)]
    let pi_approx = 3.14;
    let result = validate(&num(pi_approx), &schema);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::InvalidInteger)
    );
}

// 4. valid_text
#[test]
fn valid_text() {
    let schema = make_schema(SchemaType::String);
    let result = validate(&text("hello"), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 5. valid_email
#[test]
fn valid_email() {
    let schema = make_schema(SchemaType::Email);
    let result = validate(&text("user@example.com"), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 6. invalid_email
#[test]
fn invalid_email() {
    let schema = make_schema(SchemaType::Email);
    let result = validate(&text("not-email"), &schema);
    assert!(result.coerced_value.is_some() || !result.valid);
}

// 7. null_valid_not_required
#[test]
fn null_valid_not_required() {
    let schema = make_schema(SchemaType::String);
    let result = validate(&CellValue::Null, &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 8. null_invalid_required
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

// 9. number_for_date
#[test]
fn number_for_date() {
    let schema = make_schema(SchemaType::Date);
    let result = validate(&num(45000.0), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 10. number_for_percentage
#[test]
fn number_for_percentage() {
    let schema = make_schema(SchemaType::Percentage);
    let result = validate(&num(0.5), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// 11. within_min_max
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

// 12. below_min
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

// 13. above_max
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

// 14. text_within_length
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

// 15. text_exceeds_length
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

// 16. pattern_match
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

// 17. pattern_fail
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

// 18. any_accepts_all
#[test]
fn any_accepts_all() {
    let schema = make_schema(SchemaType::Any);
    assert!(validate(&num(42.0), &schema).valid);
    assert!(validate(&text("hello"), &schema).valid);
    assert!(validate(&CellValue::Boolean(true), &schema).valid);
    assert!(validate(&CellValue::Null, &schema).valid);
}

// 19. is_valid_convenience
#[test]
fn is_valid_convenience_test() {
    let schema = make_schema(SchemaType::Number);
    assert!(is_valid(&num(42.0), &schema));
}

// 20. coercion_fallback
#[test]
fn coercion_fallback() {
    let schema = make_schema(SchemaType::Number);
    let result = validate(&CellValue::Boolean(true), &schema);
    assert!(result.valid);
    assert!(result.coerced_value.is_some());
}

// 21. empty_string_not_required
#[test]
fn empty_string_not_required() {
    let schema = make_schema(SchemaType::String);
    let result = validate(&text(""), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

// -- Column validation tests --

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

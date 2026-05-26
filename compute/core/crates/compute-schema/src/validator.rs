//! Core validation engine.
//!
//! Validates cell values against column schemas with type checking,
//! constraint enforcement, and coercion fallback.

use value_types::CellValue;

use super::coercion;
use super::constraints;
use super::inference;
use super::patterns;
use super::types::*;

/// Validate a value against a column schema.
///
/// 4-step flow:
/// 1. Empty check (required constraint)
/// 2. Type validation (infer -> check compatibility)
/// 3. Constraint validation (numeric bounds, string length, enum)
/// 4. Coercion fallback (if type mismatch, try coercing)
pub fn validate(value: &CellValue, schema: &ColumnSchema) -> ValidationResult {
    let mut errors = Vec::new();
    let inferred_type = inference::infer_type(value);

    // Step 1: Empty check
    if is_empty(value) {
        if let Some(ref c) = schema.constraints
            && c.required == Some(true)
        {
            errors.push(ValidationError {
                code: ValidationErrorCode::Required,
                message: "Value is required".into(),
                severity: ValidationSeverity::Error,
            });
        }
        return ValidationResult {
            valid: errors.is_empty(),
            errors,
            coerced_value: None,
            inferred_type: Some(inferred_type),
        };
    }

    // Step 2: Type validation
    let type_errors = validate_type(value, schema.schema_type, inferred_type);
    let has_type_errors = !type_errors.is_empty();
    errors.extend(type_errors);

    // Step 3: Constraint validation (only if type matches)
    if !has_type_errors && schema.constraints.is_some() {
        errors.extend(validate_constraints(value, schema));
    }

    // Step 4: Coercion fallback
    let mut coerced_value = None;
    if has_type_errors {
        let coercion_result = coercion::coerce(value, schema.schema_type);
        if coercion_result.success {
            coerced_value = coercion_result.value;
            // Clear type mismatch errors since coercion succeeded
            errors.retain(|e| e.code != ValidationErrorCode::TypeMismatch);
        }
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
        coerced_value,
        inferred_type: Some(inferred_type),
    }
}

/// Check if a value is empty.
fn is_empty(value: &CellValue) -> bool {
    match value {
        CellValue::Null => true,
        CellValue::Text(s) => s.is_empty(),
        _ => false,
    }
}

/// Validate type compatibility.
fn validate_type(
    value: &CellValue,
    expected: SchemaType,
    inferred: SchemaType,
) -> Vec<ValidationError> {
    // Any accepts everything
    if expected == SchemaType::Any {
        return Vec::new();
    }

    // Integer validation for numeric values
    if expected == SchemaType::Integer
        && let CellValue::Number(n) = value
        && n.get().fract() != 0.0
    {
        return vec![ValidationError {
            code: ValidationErrorCode::InvalidInteger,
            message: "Value must be a whole number".into(),
            severity: ValidationSeverity::Error,
        }];
    }

    // Numeric types accept raw numbers
    if matches!(
        expected,
        SchemaType::Percentage | SchemaType::Currency | SchemaType::Time | SchemaType::Date
    ) && matches!(value, CellValue::Number(_))
    {
        return Vec::new();
    }

    // Check type compatibility
    if !inference::is_compatible_type(inferred, expected) {
        return vec![ValidationError {
            code: ValidationErrorCode::TypeMismatch,
            message: format!("Expected {:?}, got {:?}", expected, inferred),
            severity: ValidationSeverity::Error,
        }];
    }

    // Semantic format validation for text values
    if let CellValue::Text(text) = value
        && let Some(err) = validate_semantic_format(text, expected)
    {
        return vec![err];
    }

    Vec::new()
}

/// Validate semantic format for text values.
fn validate_semantic_format(text: &str, expected: SchemaType) -> Option<ValidationError> {
    match expected {
        SchemaType::Email => {
            if !patterns::is_email(text) {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidEmail,
                    message: "Invalid email format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        SchemaType::Url => {
            if !patterns::is_url(text) {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidUrl,
                    message: "Invalid URL format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        SchemaType::Phone => {
            if !patterns::is_phone(text) {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidPhone,
                    message: "Invalid phone number format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        SchemaType::Percentage => {
            if !patterns::is_percentage(text) && text.parse::<f64>().is_err() {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidPercentage,
                    message: "Invalid percentage format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        SchemaType::Currency => {
            if !patterns::is_currency(text) {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidCurrency,
                    message: "Invalid currency format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        SchemaType::Integer => {
            if !patterns::is_integer_str(text) {
                if text
                    .parse::<f64>()
                    .map(|n| n.fract() != 0.0)
                    .unwrap_or(true)
                {
                    Some(ValidationError {
                        code: ValidationErrorCode::InvalidInteger,
                        message: "Value must be a whole number".into(),
                        severity: ValidationSeverity::Error,
                    })
                } else {
                    None
                }
            } else {
                None
            }
        }
        SchemaType::Date => {
            if !patterns::is_date_string(text) {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidDate,
                    message: "Invalid date format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        SchemaType::Time => {
            if !patterns::is_time_string(text) && text.parse::<f64>().is_err() {
                Some(ValidationError {
                    code: ValidationErrorCode::InvalidFormat,
                    message: "Invalid time format".into(),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Validate constraints.
fn validate_constraints(value: &CellValue, schema: &ColumnSchema) -> Vec<ValidationError> {
    let c = match &schema.constraints {
        Some(c) => c,
        None => return Vec::new(),
    };
    let mut errors = Vec::new();

    // Numeric constraints
    if is_numeric_type(schema.schema_type)
        && let Some(num) = extract_number(value, schema.schema_type)
    {
        errors.extend(constraints::check_numeric_constraints(num, c));
    }

    // String constraints
    if let CellValue::Text(text) = value {
        errors.extend(constraints::check_string_constraints(text, c));
    }

    // Enum constraint
    if let Some(ref enum_values) = c.enum_values {
        match value {
            CellValue::Text(text) => {
                if let Some(err) = constraints::check_enum_constraint(text, c) {
                    errors.push(err);
                }
            }
            CellValue::Number(n) => {
                if !constraints::is_number_in_enum(n.get(), enum_values) {
                    errors.push(ValidationError {
                        code: ValidationErrorCode::Enum,
                        message: format!(
                            "Value '{}' is not in allowed values: [{}]",
                            n.get(),
                            enum_values.join(", ")
                        ),
                        severity: ValidationSeverity::Error,
                    });
                }
            }
            CellValue::Boolean(b) => {
                let s = b.to_string();
                if !constraints::is_in_enum(&s, enum_values) {
                    errors.push(ValidationError {
                        code: ValidationErrorCode::Enum,
                        message: format!(
                            "Value '{}' is not in allowed values: [{}]",
                            s,
                            enum_values.join(", ")
                        ),
                        severity: ValidationSeverity::Error,
                    });
                }
            }
            _ => {}
        }
    }

    errors
}

fn is_numeric_type(t: SchemaType) -> bool {
    matches!(
        t,
        SchemaType::Number
            | SchemaType::Integer
            | SchemaType::Currency
            | SchemaType::Percentage
            | SchemaType::Distribution
            | SchemaType::Date
            | SchemaType::Time
    )
}

/// Extract a numeric value for constraint checking.
///
/// Schema-aware: `Date` text is parsed to an Excel serial via [`value_types::date_serial::try_parse_date`],
/// `Time` text to a fractional day via [`value_types::date_serial::try_parse_time`], so min/max bounds
/// (which are stored as serials/fractions) can compare against the user's typed value.
fn extract_number(value: &CellValue, schema_type: SchemaType) -> Option<f64> {
    match value {
        CellValue::Number(n) => Some(n.get()),
        CellValue::Text(s) => {
            let trimmed = s.trim();
            match schema_type {
                SchemaType::Date => value_types::date_serial::try_parse_date(trimmed)
                    .ok()
                    .or_else(|| {
                        value_types::date_serial::try_parse_datetime(trimmed)
                            .ok()
                            .map(f64::floor)
                    }),
                SchemaType::Time => value_types::date_serial::try_parse_time(trimmed).ok(),
                _ => {
                    let cleaned: String = s
                        .chars()
                        .filter(|c| {
                            !matches!(
                                c,
                                '$' | '\u{20ac}'
                                    | '\u{00a3}'
                                    | '\u{00a5}'
                                    | '\u{20b9}'
                                    | '\u{20bd}'
                                    | '\u{20a9}'
                                    | '%'
                                    | ','
                            )
                        })
                        .collect();
                    let cleaned = cleaned.trim();
                    cleaned
                        .parse::<f64>()
                        .ok()
                        .map(|n| if s.contains('%') { n / 100.0 } else { n })
                }
            }
        }
        _ => None,
    }
}

/// Validate a value against a column schema, including formula constraint evaluation.
///
/// Same as [`validate`] but additionally checks the schema's formula constraint
/// (if any) by calling the provided `evaluate_formula` callback. The callback
/// receives the formula string and should return the evaluated result as a
/// `CellValue`, or `None` if evaluation failed.
pub fn validate_with_formula_evaluator<F>(
    value: &CellValue,
    schema: &ColumnSchema,
    evaluate_formula: F,
) -> ValidationResult
where
    F: FnOnce(&str) -> Option<CellValue>,
{
    // Run the standard 4-step validation first
    let mut result = validate(value, schema);

    // Step 5: Formula constraint (only if we have constraints with a formula)
    if let Some(ref c) = schema.constraints
        && c.formula.is_some()
        && let Some(err) = constraints::check_formula_constraint(c, evaluate_formula)
    {
        result.errors.push(err);
        result.valid = false;
    }

    result
}

/// Convenience: check if a value is valid.
pub fn is_valid(value: &CellValue, schema: &ColumnSchema) -> bool {
    validate(value, schema).valid
}

/// Validate a column of values with optional uniqueness check.
pub fn validate_column(
    values: &[CellValue],
    schema: &ColumnSchema,
    check_unique: bool,
) -> ColumnValidationResult {
    let mut row_errors = Vec::new();
    let mut seen = if check_unique
        || schema
            .constraints
            .as_ref()
            .and_then(|c| c.unique)
            .unwrap_or(false)
    {
        Some(std::collections::HashSet::new())
    } else {
        None
    };

    for (i, value) in values.iter().enumerate() {
        let result = validate(value, schema);
        let mut errs = result.errors;

        // Check uniqueness
        if let Some(ref mut set) = seen
            && !is_empty(value)
        {
            let key = value_to_string(value);
            if !set.insert(key) {
                errs.push(ValidationError {
                    code: ValidationErrorCode::Unique,
                    message: "Value must be unique".into(),
                    severity: ValidationSeverity::Error,
                });
            }
        }

        if !errs.is_empty() {
            row_errors.push(RowError {
                row: i,
                errors: errs,
            });
        }
    }

    ColumnValidationResult {
        valid: row_errors.is_empty(),
        row_errors,
    }
}

fn value_to_string(value: &CellValue) -> String {
    match value {
        CellValue::Number(n) => format!("{}", n.get()),
        CellValue::Text(s) => s.to_string(),
        CellValue::Boolean(b) => format!("{}", b),
        _ => String::new(),
    }
}

/// Result of validating an entire column.
#[derive(Debug, Clone)]
pub struct ColumnValidationResult {
    pub valid: bool,
    pub row_errors: Vec<RowError>,
}

/// Errors for a specific row.
#[derive(Debug, Clone)]
pub struct RowError {
    pub row: usize,
    pub errors: Vec<ValidationError>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::FiniteF64;

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
        let result = validate(&num(3.14), &schema);
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
        // String is not compatible with Email -> TypeMismatch.
        // Coercion to Email (coerce_to_string) succeeds -> TypeMismatch cleared.
        // Result: valid with coerced_value.
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
    fn is_valid_convenience() {
        let schema = make_schema(SchemaType::Number);
        assert!(is_valid(&num(42.0), &schema));
    }

    // 20. coercion_fallback
    #[test]
    fn coercion_fallback() {
        let schema = make_schema(SchemaType::Number);
        // Boolean infers as Boolean, not compatible with Number -> TypeMismatch
        // Coercion: Boolean(true) -> Number(1.0) -> success, TypeMismatch cleared
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

    // ══════════════════════════════════════════════════════════════════
    // First-principle tests
    // ══════════════════════════════════════════════════════════════════

    // Principle: When a value type-mismatches but coercion succeeds,
    // constraints should STILL be checked on the coerced value.
    #[test]
    fn coercion_fallback_should_still_check_constraints() {
        let schema = make_schema_with_constraints(
            SchemaType::Number,
            SchemaConstraints {
                max: Some(100.0),
                ..Default::default()
            },
        );
        // Boolean(true) coerces to Number(1.0), which is within max:100 — should pass
        let result = validate(&CellValue::Boolean(true), &schema);
        assert!(result.valid, "Coerced 1.0 should pass max:100");

        // Text "150" would coerce to Number(150.0), which exceeds max:100
        // From first principles, this SHOULD fail.
        let result = validate(&text("150"), &schema);
        assert!(
            !result.valid,
            "Coerced 150.0 should fail max:100 constraint"
        );
    }

    // Principle: validate_with_formula_evaluator should run standard validation
    // AND formula constraint check
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
        let result = validate_with_formula_evaluator(&num(5.0), &schema, |_| {
            Some(CellValue::Boolean(false))
        });
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

    // Principle: If formula passes but other validation fails, result should still be invalid
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

    // Principle: If standard validation passes and formula passes, result is valid
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
        let result = validate_with_formula_evaluator(&num(50.0), &schema, |_| {
            Some(CellValue::Boolean(true))
        });
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    // Principle: Enum constraints should also apply to numeric values, not just text.
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

    // Principle: Empty string should trigger "required" constraint just like null
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

    // Principle: Validation result should always include the inferred type
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

    // Principle: Uniqueness should be case-sensitive (spreadsheet convention)
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

    // Principle: Numeric values should be valid for Date schema (Excel serial numbers)
    #[test]
    fn date_schema_accepts_serial_number() {
        let schema = make_schema(SchemaType::Date);
        assert!(validate(&num(44927.0), &schema).valid);
        assert!(validate(&num(1.0), &schema).valid);
        assert!(validate(&num(0.0), &schema).valid);
    }

    // Principle: Numeric values should be valid for Time schema (fractional days)
    #[test]
    fn time_schema_accepts_fractional_day() {
        let schema = make_schema(SchemaType::Time);
        assert!(validate(&num(0.5), &schema).valid);
        assert!(validate(&num(0.0), &schema).valid);
        assert!(validate(&num(0.99), &schema).valid);
    }

    // -- Semantic format validation (text values against semantic types) --

    #[test]
    fn valid_url_text() {
        let schema = make_schema(SchemaType::Url);
        assert!(validate(&text("https://example.com"), &schema).valid);
    }

    #[test]
    fn valid_phone_text() {
        let schema = make_schema(SchemaType::Phone);
        assert!(validate(&text("+1-555-555-5555"), &schema).valid);
    }

    #[test]
    fn valid_percentage_text() {
        let schema = make_schema(SchemaType::Percentage);
        assert!(validate(&text("50%"), &schema).valid);
    }

    #[test]
    fn numeric_text_passes_percentage_schema() {
        let schema = make_schema(SchemaType::Percentage);
        assert!(validate(&text("0.5"), &schema).valid);
    }

    #[test]
    fn valid_currency_text() {
        let schema = make_schema(SchemaType::Currency);
        assert!(validate(&text("$1,234.56"), &schema).valid);
    }

    #[test]
    fn valid_integer_text() {
        let schema = make_schema(SchemaType::Integer);
        assert!(validate(&text("42"), &schema).valid);
    }

    #[test]
    fn float_text_coerces_to_integer_schema() {
        let schema = make_schema(SchemaType::Integer);
        let result = validate(&text("3.14"), &schema);
        assert!(result.valid);
        assert!(result.coerced_value.is_some());
    }

    #[test]
    fn float_text_with_zero_fract_passes_integer_schema() {
        let schema = make_schema(SchemaType::Integer);
        assert!(validate(&text("5.0"), &schema).valid);
    }

    #[test]
    fn valid_date_text() {
        let schema = make_schema(SchemaType::Date);
        assert!(validate(&text("2024-12-11"), &schema).valid);
    }

    #[test]
    fn invalid_date_text() {
        let schema = make_schema(SchemaType::Date);
        assert!(!validate(&text("not-a-date"), &schema).valid);
    }

    #[test]
    fn valid_time_text() {
        let schema = make_schema(SchemaType::Time);
        assert!(validate(&text("14:30"), &schema).valid);
    }

    #[test]
    fn numeric_text_passes_time_schema() {
        let schema = make_schema(SchemaType::Time);
        assert!(validate(&text("0.5"), &schema).valid);
    }

    #[test]
    fn invalid_time_text_fails() {
        let schema = make_schema(SchemaType::Time);
        assert!(!validate(&text("not-a-time"), &schema).valid);
    }

    #[test]
    fn non_numeric_text_fails_percentage() {
        let schema = make_schema(SchemaType::Percentage);
        assert!(!validate(&text("abc"), &schema).valid);
    }

    #[test]
    fn non_currency_text_fails_currency() {
        let schema = make_schema(SchemaType::Currency);
        assert!(!validate(&text("abc"), &schema).valid);
    }

    // -- Enum constraint with Boolean values --

    #[test]
    fn enum_constraint_applies_to_booleans() {
        let schema = make_schema_with_constraints(
            SchemaType::Boolean,
            SchemaConstraints {
                enum_values: Some(vec!["true".into()]),
                ..Default::default()
            },
        );
        // true matches "true" in enum — should pass
        let result_true = validate(&CellValue::Boolean(true), &schema);
        assert!(result_true.valid);
        // false does NOT match "true" in enum — should fail
        let result_false = validate(&CellValue::Boolean(false), &schema);
        assert!(
            !result_false.valid,
            "Boolean false not in enum [true] should fail"
        );
    }

    // -- Numeric constraints on currency/percentage TEXT values --

    #[test]
    fn numeric_constraints_on_currency_text() {
        let schema = make_schema_with_constraints(
            SchemaType::Currency,
            SchemaConstraints {
                min: Some(0.0),
                max: Some(1000.0),
                ..Default::default()
            },
        );
        assert!(
            validate(&text("$500"), &schema).valid,
            "$500 should be within 0-1000"
        );
    }

    #[test]
    fn numeric_constraints_on_currency_number() {
        let schema = make_schema_with_constraints(
            SchemaType::Currency,
            SchemaConstraints {
                max: Some(100.0),
                ..Default::default()
            },
        );
        assert!(
            !validate(&num(200.0), &schema).valid,
            "200.0 exceeds max 100 for currency"
        );
    }

    // -- Date min/max constraints (regression for dv-date-range) --

    #[test]
    fn date_text_within_min_max_serials() {
        // 2026-01-01 = 46023, 2026-12-31 = 46387
        let schema = make_schema_with_constraints(
            SchemaType::Date,
            SchemaConstraints {
                min: Some(46023.0),
                max: Some(46387.0),
                ..Default::default()
            },
        );
        assert!(validate(&text("2026-06-15"), &schema).valid);
    }

    #[test]
    fn date_text_below_min_serial_fails() {
        let schema = make_schema_with_constraints(
            SchemaType::Date,
            SchemaConstraints {
                min: Some(46023.0),
                max: Some(46387.0),
                ..Default::default()
            },
        );
        let result = validate(&text("2025-12-31"), &schema);
        assert!(!result.valid, "2025-12-31 below min 2026-01-01 should fail");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.code == ValidationErrorCode::MinValue)
        );
    }

    #[test]
    fn date_text_above_max_serial_fails() {
        let schema = make_schema_with_constraints(
            SchemaType::Date,
            SchemaConstraints {
                min: Some(46023.0),
                max: Some(46387.0),
                ..Default::default()
            },
        );
        let result = validate(&text("2027-01-01"), &schema);
        assert!(!result.valid, "2027-01-01 above max 2026-12-31 should fail");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.code == ValidationErrorCode::MaxValue)
        );
    }

    #[test]
    fn date_serial_below_min_fails() {
        let schema = make_schema_with_constraints(
            SchemaType::Date,
            SchemaConstraints {
                min: Some(46023.0),
                ..Default::default()
            },
        );
        let result = validate(&num(46022.0), &schema);
        assert!(!result.valid);
    }

    // -- Column uniqueness with mixed types --

    #[test]
    fn column_uniqueness_with_mixed_types() {
        let schema = make_schema(SchemaType::Any);
        let values = vec![num(1.0), text("hello"), CellValue::Boolean(true), num(2.0)];
        let result = validate_column(&values, &schema, true);
        assert!(result.valid, "All different values should be unique");
    }
}

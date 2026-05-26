//! Constraint checking utilities.
//!
//! Validates values against `SchemaConstraints` (numeric bounds, string length,
//! pattern matching, enum membership). Used by the validator module.

use regex::Regex;

use super::types::{SchemaConstraints, ValidationError, ValidationErrorCode, ValidationSeverity};

// ---------------------------------------------------------------------------
// Enum membership
// ---------------------------------------------------------------------------

/// Check if a string value is in the enum list.
/// Empty enum list allows anything (returns true).
/// Uses case-insensitive string comparison as fallback.
pub(crate) fn is_in_enum(value: &str, enum_values: &[String]) -> bool {
    if enum_values.is_empty() {
        return true;
    }
    // Direct match
    if enum_values.iter().any(|v| v == value) {
        return true;
    }
    // Case-insensitive fallback
    let lower = value.to_lowercase();
    enum_values.iter().any(|v| v.to_lowercase() == lower)
}

/// Check a numeric value against enum (comparing as string representation).
pub(crate) fn is_number_in_enum(value: f64, enum_values: &[String]) -> bool {
    if enum_values.is_empty() {
        return true;
    }
    let as_str = format_number(value);
    is_in_enum(&as_str, enum_values)
}

/// Format a number for enum comparison.
/// Integers display without decimal point, floats display normally.
fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
        format!("{}", value as i64)
    } else {
        format!("{}", value)
    }
}

// ---------------------------------------------------------------------------
// Numeric constraint checking
// ---------------------------------------------------------------------------

/// Validate a numeric value against numeric constraints.
/// Returns a list of validation errors (empty = valid).
pub(crate) fn check_numeric_constraints(
    value: f64,
    constraints: &SchemaConstraints,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    // Inclusive min
    if let Some(min) = constraints.min
        && value < min
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MinValue,
            message: format!("Value {} is less than minimum {}", value, min),
            severity: ValidationSeverity::Error,
        });
    }

    // Inclusive max
    if let Some(max) = constraints.max
        && value > max
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MaxValue,
            message: format!("Value {} is greater than maximum {}", value, max),
            severity: ValidationSeverity::Error,
        });
    }

    // Exclusive min
    if let Some(exclusive_min) = constraints.exclusive_min
        && value <= exclusive_min
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MinValue,
            message: format!("Value {} must be greater than {}", value, exclusive_min),
            severity: ValidationSeverity::Error,
        });
    }

    // Exclusive max
    if let Some(exclusive_max) = constraints.exclusive_max
        && value >= exclusive_max
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MaxValue,
            message: format!("Value {} must be less than {}", value, exclusive_max),
            severity: ValidationSeverity::Error,
        });
    }

    // Equal
    if let Some(equal) = constraints.equal
        && (value - equal).abs() > f64::EPSILON
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MinValue,
            message: format!("Value {} must equal {}", value, equal),
            severity: ValidationSeverity::Error,
        });
    }

    // Not equal
    if let Some(not_equal) = constraints.not_equal
        && (value - not_equal).abs() <= f64::EPSILON
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MaxValue,
            message: format!("Value {} must not equal {}", value, not_equal),
            severity: ValidationSeverity::Error,
        });
    }

    // Not between
    if let (Some(nb_min), Some(nb_max)) = (constraints.not_between_min, constraints.not_between_max)
        && value >= nb_min
        && value <= nb_max
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MinValue,
            message: format!(
                "Value {} must not be between {} and {}",
                value, nb_min, nb_max
            ),
            severity: ValidationSeverity::Error,
        });
    }

    errors
}

// ---------------------------------------------------------------------------
// String constraint checking
// ---------------------------------------------------------------------------

/// Validate a string value against string constraints.
/// Returns a list of validation errors (empty = valid).
pub(crate) fn check_string_constraints(
    value: &str,
    constraints: &SchemaConstraints,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let len = value.len();

    // Min length
    if let Some(min_length) = constraints.min_length
        && len < min_length
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MinLength,
            message: format!("Length {} is less than minimum {}", len, min_length),
            severity: ValidationSeverity::Error,
        });
    }

    // Max length
    if let Some(max_length) = constraints.max_length
        && len > max_length
    {
        errors.push(ValidationError {
            code: ValidationErrorCode::MaxLength,
            message: format!("Length {} exceeds maximum {}", len, max_length),
            severity: ValidationSeverity::Error,
        });
    }

    // Pattern (regex)
    if let Some(ref pattern) = constraints.pattern {
        match Regex::new(pattern) {
            Ok(re) => {
                if !re.is_match(value) {
                    errors.push(ValidationError {
                        code: ValidationErrorCode::Pattern,
                        message: format!("Value does not match pattern: {}", pattern),
                        severity: ValidationSeverity::Error,
                    });
                }
            }
            Err(_) => {
                errors.push(ValidationError {
                    code: ValidationErrorCode::Pattern,
                    message: format!("Invalid regex pattern: {}", pattern),
                    severity: ValidationSeverity::Error,
                });
            }
        }
    }

    errors
}

// ---------------------------------------------------------------------------
// Enum constraint checking
// ---------------------------------------------------------------------------

/// Check a string value against enum constraints.
/// Returns an error if enum_values is set and value is not in the list.
pub(crate) fn check_enum_constraint(
    value: &str,
    constraints: &SchemaConstraints,
) -> Option<ValidationError> {
    if let Some(ref enum_values) = constraints.enum_values
        && !is_in_enum(value, enum_values)
    {
        return Some(ValidationError {
            code: ValidationErrorCode::Enum,
            message: format!(
                "Value '{}' is not in allowed values: [{}]",
                value,
                enum_values.join(", ")
            ),
            severity: ValidationSeverity::Error,
        });
    }
    None
}

// ---------------------------------------------------------------------------
// Formula constraint checking
// ---------------------------------------------------------------------------

/// Check a formula constraint by evaluating the formula string via a caller-provided
/// evaluator callback. The callback receives the formula string and returns the
/// evaluated `CellValue`. If the result is falsy (false, 0, empty string, null, error),
/// validation fails.
///
/// Returns `None` if there is no formula constraint or if the formula passes.
pub(crate) fn check_formula_constraint<F>(
    constraints: &SchemaConstraints,
    evaluate_formula: F,
) -> Option<ValidationError>
where
    F: FnOnce(&str) -> Option<value_types::CellValue>,
{
    let formula = match &constraints.formula {
        Some(f) if !f.is_empty() => f,
        _ => return None,
    };

    match evaluate_formula(formula) {
        Some(value) => {
            if !is_truthy(&value) {
                Some(ValidationError {
                    code: ValidationErrorCode::Formula,
                    message: format!("Formula constraint failed: {}", formula),
                    severity: ValidationSeverity::Error,
                })
            } else {
                None
            }
        }
        // If the formula could not be evaluated (e.g. parse error), treat as failure.
        None => Some(ValidationError {
            code: ValidationErrorCode::Formula,
            message: format!("Formula constraint could not be evaluated: {}", formula),
            severity: ValidationSeverity::Warning,
        }),
    }
}

/// Determine whether a CellValue is "truthy" for formula constraint purposes.
/// Truthy: non-zero numbers, `true`, non-empty strings.
/// Falsy: zero, `false`, empty string, null, errors.
fn is_truthy(value: &value_types::CellValue) -> bool {
    match value {
        value_types::CellValue::Number(n) => n.get() != 0.0,
        value_types::CellValue::Boolean(b) => *b,
        value_types::CellValue::Text(s) => !s.is_empty(),
        value_types::CellValue::Null => false,
        value_types::CellValue::Error(..) => false,
        // For other types (arrays, etc.), treat as truthy
        _ => true,
    }
}

/// Check whether constraints have a dropdown-eligible enum.
#[allow(dead_code)]
pub(crate) fn has_dropdown_constraint(constraints: &SchemaConstraints) -> bool {
    constraints
        .enum_values
        .as_ref()
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_in_enum ──

    #[test]
    fn enum_empty_allows_anything() {
        assert!(is_in_enum("anything", &[]));
    }

    #[test]
    fn enum_direct_match() {
        let vals = vec!["Apple".into(), "Banana".into(), "Cherry".into()];
        assert!(is_in_enum("Apple", &vals));
        assert!(is_in_enum("Banana", &vals));
        assert!(!is_in_enum("Durian", &vals));
    }

    #[test]
    fn enum_case_insensitive() {
        let vals = vec!["Yes".into(), "No".into()];
        assert!(is_in_enum("yes", &vals));
        assert!(is_in_enum("YES", &vals));
        assert!(is_in_enum("No", &vals));
    }

    #[test]
    fn number_in_enum() {
        let vals = vec!["1".into(), "2".into(), "3".into()];
        assert!(is_number_in_enum(1.0, &vals));
        assert!(is_number_in_enum(2.0, &vals));
        assert!(!is_number_in_enum(4.0, &vals));
    }

    // ── check_numeric_constraints ──

    #[test]
    fn numeric_min_pass() {
        let c = SchemaConstraints {
            min: Some(0.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(5.0, &c).is_empty());
    }

    #[test]
    fn numeric_min_fail() {
        let c = SchemaConstraints {
            min: Some(10.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(5.0, &c);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].code, ValidationErrorCode::MinValue);
    }

    #[test]
    fn numeric_max_pass() {
        let c = SchemaConstraints {
            max: Some(100.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(50.0, &c).is_empty());
    }

    #[test]
    fn numeric_max_fail() {
        let c = SchemaConstraints {
            max: Some(100.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(150.0, &c);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].code, ValidationErrorCode::MaxValue);
    }

    #[test]
    fn numeric_between_pass() {
        let c = SchemaConstraints {
            min: Some(0.0),
            max: Some(100.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(50.0, &c).is_empty());
    }

    #[test]
    fn numeric_exclusive_min_pass() {
        let c = SchemaConstraints {
            exclusive_min: Some(0.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(1.0, &c).is_empty());
    }

    #[test]
    fn numeric_exclusive_min_fail_equal() {
        let c = SchemaConstraints {
            exclusive_min: Some(0.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(0.0, &c);
        assert_eq!(errs.len(), 1);
    }

    #[test]
    fn numeric_exclusive_max_pass() {
        let c = SchemaConstraints {
            exclusive_max: Some(100.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(99.0, &c).is_empty());
    }

    #[test]
    fn numeric_exclusive_max_fail_equal() {
        let c = SchemaConstraints {
            exclusive_max: Some(100.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(100.0, &c);
        assert_eq!(errs.len(), 1);
    }

    #[test]
    fn numeric_equal_pass() {
        let c = SchemaConstraints {
            equal: Some(42.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(42.0, &c).is_empty());
    }

    #[test]
    fn numeric_equal_fail() {
        let c = SchemaConstraints {
            equal: Some(42.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(43.0, &c);
        assert_eq!(errs.len(), 1);
    }

    #[test]
    fn numeric_not_equal_pass() {
        let c = SchemaConstraints {
            not_equal: Some(42.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(43.0, &c).is_empty());
    }

    #[test]
    fn numeric_not_equal_fail() {
        let c = SchemaConstraints {
            not_equal: Some(42.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(42.0, &c);
        assert_eq!(errs.len(), 1);
    }

    #[test]
    fn numeric_not_between_pass() {
        let c = SchemaConstraints {
            not_between_min: Some(10.0),
            not_between_max: Some(20.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(5.0, &c).is_empty());
        assert!(check_numeric_constraints(25.0, &c).is_empty());
    }

    #[test]
    fn numeric_not_between_fail() {
        let c = SchemaConstraints {
            not_between_min: Some(10.0),
            not_between_max: Some(20.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(15.0, &c);
        assert_eq!(errs.len(), 1);
    }

    // ── check_string_constraints ──

    #[test]
    fn string_length_pass() {
        let c = SchemaConstraints {
            min_length: Some(2),
            max_length: Some(10),
            ..Default::default()
        };
        assert!(check_string_constraints("hello", &c).is_empty());
    }

    #[test]
    fn string_too_short() {
        let c = SchemaConstraints {
            min_length: Some(5),
            ..Default::default()
        };
        let errs = check_string_constraints("hi", &c);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].code, ValidationErrorCode::MinLength);
    }

    #[test]
    fn string_too_long() {
        let c = SchemaConstraints {
            max_length: Some(3),
            ..Default::default()
        };
        let errs = check_string_constraints("hello", &c);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].code, ValidationErrorCode::MaxLength);
    }

    #[test]
    fn string_pattern_pass() {
        let c = SchemaConstraints {
            pattern: Some("^[A-Z]+$".into()),
            ..Default::default()
        };
        assert!(check_string_constraints("ABC", &c).is_empty());
    }

    #[test]
    fn string_pattern_fail() {
        let c = SchemaConstraints {
            pattern: Some("^[A-Z]+$".into()),
            ..Default::default()
        };
        let errs = check_string_constraints("abc", &c);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].code, ValidationErrorCode::Pattern);
    }

    #[test]
    fn string_invalid_regex() {
        let c = SchemaConstraints {
            pattern: Some("[invalid".into()),
            ..Default::default()
        };
        let errs = check_string_constraints("test", &c);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].code, ValidationErrorCode::Pattern);
    }

    // ── check_enum_constraint ──

    #[test]
    fn enum_constraint_pass() {
        let c = SchemaConstraints {
            enum_values: Some(vec!["A".into(), "B".into(), "C".into()]),
            ..Default::default()
        };
        assert!(check_enum_constraint("A", &c).is_none());
    }

    #[test]
    fn enum_constraint_fail() {
        let c = SchemaConstraints {
            enum_values: Some(vec!["A".into(), "B".into(), "C".into()]),
            ..Default::default()
        };
        let err = check_enum_constraint("D", &c);
        assert!(err.is_some());
        assert_eq!(err.unwrap().code, ValidationErrorCode::Enum);
    }

    #[test]
    fn enum_constraint_no_enum() {
        let c = SchemaConstraints::default();
        assert!(check_enum_constraint("anything", &c).is_none());
    }

    // ── has_dropdown_constraint ──

    #[test]
    fn dropdown_with_enum() {
        let c = SchemaConstraints {
            enum_values: Some(vec!["A".into()]),
            ..Default::default()
        };
        assert!(has_dropdown_constraint(&c));
    }

    #[test]
    fn dropdown_empty_enum() {
        let c = SchemaConstraints {
            enum_values: Some(vec![]),
            ..Default::default()
        };
        assert!(!has_dropdown_constraint(&c));
    }

    #[test]
    fn dropdown_no_enum() {
        let c = SchemaConstraints::default();
        assert!(!has_dropdown_constraint(&c));
    }

    // ══════════════════════════════════════════════════════════════════
    // First-principle tests — formula constraints
    // ══════════════════════════════════════════════════════════════════

    // Principle: Formula returning Boolean(true) means constraint passes
    #[test]
    fn formula_returning_true_passes() {
        let c = SchemaConstraints {
            formula: Some("=A1>0".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| Some(value_types::CellValue::Boolean(true)));
        assert!(result.is_none(), "Truthy formula should produce no error");
    }

    // Principle: Formula returning Boolean(false) means constraint fails
    #[test]
    fn formula_returning_false_fails() {
        let c = SchemaConstraints {
            formula: Some("=A1>0".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| Some(value_types::CellValue::Boolean(false)));
        assert!(result.is_some(), "Falsy formula should produce error");
        assert_eq!(result.unwrap().code, ValidationErrorCode::Formula);
    }

    // Principle: Non-zero number is truthy
    #[test]
    fn formula_returning_nonzero_number_passes() {
        let c = SchemaConstraints {
            formula: Some("=SUM(A1:A10)".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| {
            Some(value_types::CellValue::Number(
                value_types::FiniteF64::new(42.0).unwrap(),
            ))
        });
        assert!(result.is_none());
    }

    // Principle: Zero is falsy
    #[test]
    fn formula_returning_zero_fails() {
        let c = SchemaConstraints {
            formula: Some("=SUM(A1:A10)".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| {
            Some(value_types::CellValue::Number(
                value_types::FiniteF64::new(0.0).unwrap(),
            ))
        });
        assert!(result.is_some(), "Zero should be falsy");
    }

    // Principle: Non-empty string is truthy
    #[test]
    fn formula_returning_nonempty_string_passes() {
        let c = SchemaConstraints {
            formula: Some("=A1".into()),
            ..Default::default()
        };
        let result =
            check_formula_constraint(&c, |_| Some(value_types::CellValue::Text("hello".into())));
        assert!(result.is_none());
    }

    // Principle: Empty string is falsy
    #[test]
    fn formula_returning_empty_string_fails() {
        let c = SchemaConstraints {
            formula: Some("=A1".into()),
            ..Default::default()
        };
        let result =
            check_formula_constraint(&c, |_| Some(value_types::CellValue::Text("".into())));
        assert!(result.is_some());
    }

    // Principle: Null is falsy
    #[test]
    fn formula_returning_null_fails() {
        let c = SchemaConstraints {
            formula: Some("=A1".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| Some(value_types::CellValue::Null));
        assert!(result.is_some());
    }

    // Principle: Error values are falsy
    #[test]
    fn formula_returning_error_fails() {
        let c = SchemaConstraints {
            formula: Some("=1/0".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| {
            Some(value_types::CellValue::Error(
                value_types::CellError::Div0,
                None,
            ))
        });
        assert!(result.is_some());
    }

    // Principle: If evaluator returns None (parse error, etc.), treat as failure with warning severity
    #[test]
    fn formula_evaluation_failure_produces_warning() {
        let c = SchemaConstraints {
            formula: Some("=INVALID()".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| None);
        assert!(result.is_some(), "Evaluation failure should produce error");
        let err = result.unwrap();
        assert_eq!(err.code, ValidationErrorCode::Formula);
        assert_eq!(
            err.severity,
            ValidationSeverity::Warning,
            "Evaluation failure should be Warning, not Error"
        );
    }

    // Principle: No formula in constraints -> no error (no-op)
    #[test]
    fn no_formula_constraint_is_noop() {
        let c = SchemaConstraints::default();
        let result = check_formula_constraint(&c, |_| panic!("Should not be called"));
        assert!(result.is_none());
    }

    // Principle: Empty formula string -> no error (no-op)
    #[test]
    fn empty_formula_string_is_noop() {
        let c = SchemaConstraints {
            formula: Some("".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |_| panic!("Should not be called"));
        assert!(result.is_none());
    }

    // Principle: The formula string is passed to the evaluator unchanged
    #[test]
    fn formula_string_passed_to_evaluator() {
        let c = SchemaConstraints {
            formula: Some("=AND(A1>0,B1<100)".into()),
            ..Default::default()
        };
        let result = check_formula_constraint(&c, |formula| {
            assert_eq!(formula, "=AND(A1>0,B1<100)");
            Some(value_types::CellValue::Boolean(true))
        });
        assert!(result.is_none());
    }

    // ══════════════════════════════════════════════════════════════════
    // First-principle tests — numeric constraint boundary cases
    // ══════════════════════════════════════════════════════════════════

    // Principle: Value exactly at min boundary should pass (inclusive)
    #[test]
    fn numeric_min_boundary_inclusive() {
        let c = SchemaConstraints {
            min: Some(10.0),
            ..Default::default()
        };
        assert!(
            check_numeric_constraints(10.0, &c).is_empty(),
            "Value at min should pass"
        );
    }

    // Principle: Value exactly at max boundary should pass (inclusive)
    #[test]
    fn numeric_max_boundary_inclusive() {
        let c = SchemaConstraints {
            max: Some(100.0),
            ..Default::default()
        };
        assert!(
            check_numeric_constraints(100.0, &c).is_empty(),
            "Value at max should pass"
        );
    }

    // Principle: When min == max, only that exact value should pass
    #[test]
    fn numeric_min_equals_max_only_exact_passes() {
        let c = SchemaConstraints {
            min: Some(42.0),
            max: Some(42.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(42.0, &c).is_empty());
        assert!(!check_numeric_constraints(41.9, &c).is_empty());
        assert!(!check_numeric_constraints(42.1, &c).is_empty());
    }

    // Principle: not_between boundary values should fail (inclusive)
    #[test]
    fn not_between_boundaries_are_inclusive() {
        let c = SchemaConstraints {
            not_between_min: Some(10.0),
            not_between_max: Some(20.0),
            ..Default::default()
        };
        assert!(
            !check_numeric_constraints(10.0, &c).is_empty(),
            "Boundary 10.0 should fail not_between"
        );
        assert!(
            !check_numeric_constraints(20.0, &c).is_empty(),
            "Boundary 20.0 should fail not_between"
        );
        assert!(check_numeric_constraints(9.99, &c).is_empty());
        assert!(check_numeric_constraints(20.01, &c).is_empty());
    }

    // Principle: Multiple constraint violations should produce multiple errors
    #[test]
    fn multiple_constraint_violations_produce_multiple_errors() {
        let c = SchemaConstraints {
            min: Some(10.0),
            not_equal: Some(5.0),
            ..Default::default()
        };
        let errs = check_numeric_constraints(5.0, &c);
        assert!(
            errs.len() >= 2,
            "Should have at least 2 errors for value violating min AND not_equal, got {}",
            errs.len()
        );
    }

    // -- Coverage: epsilon boundary for equal/not_equal --

    #[test]
    fn numeric_equal_within_epsilon() {
        let c = SchemaConstraints {
            equal: Some(1.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(1.0, &c).is_empty());
        let tiny_above = 1.0 + f64::EPSILON / 2.0;
        assert!(check_numeric_constraints(tiny_above, &c).is_empty());
    }

    #[test]
    fn numeric_not_equal_within_epsilon() {
        let c = SchemaConstraints {
            not_equal: Some(1.0),
            ..Default::default()
        };
        assert!(!check_numeric_constraints(1.0, &c).is_empty());
    }

    #[test]
    fn numeric_equal_negative() {
        let c = SchemaConstraints {
            equal: Some(-5.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(-5.0, &c).is_empty());
        assert!(!check_numeric_constraints(-4.0, &c).is_empty());
    }

    #[test]
    fn numeric_not_equal_negative() {
        let c = SchemaConstraints {
            not_equal: Some(-5.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(-4.0, &c).is_empty());
        assert!(!check_numeric_constraints(-5.0, &c).is_empty());
    }

    #[test]
    fn formula_returning_array_is_truthy() {
        let c = SchemaConstraints {
            formula: Some("=A1:A3".into()),
            ..Default::default()
        };
        let result =
            check_formula_constraint(&c, |_| Some(value_types::CellValue::from_rows(vec![])));
        assert!(result.is_none(), "Array values should be truthy");
    }

    #[test]
    fn numeric_exclusive_min_negative() {
        let c = SchemaConstraints {
            exclusive_min: Some(-10.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(-9.0, &c).is_empty());
        assert!(!check_numeric_constraints(-10.0, &c).is_empty());
        assert!(!check_numeric_constraints(-11.0, &c).is_empty());
    }

    #[test]
    fn numeric_exclusive_max_negative() {
        let c = SchemaConstraints {
            exclusive_max: Some(-5.0),
            ..Default::default()
        };
        assert!(check_numeric_constraints(-6.0, &c).is_empty());
        assert!(!check_numeric_constraints(-5.0, &c).is_empty());
        assert!(!check_numeric_constraints(-4.0, &c).is_empty());
    }
}

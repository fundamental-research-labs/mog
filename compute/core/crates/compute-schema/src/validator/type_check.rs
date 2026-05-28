use value_types::CellValue;

use crate::inference;
use crate::types::{SchemaType, ValidationError, ValidationErrorCode, ValidationSeverity};

use super::semantic;

/// Validate type compatibility.
pub(super) fn validate_type(
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
        && let Some(err) = semantic::validate_semantic_format(text, expected)
    {
        return vec![err];
    }

    Vec::new()
}

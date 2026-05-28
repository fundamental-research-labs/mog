use value_types::CellValue;

use crate::constraints;
use crate::types::{
    ColumnSchema, ValidationError, ValidationErrorCode, ValidationResult, ValidationSeverity,
};

use super::numeric;

/// Validate constraints.
pub(super) fn validate_constraints(
    value: &CellValue,
    schema: &ColumnSchema,
) -> Vec<ValidationError> {
    let c = match &schema.constraints {
        Some(c) => c,
        None => return Vec::new(),
    };
    let mut errors = Vec::new();

    // Numeric constraints
    if numeric::is_numeric_type(schema.schema_type)
        && let Some(num) = numeric::extract_number(value, schema.schema_type)
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

pub(super) fn append_formula_error<F>(
    result: &mut ValidationResult,
    schema: &ColumnSchema,
    evaluate_formula: F,
) where
    F: FnOnce(&str) -> Option<CellValue>,
{
    if let Some(ref c) = schema.constraints
        && c.formula.is_some()
        && let Some(err) = constraints::check_formula_constraint(c, evaluate_formula)
    {
        result.errors.push(err);
        result.valid = false;
    }
}

use value_types::CellValue;

use crate::types::{ColumnSchema, ValidationError, ValidationErrorCode, ValidationSeverity};

use super::scalar;

/// Validate a column of values with optional uniqueness check.
pub(super) fn validate_column(
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
        let result = scalar::validate(value, schema);
        let mut errs = result.errors;

        // Check uniqueness
        if let Some(ref mut set) = seen
            && !scalar::is_empty(value)
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

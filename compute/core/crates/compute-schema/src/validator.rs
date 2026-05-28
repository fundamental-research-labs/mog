//! Core validation engine.
//!
//! Validates cell values against column schemas with type checking,
//! constraint enforcement, and coercion fallback.

use value_types::CellValue;

use super::types::{ColumnSchema, ValidationResult};

mod column;
mod constraint_dispatch;
mod numeric;
mod scalar;
mod semantic;
mod type_check;

#[cfg(test)]
mod tests;

pub use column::{ColumnValidationResult, RowError};

/// Validate a value against a column schema.
///
/// 4-step flow:
/// 1. Empty check (required constraint)
/// 2. Type validation (infer -> check compatibility)
/// 3. Constraint validation (numeric bounds, string length, enum)
/// 4. Coercion fallback (if type mismatch, try coercing)
pub fn validate(value: &CellValue, schema: &ColumnSchema) -> ValidationResult {
    scalar::validate(value, schema)
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
    scalar::validate_with_formula_evaluator(value, schema, evaluate_formula)
}

/// Convenience: check if a value is valid.
pub fn is_valid(value: &CellValue, schema: &ColumnSchema) -> bool {
    scalar::is_valid(value, schema)
}

/// Validate a column of values with optional uniqueness check.
pub fn validate_column(
    values: &[CellValue],
    schema: &ColumnSchema,
    check_unique: bool,
) -> ColumnValidationResult {
    column::validate_column(values, schema, check_unique)
}

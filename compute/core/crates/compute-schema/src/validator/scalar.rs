use value_types::{CellValue, FiniteF64};

use crate::coercion;
use crate::inference;
use crate::types::{
    ColumnSchema, ValidationError, ValidationErrorCode, ValidationResult, ValidationSeverity,
};

use super::constraint_dispatch;
use super::type_check;

pub(super) fn validate(value: &CellValue, schema: &ColumnSchema) -> ValidationResult {
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
    let type_errors = type_check::validate_type(value, schema.schema_type, inferred_type);
    let has_type_errors = !type_errors.is_empty();
    errors.extend(type_errors);

    // Step 3: Constraint validation (only if type matches)
    if !has_type_errors && schema.constraints.is_some() {
        errors.extend(constraint_dispatch::validate_constraints(value, schema));
    }

    // Step 4: Coercion fallback
    let mut coerced_value = None;
    if has_type_errors {
        let coercion_result = coercion::coerce(value, schema.schema_type);
        if coercion_result.success
            && let Some(value_result) = coercion_result.value
        {
            let constraint_value = cell_value_result_to_cell_value(&value_result);
            coerced_value = Some(value_result);
            // Clear type mismatch errors since coercion succeeded.
            errors.retain(|e| e.code != ValidationErrorCode::TypeMismatch);
            if errors.is_empty()
                && schema.constraints.is_some()
                && let Some(constraint_value) = constraint_value
            {
                errors.extend(constraint_dispatch::validate_constraints(
                    &constraint_value,
                    schema,
                ));
            }
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
pub(super) fn is_empty(value: &CellValue) -> bool {
    match value {
        CellValue::Null => true,
        CellValue::Text(s) => s.is_empty(),
        _ => false,
    }
}

fn cell_value_result_to_cell_value(value: &crate::types::CellValueResult) -> Option<CellValue> {
    match value {
        crate::types::CellValueResult::Number(n) => FiniteF64::new(*n).map(CellValue::Number),
        crate::types::CellValueResult::Text(s) => Some(CellValue::Text(s.clone().into())),
        crate::types::CellValueResult::Boolean(b) => Some(CellValue::Boolean(*b)),
        crate::types::CellValueResult::Null => Some(CellValue::Null),
    }
}

pub(super) fn validate_with_formula_evaluator<F>(
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
    constraint_dispatch::append_formula_error(&mut result, schema, evaluate_formula);

    result
}

pub(super) fn is_valid(value: &CellValue, schema: &ColumnSchema) -> bool {
    validate(value, schema).valid
}

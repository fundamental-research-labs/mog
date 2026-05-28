use serde::{Deserialize, Serialize};

use super::schema_types::SchemaType;

/// Error codes for validation failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationErrorCode {
    TypeMismatch,
    InvalidFormat,
    Required,
    MinValue,
    MaxValue,
    MinLength,
    MaxLength,
    Pattern,
    Enum,
    Unique,
    Formula,
    InvalidEmail,
    InvalidUrl,
    InvalidPhone,
    InvalidCurrency,
    InvalidPercentage,
    InvalidInteger,
    InvalidDate,
}

/// Validation severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValidationSeverity {
    Error,
    Warning,
    Info,
}

/// A single validation error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    pub code: ValidationErrorCode,
    pub message: String,
    pub severity: ValidationSeverity,
}

/// Result of validating a value against a schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coerced_value: Option<CellValueResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred_type: Option<SchemaType>,
}

impl ValidationResult {
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            coerced_value: None,
            inferred_type: None,
        }
    }

    pub fn valid_with_type(inferred_type: SchemaType) -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            coerced_value: None,
            inferred_type: Some(inferred_type),
        }
    }

    pub fn invalid(errors: Vec<ValidationError>) -> Self {
        Self {
            valid: false,
            errors,
            coerced_value: None,
            inferred_type: None,
        }
    }
}

/// Represents a coerced cell value result.
/// Uses simple types rather than CellValue to avoid coupling to the evaluator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum CellValueResult {
    Number(f64),
    Text(String),
    Boolean(bool),
    Null,
}

/// Result of attempting to coerce a value to a target type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoercionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<CellValueResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CoercionResult {
    pub fn ok(value: CellValueResult) -> Self {
        Self {
            success: true,
            value: Some(value),
            error: None,
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            value: None,
            error: Some(message.into()),
        }
    }
}

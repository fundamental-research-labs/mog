use serde::{Deserialize, Serialize};
use std::fmt;

/// Structured error type for pivot validation failures.
///
/// Returned by `validate_and_resolve()` when a configuration is invalid.
/// Provides machine-readable error kinds with human-readable context.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PivotError {
    /// A required field is missing or empty.
    MissingField {
        /// The name of the missing field.
        field: String,
        /// Human-readable explanation of what is required.
        message: String,
    },
    /// A field reference (`field_id`) does not exist in the fields list.
    UnknownField {
        /// The unresolved field identifier.
        field_id: String,
        /// Where the unknown reference was found.
        context: String,
    },
    /// A numeric configuration value is invalid (NaN, Infinity, negative, etc.).
    InvalidValue {
        /// The field containing the invalid value.
        field: String,
        /// Description of why the value is invalid.
        message: String,
    },
    /// A filter condition is malformed (missing operands, etc.).
    InvalidFilter {
        /// The field whose filter is invalid.
        field_id: String,
        /// Description of the filter error.
        message: String,
    },
    /// Duplicate placement of a field in the same area.
    DuplicatePlacement {
        /// The duplicated field identifier.
        field_id: String,
        /// The area where the duplicate was found (e.g., "Row").
        area: String,
    },
    /// A calculated field formula has a syntax error.
    InvalidFormula {
        /// The calculated field identifier.
        field_id: String,
        /// Description of the formula parse error.
        message: String,
    },
    /// A general validation error (e.g., duplicate IDs, inverted ranges).
    ValidationError {
        /// Human-readable error description.
        message: String,
    },
    /// Multiple validation errors collected during a single validation pass.
    Multiple {
        /// The individual errors.
        errors: Vec<PivotError>,
    },
}

impl fmt::Display for PivotError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PivotError::MissingField { field, message } => {
                write!(f, "Missing field '{field}': {message}")
            }
            PivotError::UnknownField { field_id, context } => {
                write!(f, "Unknown field '{field_id}': {context}")
            }
            PivotError::InvalidValue { field, message } => {
                write!(f, "Invalid value for '{field}': {message}")
            }
            PivotError::InvalidFilter { field_id, message } => {
                write!(f, "Invalid filter on '{field_id}': {message}")
            }
            PivotError::DuplicatePlacement { field_id, area } => {
                write!(
                    f,
                    "Duplicate placement: field '{field_id}' in area '{area}'"
                )
            }
            PivotError::InvalidFormula { field_id, message } => {
                write!(f, "Invalid formula for '{field_id}': {message}")
            }
            PivotError::ValidationError { message } => {
                write!(f, "Validation error: {message}")
            }
            PivotError::Multiple { errors } => {
                write!(f, "{} validation errors: ", errors.len())?;
                for (i, e) in errors.iter().enumerate() {
                    if i > 0 {
                        write!(f, "; ")?;
                    }
                    write!(f, "{e}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for PivotError {}

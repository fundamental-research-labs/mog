use crate::patterns;
use crate::types::{SchemaType, ValidationError, ValidationErrorCode, ValidationSeverity};

/// Validate semantic format for text values.
pub(super) fn validate_semantic_format(
    text: &str,
    expected: SchemaType,
) -> Option<ValidationError> {
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

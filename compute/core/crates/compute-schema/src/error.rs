use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ValidationError {
    #[error("coercion failed for column '{column}': cannot convert {from_type} to {to_type}")]
    CoercionFailed {
        column: String,
        from_type: String,
        to_type: String,
    },
    #[error("constraint violated: {0}")]
    ConstraintViolated(String),
    #[error("invalid schema definition: {0}")]
    InvalidSchema(String),
}

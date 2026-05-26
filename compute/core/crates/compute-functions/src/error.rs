use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum FunctionsError {
    #[error("aggregate requires value data for operation '{operation}'")]
    MissingValueData { operation: &'static str },
    #[error("{0}")]
    Internal(String),
}

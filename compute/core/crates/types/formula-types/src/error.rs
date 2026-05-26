use thiserror::Error;

/// Minimal shell — crate is fully infallible today (pure type transformations).
/// Add variants when actual error paths are introduced.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum FormulaTypeError {
    /// Catch-all for internal / unexpected errors.
    #[error("{0}")]
    Internal(String),
}

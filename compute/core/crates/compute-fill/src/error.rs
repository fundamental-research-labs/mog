use thiserror::Error;

/// Minimal shell — crate is fully infallible today (single pub fn returns FillResult, never fails).
/// Add variants when actual error paths are introduced.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum FillError {
    #[error("{0}")]
    Internal(String),
}

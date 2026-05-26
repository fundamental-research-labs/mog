use thiserror::Error;

/// Minimal shell — all measurement functions return graceful defaults (0.0) on failure.
/// Add variants when actual error paths are introduced.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum MeasurementError {
    #[error("{0}")]
    Internal(String),
}

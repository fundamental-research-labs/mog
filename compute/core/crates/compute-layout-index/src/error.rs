use thiserror::Error;

/// Minimal shell — all bounds checks return gracefully (no panics, no Results).
/// Add variants when actual error paths are introduced.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum LayoutError {
    #[error("{0}")]
    Internal(String),
}

use thiserror::Error;

/// Minimal shell — no production failure paths exist today.
/// Add domain variants when actual error paths are introduced.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum StatsError {
    /// An input failed a domain-specific validation check.
    #[error("validation failed: {0}")]
    Validation(String),
}

use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum SnapshotError {
    #[error("domain type serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid snapshot: {0}")]
    InvalidSnapshot(String),
}

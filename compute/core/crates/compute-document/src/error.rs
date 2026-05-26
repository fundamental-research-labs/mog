use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum DocumentError {
    #[error("cell serialization failed: {0}")]
    CellSerialization(String),
    #[error("identity generation failed: {0}")]
    IdentityGeneration(String),
    #[error("undo operation failed: {0}")]
    UndoFailed(String),
}

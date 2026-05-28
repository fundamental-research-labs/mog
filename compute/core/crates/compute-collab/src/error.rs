/// Errors that can occur during sync protocol operations.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// Failed to decode a state vector from bytes.
    #[error("Failed to decode state vector: {0}")]
    StateVectorDecode(String),

    /// Failed to decode an update from bytes.
    #[error("Failed to decode update: {0}")]
    UpdateDecode(String),

    /// Failed to encode a diff (state-as-update) from a document.
    #[error("Failed to encode diff: {0}")]
    DiffEncode(String),

    /// Failed to apply an update to a document.
    #[error("Failed to apply update: {0}")]
    ApplyUpdate(String),
}

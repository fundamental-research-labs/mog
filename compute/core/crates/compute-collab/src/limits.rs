use crate::SyncError;

/// Maximum accepted byte length for an encoded update (64 MiB).
pub(crate) const MAX_UPDATE_BYTES: usize = 64 * 1024 * 1024;

/// Maximum accepted byte length for an encoded state vector (1 MiB).
/// State vectors are compact summaries; anything this large is bogus.
pub(crate) const MAX_STATE_VECTOR_BYTES: usize = 1024 * 1024;

pub(crate) fn reject_oversized_update(bytes: &[u8]) -> Result<(), SyncError> {
    if bytes.len() > MAX_UPDATE_BYTES {
        return Err(SyncError::UpdateDecode(format!(
            "update too large: {} bytes (max {})",
            bytes.len(),
            MAX_UPDATE_BYTES
        )));
    }
    Ok(())
}

pub(crate) fn reject_oversized_state_vector(bytes: &[u8]) -> Result<(), SyncError> {
    if bytes.len() > MAX_STATE_VECTOR_BYTES {
        return Err(SyncError::StateVectorDecode(format!(
            "state vector too large: {} bytes (max {})",
            bytes.len(),
            MAX_STATE_VECTOR_BYTES
        )));
    }
    Ok(())
}

use crate::SyncError;
use crate::limits::{reject_oversized_state_vector, reject_oversized_update};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

/// Encode the current state vector of a document.
///
/// The state vector is a compact summary of which updates this document has already
/// integrated. It is sent to a remote peer during the sync handshake so the remote
/// can compute a minimal diff.
///
/// This operation is read-only and does not modify the document.
pub fn encode_state_vector(doc: &Doc) -> Vec<u8> {
    let txn = doc.transact();
    txn.state_vector().encode_v1()
}

/// Compute and encode a diff: all changes in `doc` that a remote peer (described by
/// `remote_sv`, its encoded state vector) has not yet seen.
///
/// The returned bytes are a v1-encoded update that can be sent over the wire and
/// applied to the remote document via [`apply_update`].
///
/// # Errors
///
/// Returns [`SyncError::StateVectorDecode`] if `remote_sv` is not a valid v1-encoded
/// state vector, or [`SyncError::DiffEncode`] if diff encoding fails internally.
pub fn encode_diff(doc: &Doc, remote_sv: &[u8]) -> Result<Vec<u8>, SyncError> {
    reject_oversized_state_vector(remote_sv)?;
    let sv = StateVector::decode_v1(remote_sv)
        .map_err(|e| SyncError::StateVectorDecode(e.to_string()))?;
    let txn = doc.transact();
    Ok(txn.encode_diff_v1(&sv))
}

/// Apply a remote update (v1-encoded) to the local document.
///
/// The update bytes are typically produced by [`encode_diff`] or [`encode_full_state`]
/// on a remote peer.
///
/// # Errors
///
/// Returns [`SyncError::UpdateDecode`] if the bytes are not a valid v1-encoded update,
/// or [`SyncError::ApplyUpdate`] if the update cannot be integrated into the document.
pub fn apply_update(doc: &Doc, update: &[u8]) -> Result<(), SyncError> {
    reject_oversized_update(update)?;
    let update = Update::decode_v1(update).map_err(|e| SyncError::UpdateDecode(e.to_string()))?;
    let mut txn = doc.transact_mut();
    txn.apply_update(update)
        .map_err(|e| SyncError::ApplyUpdate(e.to_string()))
}

/// Encode the full document state as a v1 update.
///
/// This is equivalent to computing a diff against an empty state vector; the returned
/// bytes contain all changes ever made to the document. Useful for initial sync when
/// a new client joins with no prior state.
pub fn encode_full_state(doc: &Doc) -> Vec<u8> {
    let txn = doc.transact();
    txn.encode_diff_v1(&StateVector::default())
}

/// Decode a state vector from its v1-encoded byte representation.
///
/// # Errors
///
/// Returns [`SyncError::StateVectorDecode`] if the bytes are malformed.
pub fn decode_state_vector(bytes: &[u8]) -> Result<StateVector, SyncError> {
    reject_oversized_state_vector(bytes)?;
    StateVector::decode_v1(bytes).map_err(|e| SyncError::StateVectorDecode(e.to_string()))
}

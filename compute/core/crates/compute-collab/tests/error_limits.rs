mod support;

use compute_collab::{SyncError, apply_update, decode_state_vector, encode_diff};
use support::doc_with_text;
use yrs::Doc;

const MAX_UPDATE_BYTES: usize = 64 * 1024 * 1024;
const MAX_STATE_VECTOR_BYTES: usize = 1024 * 1024;

#[test]
fn invalid_state_vector_bytes() {
    let result = decode_state_vector(&[0xFF, 0xFE, 0xFD, 0xFC]);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        matches!(err, SyncError::StateVectorDecode(_)),
        "expected StateVectorDecode error, got: {err}"
    );
}

#[test]
fn invalid_update_bytes() {
    let doc = Doc::new();
    let result = apply_update(&doc, &[0xDE, 0xAD, 0xBE, 0xEF]);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        matches!(err, SyncError::UpdateDecode(_)),
        "expected UpdateDecode error, got: {err}"
    );
}

#[test]
fn invalid_state_vector_in_encode_diff() {
    let doc = doc_with_text("test");
    let result = encode_diff(&doc, &[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        matches!(err, SyncError::StateVectorDecode(_)),
        "expected StateVectorDecode error, got: {err}"
    );
}

#[test]
fn oversized_update_rejected() {
    let doc = Doc::new();
    let huge = vec![0u8; MAX_UPDATE_BYTES + 1];
    let result = apply_update(&doc, &huge);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("too large"), "expected size error, got: {err}");
}

#[test]
fn oversized_state_vector_rejected_in_decode() {
    let huge = vec![0u8; MAX_STATE_VECTOR_BYTES + 1];
    let result = decode_state_vector(&huge);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("too large"), "expected size error, got: {err}");
}

#[test]
fn oversized_state_vector_rejected_in_encode_diff() {
    let doc = doc_with_text("test");
    let huge = vec![0u8; MAX_STATE_VECTOR_BYTES + 1];
    let result = encode_diff(&doc, &huge);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("too large"), "expected size error, got: {err}");
}

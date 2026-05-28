//! Sync protocol smoke coverage.

use super::super::*;
use super::helpers::simple_snapshot;

#[test]
fn test_sync_state_vector_roundtrip() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Encode state vector
    let sv = engine.encode_state_vector();
    assert!(!sv.is_empty());

    // Encoding a diff against our own state vector should produce
    // a minimal (effectively empty) update.
    let diff = engine.encode_diff(&sv);
    assert!(diff.is_ok());

    // The diff should be small (no actual changes to send).
    let diff_bytes = diff.unwrap();
    assert!(!diff_bytes.is_empty()); // yrs always produces at least a header
}

#[test]
fn test_sync_between_two_engines() {
    let snap = simple_snapshot();
    let (engine1, _) = YrsComputeEngine::from_snapshot(snap.clone()).unwrap();
    let (engine2, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Both engines start with the same snapshot.
    // Encode engine1's full state and verify engine2 can compute a diff.
    let sv1 = engine1.encode_state_vector();
    let sv2 = engine2.encode_state_vector();

    // Both should have non-empty state vectors
    assert!(!sv1.is_empty());
    assert!(!sv2.is_empty());

    // Each engine can encode a diff for the other
    let diff_1_to_2 = engine1.encode_diff(&sv2);
    assert!(diff_1_to_2.is_ok());

    let diff_2_to_1 = engine2.encode_diff(&sv1);
    assert!(diff_2_to_1.is_ok());
}

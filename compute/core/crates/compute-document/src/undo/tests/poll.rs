use crate::DocumentError;
use crate::undo::poll::poll_once;

#[test]
fn poll_once_ready_future_returns_value() {
    assert_eq!(poll_once(std::future::ready(7)).unwrap(), 7);
}

#[test]
fn poll_once_pending_future_returns_undo_failed() {
    match poll_once(std::future::pending::<()>()) {
        Err(DocumentError::UndoFailed(message)) => {
            assert!(message.contains("Pending"));
        }
        other => panic!("expected UndoFailed for Pending future, got {other:?}"),
    }
}

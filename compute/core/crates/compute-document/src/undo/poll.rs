use crate::DocumentError;
use std::task::{Context, Poll, Waker};

/// Poll a future exactly once, expecting it to resolve immediately.
///
/// yrs 0.21's `UndoManager::undo()` / `redo()` return `impl Future<Output = bool>`.
/// The future is only `Pending` when another yrs transaction is active on the same
/// document. Since we always call undo/redo outside any active transaction, the
/// future resolves on the first poll.
pub(in crate::undo) fn poll_once<F: std::future::Future>(f: F) -> Result<F::Output, DocumentError> {
    let mut pinned = std::pin::pin!(f);
    let mut cx = Context::from_waker(Waker::noop());
    match pinned.as_mut().poll(&mut cx) {
        Poll::Ready(val) => Ok(val),
        Poll::Pending => Err(DocumentError::UndoFailed(
            "undo/redo future was Pending — is a yrs transaction active?".into(),
        )),
    }
}
